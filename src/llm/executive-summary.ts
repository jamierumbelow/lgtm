import { z } from "zod";
import { loadPrompt, generateStructured, LLMOptions } from "./client.js";
import { ChangeGroup } from "../analysis/chunker.js";
import { getDefaultModel } from "../config.js";

const ExecutiveSummarySchema = z.object({
  summary: z.string(),
  reviewGuidance: z.string(),
});

export interface ExecutiveSummaryResult {
  summary: string;
  reviewGuidance: string;
}

export async function generateExecutiveSummary(
  changeGroups: ChangeGroup[],
  prMetadata: {
    title?: string;
    description?: string;
    author?: string;
    baseBranch: string;
    headBranch: string;
    filesChanged: number;
    additions: number;
    deletions: number;
  },
  options: LLMOptions = {}
): Promise<ExecutiveSummaryResult> {
  const effectiveModel = options.model ?? getDefaultModel();
  const systemPrompt = loadPrompt(
    "executive-summary/executive-summary.v1.txt",
    effectiveModel
  );
  const userPrompt = buildUserPrompt(changeGroups, prMetadata);

  const result = await generateStructured(
    systemPrompt,
    userPrompt,
    ExecutiveSummarySchema,
    {
      temperature: 0.3,
      maxTokens: 1024,
      ...options,
      model: effectiveModel,
    }
  );

  return {
    summary: result.summary.trim(),
    reviewGuidance: result.reviewGuidance.trim(),
  };
}

function buildUserPrompt(
  changeGroups: ChangeGroup[],
  prMetadata: {
    title?: string;
    description?: string;
    author?: string;
    baseBranch: string;
    headBranch: string;
    filesChanged: number;
    additions: number;
    deletions: number;
  }
): string {
  const meta = [
    `Title: ${prMetadata.title || "(untitled)"}`,
    `Author: ${prMetadata.author || "(unknown)"}`,
    `Branches: ${prMetadata.baseBranch} ← ${prMetadata.headBranch}`,
    `Stats: ${prMetadata.filesChanged} files, +${prMetadata.additions}/-${prMetadata.deletions}`,
  ];

  if (prMetadata.description) {
    meta.push(`\nPR Description:\n${prMetadata.description}`);
  }

  const changesetList = changeGroups
    .map((group, i) => {
      const risk = group.riskLevel ? ` [${group.riskLevel} risk]` : "";
      const verdict = group.verdict ? `\n   Verdict: ${group.verdict}` : "";
      const files = group.files.slice(0, 5).join(", ");
      const moreFiles =
        group.files.length > 5 ? ` (+${group.files.length - 5} more)` : "";
      return `${i + 1}. **${group.title}** (${
        group.changeType
      })${risk}${verdict}\n   Files: ${files}${moreFiles}`;
    })
    .join("\n\n");

  return `## PR Metadata

${meta.join("\n")}

## Changesets (${changeGroups.length})

${changesetList}`;
}
