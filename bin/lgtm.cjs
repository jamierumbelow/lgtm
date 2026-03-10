#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const { join, dirname } = require("path");
const { platform, arch } = require("os");

const PLATFORMS = {
  "darwin-arm64": "@jamierumbelow/lgtm-darwin-arm64",
};

const platformKey = `${platform()}-${arch()}`;
const pkg = PLATFORMS[platformKey];

if (!pkg) {
  console.error(
    `Error: Unsupported platform ${platformKey}.\n` +
      `lgtm currently supports: ${Object.keys(PLATFORMS).join(", ")}`
  );
  process.exit(1);
}

let binPath;
try {
  const pkgRoot = dirname(require.resolve(`${pkg}/package.json`));
  binPath = join(pkgRoot, "bin", "lgtm");
} catch {
  console.error(
    `Error: Could not find the lgtm binary for ${platformKey}.\n` +
      `The package ${pkg} should have been installed as an optional dependency.\n` +
      `Try reinstalling: npm install @jamierumbelow/lgtm`
  );
  process.exit(1);
}

const promptsDir = join(__dirname, "..", "prompts");

try {
  execFileSync(binPath, process.argv.slice(2), {
    stdio: "inherit",
    env: { ...process.env, LGTM_PROMPTS_DIR: promptsDir },
  });
} catch (e) {
  if (e.status !== undefined) {
    process.exit(e.status);
  }
  throw e;
}
