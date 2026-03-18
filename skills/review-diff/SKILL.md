---
name: review-diff
description: >
  Run a code review on the current git diff and open the results as a visual HTML
  report in the browser. Trigger phrases: "review my diff", "review my changes",
  "visual review", "show me a code review", "/review-diff", "open review in browser"
---

# /review-diff Skill

When the user invokes this skill, you (the **main Claude**) must:

1. Note the user's current working directory (CWD).
2. Spawn a **subagent** using model **sonnet** (isolated context) and pass it the instructions below along with the CWD.
3. Wait for the subagent to finish.
4. Report back: "Review ready — opened in browser." (or relay any error).

---

## Subagent Instructions

You are running a one-shot code review pipeline. The user's project is at: **{CWD}**

Complete all four steps in order. Do not skip steps.

### Step 1 — Prepare the diff

```bash
cd {CWD} && bun /home/tommy/code/personal/lgtm/scripts/prepare-diff.ts
```

This writes `/tmp/lgtm-diff.json` containing:
- `empty` (boolean sentinel)
- `meta` (branch info, stats, excluded files)
- `fileDiffs` (parsed hunks — `FileDiff[]`)
- `formattedDiff` (ready-to-paste diff string)

If the script exits with code 1, stop and report the error.
If `empty: true`, skip to Step 3 (render empty page).

### Step 2 — Review the diff

Read `/tmp/lgtm-diff.json` with the Read tool.

Use the `formattedDiff` field as your input. Analyze the code and produce a JSON review following the schema below. Write the result to `/tmp/lgtm-analysis.json` using the Write tool.

**hunkRef format:** `"filepath:hunkIndex"` — the index is 0-based per file, matching `fileDiffs[n].hunks[i]` in the JSON. Every hunk in `fileDiffs` MUST appear in exactly one changeset's `hunkRefs`.

#### Review System Prompt

You are a senior software engineer reviewing a pull request. Your task is to:

1. **Split** the diff into logical, coherent changesets
2. **Review** each changeset with a verdict and actionable suggestions

##### Changeset Splitting

Split the diff into the smallest meaningful units of change. Each changeset should:
- Represent ONE logical change (a feature, a refactor, a bug fix, etc.)
- Be reviewable in isolation
- Have a clear, descriptive title
- Group related hunks across files when they serve the same purpose

Splitting guidelines:
1. **Atomic changes**: Each changeset should be self-contained.
2. **Cross-file grouping**: Group hunks that serve the same purpose.
3. **Separate concerns**: Don't mix unrelated changes.
4. **Meaningful titles**: Describe WHAT changed and WHY.
5. **Change types**: `feature` | `bugfix` | `refactor` | `test` | `docs` | `config` | `types` | `chore`

##### Risk Assessment

- `low`: Safe, mechanical change
- `medium`: Moderate complexity, touches existing logic
- `high`: Complex change to important code paths
- `critical`: Security, data integrity, or outage risk

##### Verdict

One sentence summarizing your assessment per changeset.

##### Suggestions

0–5 per changeset. Severity: `nit` | `suggestion` | `important` | `critical`

##### Executive Summary

`summary`: 2–4 sentence narrative overview.
`reviewGuidance`: 2–4 sentences on where the reviewer should focus.

#### Output Schema

Write **exactly** this JSON to `/tmp/lgtm-analysis.json`:

```json
{
  "changesets": [
    {
      "id": "cs-1",
      "title": "Short descriptive title (max 80 chars)",
      "description": "What this change does and why.",
      "changeType": "feature|bugfix|refactor|test|docs|config|types|chore",
      "files": ["src/foo.ts"],
      "hunkRefs": ["src/foo.ts:0", "src/bar.ts:2"],
      "riskLevel": "low|medium|high|critical",
      "verdict": "One sentence summary.",
      "suggestions": [
        { "severity": "nit|suggestion|important|critical", "text": "...", "file": "optional/path.ts" }
      ]
    }
  ],
  "summary": "2-4 sentence narrative.",
  "reviewGuidance": "2-4 sentences on where to focus."
}
```

### Step 3 — Render HTML

```bash
bun /home/tommy/code/personal/lgtm/scripts/render.ts
```

This reads `/tmp/lgtm-diff.json` and `/tmp/lgtm-analysis.json`, renders a self-contained HTML review page, and writes it to `/tmp/lgtm-review.html`.

### Step 4 — Open in browser

```bash
wslview /tmp/lgtm-review.html
```

This opens the HTML file in the Windows default browser via WSL.

---

## Error Handling

- **Not a git repo**: Report "Not in a git repository" to the user.
- **Empty diff**: Still render and open the "Nothing to Review" page.
- **Render fails**: Report the error message from the script.
- **wslview missing**: Tell the user the HTML is at `/tmp/lgtm-review.html` and they can open it manually.
