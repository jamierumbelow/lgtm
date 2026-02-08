import {
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import chalk from "chalk";
import ora from "ora";

// --- Skill content (Agent Skills spec: https://agentskills.io/specification) ---

const SKILL_MD = `---
name: lgtm
description: Structured code review tool — self-review changes before committing or submitting PRs.
---

# lgtm – Structured Code Review Tool

You have access to \`lgtm\`, a CLI tool that generates structured reviews of code changes.
Use it to self-review your work before committing or submitting PRs.

## Quick Usage

\`\`\`bash
# Review current branch vs default branch (markdown, for reading inline)
lgtm --format md

# Review current branch vs default branch (JSON, for programmatic parsing)
lgtm --format json

# Review a specific branch comparison
lgtm --base main --format md

# Review a GitHub PR
lgtm https://github.com/org/repo/pull/123 --format md

# Write output to a file
lgtm --format md -o review.md
\`\`\`

## When to Use

- **Before committing**: run \`lgtm --format md\` to self-review your changes and catch issues early.
- **When debugging failures**: check if the review identifies failure modes or risks you missed.
- **When refactoring**: verify the review doesn't flag architectural concerns.
- **After a large change**: get a structured summary of what changed and why it matters.

## Output Formats

- \`--format md\` – Markdown. Good for reading inline or including in PR descriptions.
- \`--format json\` – JSON. Good for programmatic parsing (e.g. extracting risk levels, suggestions).
- Both write to stdout by default. Use \`-o <file>\` to write to a file.

## What the Review Covers

Each review includes:
- **Executive summary** of the overall change
- **Semantic change groups** (related changes grouped together, not just file-by-file)
- **Risk levels** (low / medium / high) per changeset
- **Standard review questions**: failure modes, error handling, abstractions, testing gaps, security, performance
- **Actionable suggestions** for improvements

Use this to catch issues before they reach human reviewers.
`;

// --- Skill targets ---

interface SkillTarget {
  name: string;
  dir: string;
}

const TARGETS: SkillTarget[] = [
  { name: "Claude Code", dir: join(homedir(), ".claude", "skills", "lgtm") },
  { name: "Codex", dir: join(homedir(), ".codex", "skills", "lgtm") },
];

const skillPath = (target: SkillTarget): string =>
  join(target.dir, "SKILL.md");

const prettyPath = (p: string): string => p.replace(homedir(), "~");

// --- Install / Uninstall ---

const ensureDir = (dir: string): void => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

const installSkillTo = (
  target: SkillTarget
): { action: "created" | "updated" } => {
  ensureDir(target.dir);
  const file = skillPath(target);
  const existed = existsSync(file);
  writeFileSync(file, SKILL_MD);
  return { action: existed ? "updated" : "created" };
};

const uninstallSkillFrom = (target: SkillTarget): boolean => {
  const file = skillPath(target);
  if (!existsSync(file)) return false;
  rmSync(target.dir, { recursive: true, force: true });
  return true;
};

// --- CLI handlers ---

export const runInstallSkill = async (): Promise<void> => {
  console.log();
  console.log(chalk.bold.magenta("  📚 lgtm install-skill"));
  console.log();
  console.log(
    chalk.dim("  Installing lgtm skill into agent skill directories...\n")
  );

  const spinner = ora();

  for (const target of TARGETS) {
    spinner.start(`Installing skill for ${target.name}...`);
    try {
      const result = installSkillTo(target);
      const verb = result.action === "created" ? "Created" : "Updated";
      spinner.succeed(
        `${verb} ${chalk.cyan(prettyPath(skillPath(target)))}`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      spinner.fail(`Failed to install for ${target.name}: ${chalk.red(msg)}`);
    }
  }

  console.log();
  console.log(
    chalk.green("  ✓ ") +
      "Agents can now use " +
      chalk.cyan("lgtm --format md") +
      " or " +
      chalk.cyan("lgtm --format json") +
      " to self-review changes."
  );
  console.log();
};

export const runUninstallSkill = async (): Promise<void> => {
  console.log();
  console.log(chalk.bold.magenta("  📚 lgtm uninstall-skill"));
  console.log();

  const spinner = ora();

  for (const target of TARGETS) {
    const file = skillPath(target);
    if (!existsSync(file)) {
      spinner.info(
        `No skill found at ${chalk.cyan(prettyPath(file))}`
      );
      continue;
    }

    spinner.start(`Removing skill for ${target.name}...`);
    const removed = uninstallSkillFrom(target);
    if (removed) {
      spinner.succeed(
        `Removed ${chalk.cyan(prettyPath(target.dir))}`
      );
    } else {
      spinner.warn(`Could not remove ${chalk.cyan(prettyPath(file))}`);
    }
  }

  console.log();
};
