# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`lgtm` is a CLI tool that generates structured PR reviews using LLMs. It analyzes GitHub PRs or local branch diffs, groups changes semantically, answers standard review questions, and optionally traces changes back to AI coding sessions (Claude Code, Cursor).

**Key capabilities:**
- Semantic change grouping (not just file-by-file)
- Standard review questions (failure modes, abstractions, testing, etc.)
- Executive summary generation
- LLM trace finding (links changes to AI coding sessions)
- Multiple output formats (HTML, Markdown, JSON)
- Multi-LLM support (Anthropic, OpenAI, Google)

## Commands

### Development
```bash
# Install dependencies
bun install

# Run development version
bun run dev https://github.com/org/repo/pull/123
bun run dev                    # Review current branch
bun run dev --base main --head feature/my-branch

# Build TypeScript to dist/
bun run build

# Install global dev command (runs local source)
./install-dev.sh
```

### Testing & Quality
```bash
# Run tests
bun run test

# Lint
bun run lint
```

### Production Install
```bash
# Install stable release
./install.sh

# Install canary (latest master)
./install-canary.sh
```

## Architecture

### Core Pipeline

The main flow (in `src/cli.ts`) is:

1. **Input parsing** → Determine target (PR URL, branch, or local diff)
2. **Data fetching** (`src/github/pr.ts`) → Get PR data via GitHub CLI or local git
3. **Analysis** (`src/analysis/analyzer.ts`) → Orchestrate the review process
4. **Output** (`src/output/`) → Render as HTML, Markdown, or JSON

### Key Modules

#### `src/github/pr.ts`
- Fetches PR data from GitHub using `gh` CLI
- Handles local branch diffs using git commands
- Detects uncommitted changes
- Returns `PRData` interface with files, diff, metadata

#### `src/analysis/analyzer.ts`
- Main orchestration of review analysis
- Creates `Analysis` interface (the final output data structure)
- Coordinates between chunker, LLM reviewer, trace finder
- Manages progress callbacks
- Uses caching to speed up subsequent reviews

#### `src/analysis/chunker.ts`
- Parses unified diffs into structured `FileDiff` objects
- Groups related changes into `ChangeGroup` objects
- Extracts symbol information (functions/classes introduced or modified)
- Performs basic semantic grouping (can be enhanced by LLM)

#### `src/llm/client.ts`
- Abstraction over multiple LLM providers (Anthropic, OpenAI, Google)
- Loads prompts from `prompts/` directory
- Handles rate limiting, model fallback, prompt caching
- Records usage metrics via `src/llm/usage.ts`
- Supports model-specific prompt variants (e.g., `review.gemini.md`)

#### `src/llm/review.ts`
- Reviews individual changesets using LLMs
- Answers 11 standard review questions per changeset
- Filters irrelevant questions based on change type
- Returns structured `ReviewDiffResult` with risk level, verdict, suggestions

#### `src/analysis/trace-finder.ts`
- Searches Claude Code and Cursor history directories
- Matches file paths and content to find relevant AI sessions
- Returns `TraceMatch` objects linking changes to prompts

#### `src/output/html.ts`
- Generates a self-contained static HTML page
- Uses Handlebars templates (in `templates/`)
- Includes dark mode, keyboard navigation, syntax highlighting
- Opens in browser by default

#### `src/cache.ts`
- Caches full analysis results in `~/.cache/lgtm/`
- Keyed by PR URL or branch comparison
- Bypassed with `--fresh` flag

#### `src/secrets.ts`
- Securely stores API keys in system keychain (macOS Keychain, Linux Secret Service)
- Falls back to environment variables
- Used by `lgtm --config` command

### Prompt System

Prompts live in `prompts/` and are organized by task:
- `prompts/review/` - Main review prompt
- `prompts/executive-summary/` - Summary generation
- `prompts/changeset-split/` - Semantic grouping (when using LLM)
- `prompts/review-questions/` - Individual question prompts (fallback)

Model-specific variants use suffixes (e.g., `review.gemini.md` for Gemini-specific instructions).

### Data Flow

```
PRData (raw diff + metadata)
  ↓
FileDiff[] (parsed hunks)
  ↓
ChangeGroup[] (semantic groups)
  ↓
Analysis (+ LLM-generated descriptions, questions, summary)
  ↓
Output (HTML/MD/JSON)
```

### Important Interfaces

**`Analysis`** (`src/analysis/analyzer.ts`):
- The complete review output
- Contains `changeGroups`, `questions`, `summary`, `contributors`, `traces`

**`ChangeGroup`** (`src/analysis/chunker.ts`):
- A semantic unit of change (e.g., "Add user authentication")
- Contains files, hunks, symbols, LLM-generated description/verdict
- Has a stable ID for caching purposes

**`PRData`** (`src/github/pr.ts`):
- Raw input data: files, diff, branches, metadata

### LLM Usage Tracking

`src/llm/usage.ts` tracks:
- Tokens (input, output, cache read/write)
- Cost (USD, calculated via `src/llm/tokenlens.ts`)
- Running totals displayed in CLI

## Key Design Patterns

### Stable IDs for Caching
Change groups use stable IDs (`src/analysis/change-id.ts`) based on file paths and diff content hashes, enabling partial cache invalidation.

### Progressive Enhancement
The tool works without LLMs (`--no-llm`) but generates richer output with them. HTML output includes interactive features that degrade gracefully.

### Model Flexibility
Users can specify model via `-m` flag. System prompts can be model-specific. The client handles retries, rate limits, and fallback.

### Streaming Cost Estimation
LLM usage is estimated in real-time during streaming responses, with final reconciliation after completion.

## Dependencies

- **Bun** - Runtime and package manager
- **TypeScript** - Compiled to dist/ for distribution
- **Commander** - CLI argument parsing
- **AI SDK** (Vercel) - Unified LLM interface
- **Tree-sitter** - Planned for better symbol extraction
- **gh CLI** - Required for GitHub PR fetching

## Configuration

User settings stored in:
- API keys: System keychain (via `src/secrets.ts`)
- Cache: `~/.cache/lgtm/`
- Claude history: `~/.claude/` (customizable with `--claude-dir`)

## Output Formats

All formats generated from the same `Analysis` object:
- **HTML**: Self-contained, interactive, opens in browser
- **Markdown**: For PR comments or documentation
- **JSON**: For programmatic integration

## Release Process

Handled by `.github/workflows/release.yml`:
- Builds binaries for macOS (arm64/x64), Linux (x64/arm64), Windows (x64)
- Tags releases
- Canary builds from master branch
