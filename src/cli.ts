#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getPRData } from "./github/pr.js";
import { analyzeChanges, ensureAnalysis } from "./analysis/analyzer.js";
import { findTraces } from "./analysis/trace-finder.js";
import { renderMarkdown } from "./output/markdown.js";
import { renderHTML } from "./output/html.js";
import { renderJSON } from "./output/json.js";
import { writeFileSync } from "fs";
import { createServer } from "http";
import {
  setAnthropicApiKey,
  deleteAnthropicApiKey,
  hasAnthropicApiKey,
  setOpenAIApiKey,
  deleteOpenAIApiKey,
  hasOpenAIApiKey,
  setGoogleApiKey,
  deleteGoogleApiKey,
  hasGoogleApiKey,
} from "./secrets.js";
import { select, password, confirm } from "@inquirer/prompts";
import { getCached, setCache, clearCache, getCacheInfo } from "./cache.js";
import {
  getLLMUsageRecords,
  getLLMUsageTotals,
  resetLLMUsage,
} from "./llm/usage.js";
import { calculateTokenlensCost } from "./llm/tokenlens.js";

const program = new Command();

program
  .name("lgtm")
  .description(
    'Structured PR review companion - because "lgtm" should mean something'
  )
  .version("0.1.0");

// Helper functions for config TUI
const getStatusIcon = (hasKey: boolean, hasEnvKey: boolean): string => {
  if (hasEnvKey) return chalk.cyan("●");
  if (hasKey) return chalk.green("●");
  return chalk.dim("○");
};

const getStatusText = (hasKey: boolean, hasEnvKey: boolean): string => {
  if (hasEnvKey) return chalk.cyan("(env)");
  if (hasKey) return chalk.green("(keychain)");
  return chalk.dim("(not set)");
};

const printStatus = async (): Promise<void> => {
  const [hasAnthropic, hasOpenAI, hasGoogle] = await Promise.all([
    hasAnthropicApiKey(),
    hasOpenAIApiKey(),
    hasGoogleApiKey(),
  ]);
  const hasAnthropicEnv = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAIEnv = !!process.env.OPENAI_API_KEY;
  const hasGoogleEnv = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  console.log();
  console.log(chalk.bold("  API Keys"));
  console.log(chalk.dim("  ────────────────────────────"));
  console.log(
    `  ${getStatusIcon(
      hasAnthropic,
      hasAnthropicEnv
    )} Anthropic  ${getStatusText(hasAnthropic, hasAnthropicEnv)}`
  );
  console.log(
    `  ${getStatusIcon(hasOpenAI, hasOpenAIEnv)} OpenAI     ${getStatusText(
      hasOpenAI,
      hasOpenAIEnv
    )}`
  );
  console.log(
    `  ${getStatusIcon(hasGoogle, hasGoogleEnv)} Gemini     ${getStatusText(
      hasGoogle,
      hasGoogleEnv
    )}`
  );
  console.log();
};

const handleApiKeySetup = async (
  provider: "Anthropic" | "OpenAI" | "Gemini",
  setKey: (key: string) => Promise<void>,
  deleteKey: () => Promise<boolean>,
  hasKey: () => Promise<boolean>
): Promise<void> => {
  const exists = await hasKey();

  const action = await select({
    message: `${provider} API Key`,
    choices: [
      { name: exists ? "Update key" : "Set key", value: "set" },
      ...(exists ? [{ name: "Remove key", value: "delete" }] : []),
      { name: "Back", value: "back" },
    ],
  });

  if (action === "back") return;

  if (action === "delete") {
    const confirmed = await confirm({
      message: `Remove ${provider} API key?`,
      default: false,
    });
    if (confirmed) {
      const spinner = ora(`Removing ${provider} API key...`).start();
      const deleted = await deleteKey();
      if (deleted) {
        spinner.succeed(`${provider} API key removed`);
      } else {
        spinner.info("No key was stored");
      }
    }
    return;
  }

  const apiKey = await password({
    message: `Enter your ${provider} API key:`,
    mask: "•",
    validate: (value) => {
      if (!value.trim()) return "API key cannot be empty";
      return true;
    },
  });

  const spinner = ora(`Storing ${provider} API key...`).start();
  await setKey(apiKey);
  spinner.succeed(`${provider} API key stored in keychain`);
};

// Config command
program
  .command("config")
  .description("Configure lgtm settings")
  .action(async () => {
    console.log();
    console.log(chalk.bold.magenta("  ⚙  lgtm config"));
    await printStatus();

    let running = true;
    while (running) {
      try {
        const choice = await select({
          message: "What would you like to configure?",
          choices: [
            { name: "Anthropic API Key", value: "anthropic" },
            { name: "OpenAI API Key", value: "openai" },
            { name: "Gemini API Key", value: "gemini" },
            { name: "Show status", value: "status" },
            { name: "Exit", value: "exit" },
          ],
        });

        switch (choice) {
          case "anthropic":
            await handleApiKeySetup(
              "Anthropic",
              setAnthropicApiKey,
              deleteAnthropicApiKey,
              hasAnthropicApiKey
            );
            break;
          case "openai":
            await handleApiKeySetup(
              "OpenAI",
              setOpenAIApiKey,
              deleteOpenAIApiKey,
              hasOpenAIApiKey
            );
            break;
          case "gemini":
            await handleApiKeySetup(
              "Gemini",
              setGoogleApiKey,
              deleteGoogleApiKey,
              hasGoogleApiKey
            );
            break;
          case "status":
            await printStatus();
            break;
          case "exit":
            running = false;
            break;
        }
      } catch (error) {
        // User pressed Ctrl+C
        if (
          error instanceof Error &&
          error.message.includes("User force closed")
        ) {
          running = false;
        } else {
          throw error;
        }
      }
    }

    console.log(chalk.dim("\n  Goodbye!\n"));
  });

// Main review command
program
  .argument(
    "[pr-url]",
    "GitHub PR URL (e.g., https://github.com/org/repo/pull/123)"
  )
  .option("-b, --base <branch>", "Base branch for local comparison", "main")
  .option("-h, --head <branch>", "Head branch for local comparison")
  .option("-f, --format <format>", "Output format: md, json, html", "md")
  .option(
    "-o, --output <file>",
    "Output file (defaults to stdout for md/json, server for html)"
  )
  .option("-p, --port <port>", "Port for HTML server", "3000")
  .option(
    "--find-traces",
    "Attempt to find LLM session traces that generated the changes"
  )
  .option(
    "--claude-dir <path>",
    "Path to Claude Code history directory",
    "~/.claude"
  )
  .option("--cursor-dir <path>", "Path to Cursor history directory")
  .option("--no-llm", "Skip LLM-powered analysis (descriptions, questions)")
  .option("--verbose", "Enable verbose logging")
  .option("--fresh", "Bypass cache and fetch fresh data")
  .action(async (prUrl, options) => {
    const spinner = ora();
    const generationStartedAt = Date.now();
    resetLLMUsage();

    try {
      // Determine source: PR URL or local branches
      if (!prUrl && !options.head) {
        console.error(
          chalk.red("Error: Provide a PR URL or use --head to specify a branch")
        );
        process.exit(1);
      }

      let prData: Awaited<ReturnType<typeof getPRData>> | undefined;
      let analysis: Awaited<ReturnType<typeof analyzeChanges>> | undefined;

      // Check cache for PR URLs (not local branches)
      if (prUrl && !options.fresh) {
        const cached = getCached(prUrl);
        if (cached) {
          const cacheInfo = getCacheInfo(prUrl);
          spinner.succeed(
            `Using cached analysis from ${
              cacheInfo.timestamp?.toLocaleString() || "cache"
            }`
          );
          prData = cached.prData;
          const updateResult = await ensureAnalysis(
            prData,
            {
              useLLM: options.llm !== false,
              includeTraces: options.findTraces,
              verbose: options.verbose,
              onProgress: prUrl
                ? (partialAnalysis) => setCache(prUrl, prData!, partialAnalysis)
                : undefined,
            },
            cached.analysis
          );
          analysis = updateResult.analysis;
          if (updateResult.updated) {
            spinner.start("Updating cached analysis...");
            spinner.succeed("Updated cached analysis");
          }
          if (prUrl && updateResult.updated) {
            setCache(prUrl, prData, analysis);
          }
          if (options.findTraces && updateResult.missing.needsTraces) {
            spinner.start("Searching for LLM session traces...");
            const traces = await findTraces(prData.files, {
              claudeDir: options.claudeDir,
              cursorDir: options.cursorDir,
            });
            analysis.traces = traces;
            spinner.succeed(`Found ${traces.length} potential session traces`);
            setCache(prUrl, prData, analysis);
          }
        }
      }

      // Clear cache if --fresh
      if (prUrl && options.fresh) {
        clearCache(prUrl);
      }

      // Fetch and analyze if not cached
      if (!analysis) {
        // Fetch PR data
        spinner.start("Fetching PR data...");
        prData = await getPRData(prUrl, options);
        spinner.succeed(`Fetched PR: ${prData.title || "Local diff"}`);

        // Analyze changes
        spinner.start("Analyzing changes...");
        analysis = await analyzeChanges(prData, {
          useLLM: options.llm !== false,
          verbose: options.verbose,
          onProgress: prUrl
            ? (partialAnalysis) => setCache(prUrl, prData!, partialAnalysis)
            : undefined,
        });
        spinner.succeed(
          `Analyzed ${analysis.changeGroups.length} change groups across ${analysis.filesChanged} files`
        );

        // Find LLM traces if requested
        if (options.findTraces) {
          spinner.start("Searching for LLM session traces...");
          const traces = await findTraces(prData.files, {
            claudeDir: options.claudeDir,
            cursorDir: options.cursorDir,
          });
          analysis.traces = traces;
          spinner.succeed(`Found ${traces.length} potential session traces`);
        }

        // Cache the results for PR URLs
        if (prUrl) {
          setCache(prUrl, prData, analysis);
        }
      }

      const usageTotals = getLLMUsageTotals();
      const usageRecords = getLLMUsageRecords();
      const tokenlensCost = await calculateTokenlensCost(
        usageRecords,
        options.verbose ? console.warn : undefined
      );
      if (usageTotals.tokenCount > 0) {
        analysis.tokenCount = usageTotals.tokenCount;
      }
      if (tokenlensCost !== undefined) {
        analysis.costUsd = tokenlensCost;
      } else if (usageTotals.costUsd > 0) {
        analysis.costUsd = usageTotals.costUsd;
      }
      analysis.generationTimeMs = Date.now() - generationStartedAt;

      // Render output
      spinner.start("Generating review...");

      switch (options.format) {
        case "html": {
          const html = renderHTML(analysis);
          spinner.succeed("Review generated");

          if (options.output) {
            writeFileSync(options.output, html);
            console.log(chalk.green(`\n✓ Review written to ${options.output}`));
          } else {
            // Start a bun server to serve the HTML
            const port = parseInt(options.port, 10);
            console.log(
              chalk.cyan(`\n✨ Starting server at http://localhost:${port}`)
            );
            console.log(
              chalk.gray("Use Overview/Review toggle to switch modes")
            );
            console.log(
              chalk.gray("In Review mode: ← → or j k to navigate, Esc to exit")
            );
            console.log(chalk.gray("Press Ctrl+C to stop\n"));

            if (typeof Bun !== "undefined" && Bun.serve) {
              const htmlResponse = new Response(html, {
                headers: { "Content-Type": "text/html" },
              });
              Bun.serve({
                port,
                fetch() {
                  return htmlResponse;
                },
              });
            } else {
              const server = createServer((req, res) => {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end(html);
              });
              server.listen(port);
            }

            await new Promise(() => {}); // Keep running until interrupted
          }
          break;
        }
        case "json": {
          const output = renderJSON(analysis);
          spinner.succeed("Review generated");
          if (options.output) {
            writeFileSync(options.output, output);
            console.log(chalk.green(`\n✓ Review written to ${options.output}`));
          } else {
            console.log("\n" + output);
          }
          break;
        }
        case "md":
        case "markdown":
        default: {
          const output = renderMarkdown(analysis);
          spinner.succeed("Review generated");
          if (options.output) {
            writeFileSync(options.output, output);
            console.log(chalk.green(`\n✓ Review written to ${options.output}`));
          } else {
            console.log("\n" + output);
          }
        }
      }
    } catch (error) {
      spinner.fail("Error");
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
