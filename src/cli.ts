#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import {
  getPRData,
  parseTarget,
  isGitRepository,
  getCurrentBranch,
  getDefaultBranch,
  hasUncommittedChanges,
  refsAreSame,
  getWorkingDirDiffHash,
} from "./github/pr.js";
import { analyzeChanges, ensureAnalysis } from "./analysis/analyzer.js";
import { findTraces } from "./analysis/trace-finder.js";
import { renderMarkdown } from "./output/markdown.js";
import { renderHTML } from "./output/html.js";
import { renderJSON } from "./output/json.js";
import { writeFileSync } from "fs";
import { createServer } from "http";
import { createServer as createNetServer } from "net";
import { randomUUID } from "crypto";
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
import { clearPromptCache } from "./llm/prompt-cache.js";
import {
  getLLMUsageRecords,
  getLLMUsageTotals,
  resetLLMUsage,
  getFormattedRunningTotal,
  onUsageUpdated,
} from "./llm/usage.js";
import { calculateTokenlensCost } from "./llm/tokenlens.js";
import {
  ModelChoice,
  getDefaultModel,
  getUserDefaultModel,
  BUILTIN_DEFAULT_MODEL,
} from "./config.js";
import { MODEL_SPECS } from "./llm/models.js";
import { isCLIAvailable } from "./llm/cli-provider.js";
import {
  setRawUserDefaultModel,
  clearUserDefaultModel,
} from "./preferences.js";
import {
  getVersionString,
  getBuildType,
  IS_CANARY,
  COMMIT_SHA,
  BUILD_DATE,
} from "./version.js";

const program = new Command();

program
  .name("lgtm")
  .description(
    'Structured PR review companion - because "lgtm" should mean something'
  )
  .version(getVersionString());

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

  const userDefault = getUserDefaultModel();
  const effectiveModel = getDefaultModel();
  const modelLabel = MODEL_SPECS[effectiveModel].label;

  console.log();
  console.log(chalk.bold("  Default Model"));
  console.log(chalk.dim("  ────────────────────────────"));
  console.log(
    `  ${modelLabel}${userDefault ? "" : chalk.dim(" (built-in default)")}`
  );
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

const handleDefaultModelSetup = async (): Promise<void> => {
  const currentDefault = getDefaultModel();
  const userDefault = getUserDefaultModel();

  const allModels = Object.values(ModelChoice);
  const cliModels = allModels.filter((m) => MODEL_SPECS[m].provider === "cli");
  const apiModels = allModels.filter((m) => MODEL_SPECS[m].provider !== "cli");

  // Check CLI tool availability in parallel
  const cliAvailability = new Map<ModelChoice, boolean>();
  await Promise.all(
    cliModels.map(async (model) => {
      const spec = MODEL_SPECS[model];
      const available = spec.cliCommand
        ? await isCLIAvailable(spec.cliCommand)
        : false;
      cliAvailability.set(model, available);
    })
  );

  const makeChoice = (model: ModelChoice) => {
    const spec = MODEL_SPECS[model];
    const isCurrent = model === currentDefault;
    const suffix = isCurrent ? chalk.green(" <- current") : "";
    return { name: `${spec.label}${suffix}`, value: model };
  };

  const makeDisabledChoice = (model: ModelChoice) => {
    const spec = MODEL_SPECS[model];
    return {
      name: `${spec.label} ${chalk.dim(`(${spec.cliCommand} not found)`)}`,
      value: model,
      disabled: true,
    };
  };

  // CLI options first, then API options
  const modelChoices: Array<{
    name: string;
    value: string;
    disabled?: boolean;
  }> = [
    ...cliModels.map((m) =>
      cliAvailability.get(m) ? makeChoice(m) : makeDisabledChoice(m)
    ),
    ...apiModels.map(makeChoice),
  ];

  if (userDefault) {
    modelChoices.push({
      name: `Reset to built-in default (${MODEL_SPECS[BUILTIN_DEFAULT_MODEL].label})`,
      value: "reset",
    });
  }
  modelChoices.push({ name: "Back", value: "back" });

  const choice = await select({
    message: "Select default model",
    choices: modelChoices,
  });

  if (choice === "back") return;

  if (choice === "reset") {
    clearUserDefaultModel();
    console.log(
      chalk.green(
        `  Reset to built-in default (${MODEL_SPECS[BUILTIN_DEFAULT_MODEL].label})`
      )
    );
    return;
  }

  setRawUserDefaultModel(choice);
  console.log(
    chalk.green(
      `  Default model set to ${MODEL_SPECS[choice as ModelChoice].label}`
    )
  );
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
            { name: "Default Model", value: "model" },
            { name: "Anthropic API Key", value: "anthropic" },
            { name: "OpenAI API Key", value: "openai" },
            { name: "Gemini API Key", value: "gemini" },
            { name: "Show status", value: "status" },
            { name: "Exit", value: "exit" },
          ],
        });

        switch (choice) {
          case "model":
            await handleDefaultModelSetup();
            break;
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

// Upgrade command
program
  .command("upgrade")
  .description("Upgrade lgtm to the latest version")
  .option("--canary", "Switch to canary (bleeding edge) builds")
  .option("--stable", "Switch to stable builds")
  .action(async (options) => {
    const { spawn } = await import("child_process");
    const spinner = ora();

    // Determine which track to use
    let useCanary = IS_CANARY;

    if (options.canary && options.stable) {
      console.error(chalk.red("Cannot specify both --canary and --stable"));
      process.exit(1);
    }

    if (options.canary) {
      useCanary = true;
    } else if (options.stable) {
      useCanary = false;
    }

    const buildType = useCanary ? "canary" : "stable";
    const currentBuildType = getBuildType();

    console.log();
    console.log(chalk.bold.magenta("  ⬆  lgtm upgrade"));
    console.log();

    // Show current version info
    console.log(chalk.dim("  Current version"));
    console.log(`  ${getVersionString()} (${currentBuildType})`);
    if (IS_CANARY && COMMIT_SHA) {
      console.log(chalk.dim(`  Commit: ${COMMIT_SHA}`));
    }
    console.log();

    if (currentBuildType !== buildType) {
      console.log(
        chalk.yellow(
          `  Switching from ${currentBuildType} to ${buildType} track`
        )
      );
      console.log();
    }

    spinner.start(`Fetching latest ${buildType} release...`);

    const installScript = useCanary
      ? "https://raw.githubusercontent.com/jamierumbelow/lgtm/master/install-canary.sh"
      : "https://raw.githubusercontent.com/jamierumbelow/lgtm/master/install.sh";

    try {
      // Use curl to fetch and bash to execute the install script
      const child = spawn(
        "bash",
        ["-c", `curl -fsSL "${installScript}" | bash`],
        {
          stdio: "inherit",
          env: { ...process.env },
        }
      );

      await new Promise<void>((resolve, reject) => {
        child.on("close", (code) => {
          if (code === 0) {
            spinner.stop();
            resolve();
          } else {
            spinner.fail("Upgrade failed");
            reject(new Error(`Install script exited with code ${code}`));
          }
        });
        child.on("error", (err) => {
          spinner.fail("Upgrade failed");
          reject(err);
        });
      });
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
      }
      process.exit(1);
    }
  });

// Version command
program
  .command("version")
  .description("Show detailed version information")
  .action(() => {
    console.log();
    console.log(chalk.bold.magenta("  lgtm"));
    console.log();
    console.log(`  Version:    ${getVersionString()}`);
    console.log(`  Build:      ${getBuildType()}`);
    if (IS_CANARY && COMMIT_SHA) {
      console.log(`  Commit:     ${COMMIT_SHA}`);
    }
    if (BUILD_DATE) {
      console.log(`  Built:      ${BUILD_DATE}`);
    }
    console.log();
  });

// Main review command
program
  .argument(
    "[target]",
    "PR URL, branch, SHA, or diff range (e.g., main...feature, abc123)"
  )
  .option(
    "-b, --base <branch>",
    "Base branch for local comparison (default: auto-detect)"
  )
  .option("-h, --head <branch>", "Head branch for local comparison")
  .option("-f, --format <format>", "Output format: md, json, html", "html")
  .option(
    "-o, --output <file>",
    "Output file (defaults to stdout for md/json, server for html)"
  )
  .option("-p, --port <port>", "Port for HTML server", "24601")
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
  .option("--no-llm", "Skip LLM-powered analysis")
  .option(
    "-m, --model <model>",
    "LLM model: claude-sonnet-4.5, claude-opus-4.5, claude-opus-4.6, gpt-5.2, gpt-5.3-codex, gemini-3-flash, claude-code, codex"
  )
  .option("--verbose", "Enable verbose logging")
  .option("--fresh", "Bypass cache and fetch fresh data")
  .option(
    "--keep-alive",
    "Keep server running even after browser tab is closed"
  )
  .action(async (target, options) => {
    const spinner = ora();
    const generationStartedAt = Date.now();
    resetLLMUsage();

    try {
      // Validate model option
      const validModels = Object.values(ModelChoice);
      let selectedModel = options.model
        ? (validModels.find((m) => m === options.model) as
            | ModelChoice
            | undefined)
        : undefined;
      if (options.model && !selectedModel) {
        console.error(
          chalk.red(
            `Invalid model "${
              options.model
            }". Valid options: ${validModels.join(", ")}`
          )
        );
        process.exit(1);
      }

      // First-run setup: if no model was passed via -m, no default is
      // configured, and LLM is enabled, prompt the user to pick one.
      if (!selectedModel && !getUserDefaultModel() && options.llm !== false) {
        console.log();
        console.log(chalk.bold.magenta("  Welcome to lgtm!"));
        console.log(
          chalk.dim("  Before we begin, let's pick a default model.\n")
        );

        await handleDefaultModelSetup();

        // Re-check — if they still haven't picked one (hit "Back"), bail out
        if (!getUserDefaultModel()) {
          console.error(
            chalk.red(
              "No default model configured. Run `lgtm config` or pass `-m <model>`."
            )
          );
          process.exit(1);
        }

        console.log();
      }

      // Determine if this is a PR URL (for caching purposes)
      const parsedTarget = target ? parseTarget(target) : null;
      const isPrUrl = parsedTarget?.type === "pr";

      // For PR URLs, we know the cache key upfront
      // For local diffs, we include a hash of working directory changes if applicable
      const getCacheKeyForLocal = (
        base: string,
        head: string,
        isWorkingDir: boolean
      ) => {
        if (isWorkingDir) {
          // Include hash of working directory diff to invalidate cache when changes change
          const diffHash = getWorkingDirDiffHash(base);
          return `local:${base}...${head}:${diffHash}`;
        }
        return `local:${base}...${head}`;
      };

      // Helper to detect if this will be a working directory diff
      const willBeWorkingDirDiff = (base: string, head: string): boolean => {
        return refsAreSame(base, head) && hasUncommittedChanges();
      };

      let cacheKey: string | null = isPrUrl ? parsedTarget!.prUrl! : null;

      // Try to compute a preliminary cache key for local diffs
      if (
        !isPrUrl &&
        parsedTarget?.type === "local" &&
        parsedTarget.base &&
        parsedTarget.head
      ) {
        const isWorkingDir = willBeWorkingDirDiff(
          parsedTarget.base,
          parsedTarget.head
        );
        cacheKey = getCacheKeyForLocal(
          parsedTarget.base,
          parsedTarget.head,
          isWorkingDir
        );
      } else if (!isPrUrl && !target && isGitRepository()) {
        // No target - will use current branch or working directory
        const currentBranch = getCurrentBranch();
        const defaultBranch = getDefaultBranch();
        if (currentBranch && currentBranch !== defaultBranch) {
          const isWorkingDir = willBeWorkingDirDiff(
            defaultBranch,
            currentBranch
          );
          cacheKey = getCacheKeyForLocal(
            defaultBranch,
            currentBranch,
            isWorkingDir
          );
        } else if (currentBranch && hasUncommittedChanges()) {
          cacheKey = getCacheKeyForLocal(
            defaultBranch,
            "(working directory)",
            true
          );
        }
      }

      let prData: Awaited<ReturnType<typeof getPRData>> | undefined;
      let analysis: Awaited<ReturnType<typeof analyzeChanges>> | undefined;

      // Check cache
      if (cacheKey && !options.fresh) {
        const cached = getCached(cacheKey);
        if (cached) {
          const cacheInfo = getCacheInfo(cacheKey);
          spinner.succeed(
            `Using cached analysis from ${
              cacheInfo.timestamp?.toLocaleString() || "cache"
            }`
          );
          prData = cached.prData;

          spinner.start("Checking for missing analysis...");
          let currentStep = "Checking for missing analysis...";
          const updateSpinnerTokens = () => {
            const tokens = getFormattedRunningTotal();
            spinner.text = `${currentStep} ${chalk.gray(`(${tokens} tokens)`)}`;
          };
          const unsubscribe = onUsageUpdated(updateSpinnerTokens);
          const updateResult = await ensureAnalysis(
            prData,
            {
              useLLM: options.llm !== false,
              includeTraces: options.findTraces,
              verbose: options.verbose,
              model: selectedModel,
              onStepProgress: (info) => {
                currentStep = info.step;
                updateSpinnerTokens();
              },
              onChangesetsCreated: (count) => {
                spinner.succeed(
                  `Reviewed ${count} changeset${count === 1 ? "" : "s"}`
                );
              },
            },
            cached.analysis
          );
          unsubscribe();
          analysis = updateResult.analysis;
          if (updateResult.updated) {
            const finalTokens = getFormattedRunningTotal();
            spinner.succeed(`Updated cached analysis (${finalTokens} tokens)`);
          } else {
            spinner.succeed("Cache is up to date");
          }
          if (cacheKey && updateResult.updated) {
            setCache(cacheKey, prData, analysis);
          }
          if (options.findTraces && updateResult.missing.needsTraces) {
            spinner.start("Searching for LLM session traces...");
            const traces = await findTraces(prData.files, {
              claudeDir: options.claudeDir,
              cursorDir: options.cursorDir,
            });
            analysis.traces = traces;
            spinner.succeed(`Found ${traces.length} potential session traces`);
            if (cacheKey) setCache(cacheKey, prData, analysis);
          }
        }
      }

      // Clear cache if --fresh
      if (options.fresh) {
        if (cacheKey) clearCache(cacheKey);
        clearPromptCache();
      }

      // Fetch and analyze if not cached
      if (!analysis) {
        // Fetch PR/diff data
        const isLocalDiff = !isPrUrl;
        spinner.start(
          isLocalDiff ? "Analyzing local diff..." : "Fetching PR data..."
        );
        prData = await getPRData(target, options);

        // Compute cache key for local diffs if we couldn't determine it upfront
        if (!cacheKey && isLocalDiff) {
          const isWorkingDir = prData.headBranch === "(working directory)";
          cacheKey = getCacheKeyForLocal(
            prData.baseBranch,
            prData.headBranch,
            isWorkingDir
          );
        }

        // Build a descriptive title for the spinner
        const diffDescription = prData.title
          ? prData.title
          : `${prData.baseBranch}...${prData.headBranch}`;
        spinner.succeed(
          isLocalDiff
            ? `Local diff: ${diffDescription}`
            : `Fetched PR: ${diffDescription}`
        );

        // Analyze changes (single LLM call + parallel blame)
        spinner.start("Reviewing changes (single-pass)...");
        let currentStep = "Reviewing changes (single-pass)...";
        const updateSpinnerTokens = () => {
          const tokens = getFormattedRunningTotal();
          spinner.text = `${currentStep} ${chalk.gray(`(${tokens} tokens)`)}`;
        };
        const unsubscribe = onUsageUpdated(updateSpinnerTokens);
        analysis = await analyzeChanges(prData, {
          useLLM: options.llm !== false,
          verbose: options.verbose,
          model: selectedModel,
          onStepProgress: (info) => {
            currentStep = info.step;
            updateSpinnerTokens();
          },
          onChangesetsCreated: (count) => {
            spinner.succeed(
              `Reviewed ${count} changeset${count === 1 ? "" : "s"} across ${
                analysis?.filesChanged ?? prData!.files.length
              } files`
            );
          },
        });
        unsubscribe();
        const finalTokens = getFormattedRunningTotal();
        spinner.succeed(
          `Analyzed ${analysis.changeGroups.length} changeset${
            analysis.changeGroups.length === 1 ? "" : "s"
          } across ${analysis.filesChanged} files (${finalTokens} tokens)`
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

        // Cache the results
        if (cacheKey) {
          setCache(cacheKey, prData, analysis);
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
            // Generate a stable UUID for this report
            const reportId = randomUUID();
            const basePort = parseInt(options.port, 10);

            // Find an available port, incrementing if in use
            const findAvailablePort = (port: number): Promise<number> =>
              new Promise((resolve) => {
                const server = createNetServer();
                server.once("error", () =>
                  resolve(findAvailablePort(port + 1))
                );
                server.listen(port, () => server.close(() => resolve(port)));
              });

            const port = await findAvailablePort(basePort);
            const reportUrl = `http://localhost:${port}/report/${reportId}`;

            const autoClose = !options.keepAlive;

            console.log(chalk.cyan(`\n✨ Starting server at ${reportUrl}`));
            console.log(chalk.gray("Use ← → or j k to navigate"));
            if (autoClose) {
              console.log(
                chalk.gray(
                  "Server will stop when browser tab is closed (use --keep-alive to disable)\n"
                )
              );
            } else {
              console.log(chalk.gray("Press Ctrl+C to stop\n"));
            }

            // Inject client-side heartbeat script if auto-close is enabled
            const servedHtml = autoClose
              ? html.replace(
                  "</body>",
                  `<script>
(function() {
  setInterval(function() {
    fetch('/heartbeat', { method: 'POST' }).catch(function() {});
  }, 2000);
  window.addEventListener('beforeunload', function() {
    navigator.sendBeacon('/close');
  });
})();
</script>
</body>`
                )
              : html;

            // Heartbeat tracking for auto-close
            let lastHeartbeat = 0;
            let heartbeatReceived = false;
            let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

            // Start the server
            let cleanup: () => void;

            // Handle Ctrl+C gracefully
            const shutdown = () => {
              if (heartbeatTimer) clearInterval(heartbeatTimer);
              console.log(chalk.gray("\n\nShutting down server..."));
              cleanup();
              process.exit(0);
            };

            // Route handler shared between Bun and Node
            const isHeartbeat = (pathname: string) =>
              autoClose && pathname === "/heartbeat";
            const isClose = (pathname: string) =>
              autoClose && pathname === "/close";
            const handleHeartbeat = () => {
              lastHeartbeat = Date.now();
              if (!heartbeatReceived) {
                heartbeatReceived = true;
                // Start checking for heartbeat timeout
                heartbeatTimer = setInterval(() => {
                  if (Date.now() - lastHeartbeat > 5000) {
                    shutdown();
                  }
                }, 3000);
              }
            };

            if (typeof Bun !== "undefined" && Bun.serve) {
              const server = Bun.serve({
                port,
                fetch(req: Request) {
                  const url = new URL(req.url);
                  if (url.pathname === `/report/${reportId}`) {
                    return new Response(servedHtml, {
                      headers: { "Content-Type": "text/html" },
                    });
                  }
                  if (isHeartbeat(url.pathname)) {
                    handleHeartbeat();
                    return new Response("ok", { status: 200 });
                  }
                  if (isClose(url.pathname)) {
                    setTimeout(shutdown, 100);
                    return new Response("ok", { status: 200 });
                  }
                  // Redirect root to the report URL
                  if (url.pathname === "/") {
                    return Response.redirect(reportUrl, 302);
                  }
                  return new Response("Not Found", { status: 404 });
                },
              });

              cleanup = () => server.stop();

              // Open the browser
              const openCommand =
                process.platform === "darwin"
                  ? "open"
                  : process.platform === "win32"
                  ? "start"
                  : "xdg-open";
              Bun.spawn([openCommand, reportUrl]);
            } else {
              const server = createServer((req, res) => {
                const url = new URL(req.url!, `http://localhost:${port}`);
                if (url.pathname === `/report/${reportId}`) {
                  res.writeHead(200, { "Content-Type": "text/html" });
                  res.end(servedHtml);
                } else if (isHeartbeat(url.pathname)) {
                  handleHeartbeat();
                  res.writeHead(200);
                  res.end("ok");
                } else if (isClose(url.pathname)) {
                  res.writeHead(200);
                  res.end("ok");
                  setTimeout(shutdown, 100);
                } else if (url.pathname === "/") {
                  res.writeHead(302, { Location: reportUrl });
                  res.end();
                } else {
                  res.writeHead(404);
                  res.end("Not Found");
                }
              });
              server.listen(port);

              cleanup = () => server.close();

              // Open the browser using child_process for Node
              const { spawn } = await import("child_process");
              const openCommand =
                process.platform === "darwin"
                  ? "open"
                  : process.platform === "win32"
                  ? "start"
                  : "xdg-open";
              spawn(openCommand, [reportUrl], {
                detached: true,
                stdio: "ignore",
              });
            }

            process.on("SIGINT", shutdown);
            process.on("SIGTERM", shutdown);

            // Also listen for stdin close (backup for signal issues)
            if (process.stdin.isTTY) {
              process.stdin.setRawMode(true);
              process.stdin.resume();
              process.stdin.on("data", (data) => {
                // Ctrl+C is 0x03
                if (data[0] === 0x03) {
                  shutdown();
                }
              });
            }

            // Keep the process alive until signal
            await new Promise(() => {});
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
      if (
        error instanceof Error &&
        error.message.includes("User force closed")
      ) {
        spinner.stop();
        console.log();
        process.exit(0);
      }
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
