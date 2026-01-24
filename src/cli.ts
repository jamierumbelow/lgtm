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

const program = new Command();

program
  .name('lgtm')
  .description('Structured PR review companion - because "lgtm" should mean something')
  .version('0.1.0');

program
  .argument('[pr-url]', 'GitHub PR URL (e.g., https://github.com/org/repo/pull/123)')
  .option('-b, --base <branch>', 'Base branch for local comparison', 'main')
  .option('-h, --head <branch>', 'Head branch for local comparison')
  .option('-f, --format <format>', 'Output format: markdown, html, json', 'markdown')
  .option('-o, --output <file>', 'Output file (defaults to stdout for markdown/json)')
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
      let output: string;
      switch (options.format) {
        case 'html':
          output = renderHTML(analysis);
          break;
        case 'json':
          output = renderJSON(analysis);
          break;
        case 'markdown':
        default:
          output = renderMarkdown(analysis);
      }
      spinner.succeed('Review generated');

      // Write or print output
      if (options.output) {
        writeFileSync(options.output, output);
        console.log(chalk.green(`\n✓ Review written to ${options.output}`));
      } else {
        console.log('\n' + output);
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
