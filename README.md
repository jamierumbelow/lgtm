# lgtm

> Structured PR review companion — because "lgtm" should mean something

`lgtm` takes a GitHub PR (or local branch diff) and generates a structured review that breaks down changes into semantic groups, asks the questions that matter, and even tries to find the AI coding sessions that generated the code.

## Installation

```bash
npm install -g lgtm
# or
npx lgtm <pr-url>
```

Requires:
- Node.js 20+
- [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated

## Usage

```bash
# Review a GitHub PR
lgtm https://github.com/org/repo/pull/123

# Review a local branch diff
lgtm --base main --head feature/my-branch

# Output formats
lgtm <pr-url> --format markdown    # default, prints to stdout
lgtm <pr-url> --format html -o review.html
lgtm <pr-url> --format json | jq '.changeGroups[]'

# Hunt for LLM traces
lgtm <pr-url> --find-traces --claude-dir ~/.claude
```

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

- Claude Code history (`~/.claude/projects/`)
- Cursor history (`~/.cursor/`) (partial support)

This helps answer "what was the AI told to do?" — useful for understanding intent behind generated code.

### 4. Suggested Reviewers

Based on `git blame` and PR review history, `lgtm` suggests who might have context to review the changes.

## Output Formats

### Markdown (default)
Clean, readable markdown suitable for pasting into a PR comment or wiki.

### HTML
A static, self-contained webpage with:
- Sidebar navigation
- Collapsible sections
- Dark mode (GitHub-style)

### JSON
Machine-readable output for integrating with other tools:
```bash
lgtm <pr-url> --format json | jq '.questions[] | select(.id == "failure-modes")'
```

## Development

```bash
git clone https://github.com/yourusername/lgtm
cd lgtm
npm install
npm run dev -- https://github.com/org/repo/pull/123
```

## Roadmap

- [ ] Tree-sitter integration for better semantic grouping
- [ ] LLM-powered descriptions and question answers
- [ ] Cursor SQLite history parsing
- [ ] GitHub Action for automated PR reviews
- [ ] VSCode extension

## License

MIT
