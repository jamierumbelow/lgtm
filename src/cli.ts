#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getPRData } from './github/pr.js';
import { analyzeChanges } from './analysis/analyzer.js';
import { findTraces } from './analysis/trace-finder.js';
import { renderMarkdown } from './output/markdown.js';
import { renderHTML } from './output/html.js';
import { renderJSON } from './output/json.js';
import { writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { setAnthropicApiKey, deleteAnthropicApiKey, hasAnthropicApiKey } from './secrets.js';

const program = new Command();

program
  .name('lgtm')
  .description('Structured PR review companion - because "lgtm" should mean something')
  .version('0.1.0');

// Config command
program
  .command('config')
  .description('Configure lgtm settings')
  .option('--api-key <key>', 'Set the Anthropic API key (stored securely in system keychain)')
  .option('--clear-api-key', 'Remove the stored API key')
  .option('--status', 'Show configuration status')
  .action(async (options) => {
    if (options.apiKey) {
      const spinner = ora('Storing API key securely...').start();
      try {
        await setAnthropicApiKey(options.apiKey);
        spinner.succeed('API key stored securely in system keychain');
      } catch (error) {
        spinner.fail('Failed to store API key');
        if (error instanceof Error) {
          console.error(chalk.red(error.message));
        }
        process.exit(1);
      }
    } else if (options.clearApiKey) {
      const spinner = ora('Removing API key...').start();
      try {
        const deleted = await deleteAnthropicApiKey();
        if (deleted) {
          spinner.succeed('API key removed from system keychain');
        } else {
          spinner.info('No API key was stored');
        }
      } catch (error) {
        spinner.fail('Failed to remove API key');
        if (error instanceof Error) {
          console.error(chalk.red(error.message));
        }
        process.exit(1);
      }
    } else if (options.status) {
      const hasKey = await hasAnthropicApiKey();
      const envKey = !!process.env.ANTHROPIC_API_KEY;

      console.log(chalk.bold('\nConfiguration Status:\n'));

      if (envKey) {
        console.log(chalk.green('  ✓ ANTHROPIC_API_KEY environment variable is set'));
      } else if (hasKey) {
        console.log(chalk.green('  ✓ API key stored in system keychain'));
      } else {
        console.log(chalk.yellow('  ✗ No API key configured'));
        console.log(chalk.gray('\n  Run `lgtm config --api-key <key>` to configure'));
      }
      console.log();
    } else {
      console.log('Usage: lgtm config [options]');
      console.log('\nOptions:');
      console.log('  --api-key <key>   Set the Anthropic API key');
      console.log('  --clear-api-key   Remove the stored API key');
      console.log('  --status          Show configuration status');
    }
  });

// Main review command
program
  .argument('[pr-url]', 'GitHub PR URL (e.g., https://github.com/org/repo/pull/123)')
  .option('-b, --base <branch>', 'Base branch for local comparison', 'main')
  .option('-h, --head <branch>', 'Head branch for local comparison')
  .option('-f, --format <format>', 'Output format: md, json, html', 'md')
  .option('-o, --output <file>', 'Output file (defaults to stdout for md/json, server for html)')
  .option('-p, --port <port>', 'Port for HTML server', '3000')
  .option('--find-traces', 'Attempt to find LLM session traces that generated the changes')
  .option('--claude-dir <path>', 'Path to Claude Code history directory', '~/.claude')
  .option('--cursor-dir <path>', 'Path to Cursor history directory')
  .option('--no-llm', 'Skip LLM-powered analysis (descriptions, questions)')
  .action(async (prUrl, options) => {
    const spinner = ora();

    try {
      // Determine source: PR URL or local branches
      if (!prUrl && !options.head) {
        console.error(chalk.red('Error: Provide a PR URL or use --head to specify a branch'));
        process.exit(1);
      }

      // Fetch PR data
      spinner.start('Fetching PR data...');
      const prData = await getPRData(prUrl, options);
      spinner.succeed(`Fetched PR: ${prData.title || 'Local diff'}`);

      // Analyze changes
      spinner.start('Analyzing changes...');
      const analysis = await analyzeChanges(prData, { useLLM: options.llm !== false });
      spinner.succeed(`Analyzed ${analysis.changeGroups.length} change groups across ${analysis.filesChanged} files`);

      // Find LLM traces if requested
      if (options.findTraces) {
        spinner.start('Searching for LLM session traces...');
        const traces = await findTraces(prData.files, {
          claudeDir: options.claudeDir,
          cursorDir: options.cursorDir,
        });
        analysis.traces = traces;
        spinner.succeed(`Found ${traces.length} potential session traces`);
      }

      // Render output
      spinner.start('Generating review...');

      switch (options.format) {
        case 'html': {
          const html = renderHTML(analysis);
          spinner.succeed('Review generated');

          if (options.output) {
            writeFileSync(options.output, html);
            console.log(chalk.green(`\n✓ Review written to ${options.output}`));
          } else {
            // Start a bun server to serve the HTML
            const port = parseInt(options.port, 10);
            console.log(chalk.cyan(`\n✨ Starting server at http://localhost:${port}`));
            console.log(chalk.gray('Use Overview/Review toggle to switch modes'));
            console.log(chalk.gray('In Review mode: ← → or j k to navigate, Esc to exit'));
            console.log(chalk.gray('Press Ctrl+C to stop\n'));

            const serverScript = `
              const html = ${JSON.stringify(html)};
              Bun.serve({
                port: ${port},
                fetch(req) {
                  return new Response(html, {
                    headers: { 'Content-Type': 'text/html' },
                  });
                },
              });
              console.log('Server running at http://localhost:${port}');
            `;

            const bunProcess = spawn('bun', ['-e', serverScript], {
              stdio: 'inherit',
            });

            bunProcess.on('error', (err) => {
              console.error(chalk.red(`Failed to start server: ${err.message}`));
              console.log(chalk.yellow('Make sure bun is installed: https://bun.sh'));
              process.exit(1);
            });

            process.on('SIGINT', () => {
              bunProcess.kill();
              process.exit(0);
            });

            await new Promise(() => {}); // Keep running until interrupted
          }
          break;
        }
        case 'json': {
          const output = renderJSON(analysis);
          spinner.succeed('Review generated');
          if (options.output) {
            writeFileSync(options.output, output);
            console.log(chalk.green(`\n✓ Review written to ${options.output}`));
          } else {
            console.log('\n' + output);
          }
          break;
        }
        case 'md':
        case 'markdown':
        default: {
          const output = renderMarkdown(analysis);
          spinner.succeed('Review generated');
          if (options.output) {
            writeFileSync(options.output, output);
            console.log(chalk.green(`\n✓ Review written to ${options.output}`));
          } else {
            console.log('\n' + output);
          }
        }
      }

    } catch (error) {
      spinner.fail('Error');
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
      }
      process.exit(1);
    }
  });

program.parse();
