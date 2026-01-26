# lgtm

> Structured PR review companion — because "lgtm" should mean something

`lgtm` takes a GitHub PR (or local branch diff) and generates a structured review that breaks down changes into semantic groups, asks the questions that matter, and even tries to find the AI coding sessions that generated the code.

## Installation

### Quick Install (macOS)

Make sure you have the GitHub CLI installed and authenticated:

```bash
brew install gh
gh auth login
```

Then run the installer:

```bash
gh api -H "Accept: application/vnd.github.raw" repos/jamierumbelow/lgtm/contents/install.sh | bash
```

This uses your GitHub CLI authentication to fetch the installer and download the latest release binary to `/usr/local/bin`.

### Canary Builds

To install the latest build from master (may be unstable):

```bash
gh api -H "Accept: application/vnd.github.raw" repos/jamierumbelow/lgtm/contents/install-canary.sh | bash
```

### Manual Installation

Download the appropriate binary from [Releases](https://github.com/jamierumbelow/lgtm/releases):

| Platform | Architecture             | Binary                 |
| -------- | ------------------------ | ---------------------- |
| macOS    | Apple Silicon (M1/M2/M3) | `lgtm-darwin-arm64`    |
| macOS    | Intel                    | `lgtm-darwin-x64`      |
| Linux    | x64                      | `lgtm-linux-x64`       |
| Linux    | ARM64                    | `lgtm-linux-arm64`     |
| Windows  | x64                      | `lgtm-windows-x64.exe` |

Then make it executable and move to your PATH:

```bash
chmod +x lgtm-darwin-arm64
sudo mv lgtm-darwin-arm64 /usr/local/bin/lgtm
```

### Requirements

- [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated

### API Key Setup

`lgtm` uses LLMs to generate detailed analysis. Configure your API key(s) using the interactive config:

```bash
lgtm config
```

This stores keys securely in your system keychain. Alternatively, set environment variables:

- `ANTHROPIC_API_KEY` for Claude models
- `OPENAI_API_KEY` for GPT models
- `GOOGLE_GENERATIVE_AI_API_KEY` for Gemini models

## Usage

```bash
# Review a GitHub PR
lgtm https://github.com/org/repo/pull/123

# Review a local branch diff (auto-detects base from current branch)
lgtm

# Review specific branches
lgtm --base main --head feature/my-branch
lgtm main...feature/my-branch

# Output formats
lgtm <target> --format html         # default, opens in browser
lgtm <target> --format md           # markdown to stdout
lgtm <target> --format json | jq '.changeGroups[]'

# Save to file instead of stdout/browser
lgtm <target> --format html -o review.html
lgtm <target> --format md -o review.md

# Hunt for LLM traces
lgtm <target> --find-traces --claude-dir ~/.claude

# Choose LLM model
lgtm <target> -m claude-opus-4.5
lgtm <target> -m gpt-5.2
lgtm <target> -m gemini-3-flash

# Skip LLM analysis (faster, less detailed)
lgtm <target> --no-llm

# Bypass cache
lgtm <target> --fresh
```

### Commands

```bash
lgtm config               # Configure API keys (Anthropic, OpenAI, Gemini)
lgtm upgrade              # Upgrade to latest version
lgtm upgrade --canary     # Switch to canary (bleeding edge) builds
lgtm upgrade --stable     # Switch to stable builds
lgtm version              # Show detailed version information
```

### Options

| Option                  | Description                                                                    |
| ----------------------- | ------------------------------------------------------------------------------ |
| `-b, --base <branch>`   | Base branch for local comparison (auto-detected by default)                    |
| `-h, --head <branch>`   | Head branch for local comparison                                               |
| `-f, --format <format>` | Output format: `html` (default), `md`, `json`                                  |
| `-o, --output <file>`   | Output file (defaults to browser for html, stdout for md/json)                 |
| `-p, --port <port>`     | Port for HTML server (default: 3000)                                           |
| `-m, --model <model>`   | LLM model: `claude-sonnet-4.5`, `claude-opus-4.5`, `gpt-5.2`, `gemini-3-flash` |
| `--no-llm`              | Skip LLM-powered analysis                                                      |
| `--find-traces`         | Find LLM session traces that generated the changes                             |
| `--claude-dir <path>`   | Path to Claude Code history (default: `~/.claude`)                             |
| `--cursor-dir <path>`   | Path to Cursor history directory                                               |
| `--fresh`               | Bypass cache and fetch fresh data                                              |
| `--verbose`             | Enable verbose logging                                                         |

## What it does

### 1. Semantic Change Grouping

Instead of just showing file-by-file diffs, `lgtm` groups changes by logical unit:

- Changes to the same function across multiple files
- Related test and implementation changes
- Configuration updates

### 2. Standard Review Questions

Every review answers a consistent set of questions:

- **Failure modes:** What can go wrong? What's already handled?
- **Input domain:** What inputs does this code accept?
- **Output range:** What outputs can it produce?
- **External dependencies:** What systems outside this codebase does it rely on?
- **Decomposition:** Can this PR be split into smaller ones?
- **New symbols:** What functions/classes/types does it introduce?
- **Duplication:** Does it duplicate existing code?
- **Abstractions:** Do the design choices make sense?
- **Context owners:** Who has worked on these files before?

### 3. LLM Trace Finder

When you use `--find-traces`, `lgtm` searches for AI coding sessions that might have generated the changes:

- Claude Code history (default: `~/.claude/projects/`, customize with `--claude-dir`)
- Cursor history (specify with `--cursor-dir`)

This helps answer "what was the AI told to do?" — useful for understanding intent behind generated code.

### 4. Suggested Reviewers

Based on `git blame` and PR review history, `lgtm` suggests who might have context to review the changes.

## Output Formats

### HTML (default)

A static, self-contained webpage that opens in your browser with:

- Sidebar navigation
- Collapsible sections
- Keyboard navigation (← → or j k)
- Dark mode (GitHub-style)

### Markdown

Clean, readable markdown suitable for pasting into a PR comment or wiki.

```bash
lgtm <target> --format md
```

### JSON

Machine-readable output for integrating with other tools:

```bash
lgtm <target> --format json | jq '.questions[] | select(.id == "failure-modes")'
```

## Development

```bash
git clone https://github.com/jamierumbelow/lgtm
cd lgtm
bun install
bun run dev https://github.com/org/repo/pull/123
```

### Global Dev Command

To install a global `lgtm` command that runs the local source code:

```bash
./install-dev.sh
```

This creates a wrapper at `/usr/local/bin/lgtm` that runs `bun src/cli.ts`. Any changes you make to the source are immediately reflected.

## Roadmap

- [ ] Tree-sitter integration for better semantic grouping
- [x] LLM-powered descriptions and question answers
- [x] Cursor history support (partial - use `--cursor-dir`)
- [ ] GitHub Action for automated PR reviews
- [ ] VSCode extension

## License

MIT
