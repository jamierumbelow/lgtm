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
import { randomUUID } from "crypto";
import { setAnthropicApiKey, deleteAnthropicApiKey, hasAnthropicApiKey, setOpenAIApiKey, deleteOpenAIApiKey, hasOpenAIApiKey, setGoogleApiKey, deleteGoogleApiKey, hasGoogleApiKey, } from "./secrets.js";
import { select, password, confirm } from "@inquirer/prompts";
import { getCached, setCache, clearCache, getCacheInfo } from "./cache.js";
import { getLLMUsageRecords, getLLMUsageTotals, resetLLMUsage, getFormattedRunningTotal, } from "./llm/usage.js";
import { calculateTokenlensCost } from "./llm/tokenlens.js";
import { ModelChoice } from "./config.js";
import { getVersionString, getBuildType, IS_CANARY, COMMIT_SHA } from "./version.js";
const program = new Command();
program
    .name("lgtm")
    .description('Structured PR review companion - because "lgtm" should mean something')
    .version(getVersionString());
// Helper functions for config TUI
const getStatusIcon = (hasKey, hasEnvKey) => {
    if (hasEnvKey)
        return chalk.cyan("●");
    if (hasKey)
        return chalk.green("●");
    return chalk.dim("○");
};
const getStatusText = (hasKey, hasEnvKey) => {
    if (hasEnvKey)
        return chalk.cyan("(env)");
    if (hasKey)
        return chalk.green("(keychain)");
    return chalk.dim("(not set)");
};
const printStatus = async () => {
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
    console.log(`  ${getStatusIcon(hasAnthropic, hasAnthropicEnv)} Anthropic  ${getStatusText(hasAnthropic, hasAnthropicEnv)}`);
    console.log(`  ${getStatusIcon(hasOpenAI, hasOpenAIEnv)} OpenAI     ${getStatusText(hasOpenAI, hasOpenAIEnv)}`);
    console.log(`  ${getStatusIcon(hasGoogle, hasGoogleEnv)} Gemini     ${getStatusText(hasGoogle, hasGoogleEnv)}`);
    console.log();
};
const handleApiKeySetup = async (provider, setKey, deleteKey, hasKey) => {
    const exists = await hasKey();
    const action = await select({
        message: `${provider} API Key`,
        choices: [
            { name: exists ? "Update key" : "Set key", value: "set" },
            ...(exists ? [{ name: "Remove key", value: "delete" }] : []),
            { name: "Back", value: "back" },
        ],
    });
    if (action === "back")
        return;
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
            }
            else {
                spinner.info("No key was stored");
            }
        }
        return;
    }
    const apiKey = await password({
        message: `Enter your ${provider} API key:`,
        mask: "•",
        validate: (value) => {
            if (!value.trim())
                return "API key cannot be empty";
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
                    await handleApiKeySetup("Anthropic", setAnthropicApiKey, deleteAnthropicApiKey, hasAnthropicApiKey);
                    break;
                case "openai":
                    await handleApiKeySetup("OpenAI", setOpenAIApiKey, deleteOpenAIApiKey, hasOpenAIApiKey);
                    break;
                case "gemini":
                    await handleApiKeySetup("Gemini", setGoogleApiKey, deleteGoogleApiKey, hasGoogleApiKey);
                    break;
                case "status":
                    await printStatus();
                    break;
                case "exit":
                    running = false;
                    break;
            }
        }
        catch (error) {
            // User pressed Ctrl+C
            if (error instanceof Error &&
                error.message.includes("User force closed")) {
                running = false;
            }
            else {
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
    }
    else if (options.stable) {
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
        console.log(chalk.yellow(`  Switching from ${currentBuildType} to ${buildType} track`));
        console.log();
    }
    spinner.start(`Fetching latest ${buildType} release...`);
    const installScript = useCanary
        ? "https://raw.githubusercontent.com/jamierumbelow/lgtm/master/install-canary.sh"
        : "https://raw.githubusercontent.com/jamierumbelow/lgtm/master/install.sh";
    try {
        // Use curl to fetch and bash to execute the install script
        const child = spawn("bash", ["-c", `curl -fsSL "${installScript}" | bash`], {
            stdio: "inherit",
            env: { ...process.env },
        });
        await new Promise((resolve, reject) => {
            child.on("close", (code) => {
                if (code === 0) {
                    spinner.stop();
                    resolve();
                }
                else {
                    spinner.fail("Upgrade failed");
                    reject(new Error(`Install script exited with code ${code}`));
                }
            });
            child.on("error", (err) => {
                spinner.fail("Upgrade failed");
                reject(err);
            });
        });
    }
    catch (error) {
        if (error instanceof Error) {
            console.error(chalk.red(error.message));
        }
        process.exit(1);
    }
});
// Main review command
program
    .argument("[pr-url]", "GitHub PR URL (e.g., https://github.com/org/repo/pull/123)")
    .option("-b, --base <branch>", "Base branch for local comparison", "main")
    .option("-h, --head <branch>", "Head branch for local comparison")
    .option("-f, --format <format>", "Output format: md, json, html", "md")
    .option("-o, --output <file>", "Output file (defaults to stdout for md/json, server for html)")
    .option("-p, --port <port>", "Port for HTML server", "3000")
    .option("--find-traces", "Attempt to find LLM session traces that generated the changes")
    .option("--claude-dir <path>", "Path to Claude Code history directory", "~/.claude")
    .option("--cursor-dir <path>", "Path to Cursor history directory")
    .option("--no-llm", "Skip LLM-powered analysis (descriptions, questions)")
    .option("-m, --model <model>", "LLM model: claude-sonnet-4.5, claude-opus-4.5, gpt-5.2, gemini-3-flash")
    .option("--verbose", "Enable verbose logging")
    .option("--fresh", "Bypass cache and fetch fresh data")
    .action(async (prUrl, options) => {
    const spinner = ora();
    const generationStartedAt = Date.now();
    resetLLMUsage();
    try {
        // Validate model option
        const validModels = Object.values(ModelChoice);
        const selectedModel = options.model
            ? validModels.find((m) => m === options.model)
            : undefined;
        if (options.model && !selectedModel) {
            console.error(chalk.red(`Invalid model "${options.model}". Valid options: ${validModels.join(", ")}`));
            process.exit(1);
        }
        // Determine source: PR URL or local branches
        if (!prUrl && !options.head) {
            console.error(chalk.red("Error: Provide a PR URL or use --head to specify a branch"));
            process.exit(1);
        }
        let prData;
        let analysis;
        // Check cache for PR URLs (not local branches)
        if (prUrl && !options.fresh) {
            const cached = getCached(prUrl);
            if (cached) {
                const cacheInfo = getCacheInfo(prUrl);
                spinner.succeed(`Using cached analysis from ${cacheInfo.timestamp?.toLocaleString() || "cache"}`);
                prData = cached.prData;
                const updateSpinnerWithProgress = (info) => {
                    const tokens = getFormattedRunningTotal();
                    spinner.text = `${info.step} (${info.current}/${info.total}) (${tokens} tokens)`;
                };
                spinner.start("Checking for missing analysis...");
                const updateResult = await ensureAnalysis(prData, {
                    useLLM: options.llm !== false,
                    includeTraces: options.findTraces,
                    verbose: options.verbose,
                    model: selectedModel,
                    onProgress: prUrl
                        ? (partialAnalysis) => setCache(prUrl, prData, partialAnalysis)
                        : undefined,
                    onStepProgress: updateSpinnerWithProgress,
                }, cached.analysis);
                analysis = updateResult.analysis;
                if (updateResult.updated) {
                    const finalTokens = getFormattedRunningTotal();
                    spinner.succeed(`Updated cached analysis (${finalTokens} tokens)`);
                }
                else {
                    spinner.succeed("Cache is up to date");
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
            const updateSpinnerWithProgress = (info) => {
                const tokens = getFormattedRunningTotal();
                spinner.text = `${info.step} (${info.current}/${info.total}) (${tokens} tokens)`;
            };
            spinner.start("Analyzing changes...");
            analysis = await analyzeChanges(prData, {
                useLLM: options.llm !== false,
                verbose: options.verbose,
                model: selectedModel,
                onProgress: prUrl
                    ? (partialAnalysis) => setCache(prUrl, prData, partialAnalysis)
                    : undefined,
                onStepProgress: updateSpinnerWithProgress,
            });
            const finalTokens = getFormattedRunningTotal();
            spinner.succeed(`Analyzed ${analysis.changeGroups.length} change groups across ${analysis.filesChanged} files (${finalTokens} tokens)`);
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
        const tokenlensCost = await calculateTokenlensCost(usageRecords, options.verbose ? console.warn : undefined);
        if (usageTotals.tokenCount > 0) {
            analysis.tokenCount = usageTotals.tokenCount;
        }
        if (tokenlensCost !== undefined) {
            analysis.costUsd = tokenlensCost;
        }
        else if (usageTotals.costUsd > 0) {
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
                }
                else {
                    // Generate a stable UUID for this report
                    const reportId = randomUUID();
                    const port = parseInt(options.port, 10);
                    const reportUrl = `http://localhost:${port}/report/${reportId}`;
                    console.log(chalk.cyan(`\n✨ Starting server at ${reportUrl}`));
                    console.log(chalk.gray("Use Overview/Review toggle to switch modes"));
                    console.log(chalk.gray("In Review mode: ← → or j k to navigate, Esc to exit"));
                    console.log(chalk.gray("Press Ctrl+C to stop\n"));
                    // Start the server
                    if (typeof Bun !== "undefined" && Bun.serve) {
                        Bun.serve({
                            port,
                            fetch(req) {
                                const url = new URL(req.url);
                                if (url.pathname === `/report/${reportId}`) {
                                    return new Response(html, {
                                        headers: { "Content-Type": "text/html" },
                                    });
                                }
                                // Redirect root to the report URL
                                if (url.pathname === "/") {
                                    return Response.redirect(reportUrl, 302);
                                }
                                return new Response("Not Found", { status: 404 });
                            },
                        });
                        // Open the browser
                        const openCommand = process.platform === "darwin"
                            ? "open"
                            : process.platform === "win32"
                                ? "start"
                                : "xdg-open";
                        Bun.spawn([openCommand, reportUrl]);
                    }
                    else {
                        const server = createServer((req, res) => {
                            const url = new URL(req.url, `http://localhost:${port}`);
                            if (url.pathname === `/report/${reportId}`) {
                                res.writeHead(200, { "Content-Type": "text/html" });
                                res.end(html);
                            }
                            else if (url.pathname === "/") {
                                res.writeHead(302, { Location: reportUrl });
                                res.end();
                            }
                            else {
                                res.writeHead(404);
                                res.end("Not Found");
                            }
                        });
                        server.listen(port);
                        // Open the browser using child_process for Node
                        const { spawn } = await import("child_process");
                        const openCommand = process.platform === "darwin"
                            ? "open"
                            : process.platform === "win32"
                                ? "start"
                                : "xdg-open";
                        spawn(openCommand, [reportUrl], {
                            detached: true,
                            stdio: "ignore",
                        });
                    }
                    await new Promise(() => { }); // Keep running until interrupted
                }
                break;
            }
            case "json": {
                const output = renderJSON(analysis);
                spinner.succeed("Review generated");
                if (options.output) {
                    writeFileSync(options.output, output);
                    console.log(chalk.green(`\n✓ Review written to ${options.output}`));
                }
                else {
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
                }
                else {
                    console.log("\n" + output);
                }
            }
        }
    }
    catch (error) {
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
