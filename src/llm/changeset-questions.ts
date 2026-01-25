import { z } from "zod";
import { loadPrompt, generateStructured, LLMOptions } from "./client.js";
import { ChangeGroup } from "../analysis/chunker.js";
import type { ReviewQuestion } from "../analysis/analyzer.js";

const AnswerSchema = z.object({
  answer: z.string(),
});

export async function answerChangesetQuestionsWithLLM(
  changeGroups: ChangeGroup[],
  options: LLMOptions = {}
): Promise<{ changeGroups: ChangeGroup[]; updated: boolean }> {
  let updated = false;

  for (const group of changeGroups) {
    if (!group.reviewQuestions || group.reviewQuestions.length === 0) {
      continue;
    }

    for (const question of group.reviewQuestions) {
      if (question.category !== "changeset") {
        continue;
      }
      if (question.answer && question.answer.trim().length > 0) {
        continue;
      }

      const systemPrompt = loadPrompt(
        `review-questions/${question.id}.v1.txt`
      );
      const userPrompt = buildUserPrompt(group, question);

      const response = await generateStructured(
        systemPrompt,
        userPrompt,
        AnswerSchema,
        { temperature: 0.2, maxTokens: 512, ...options }
      );

      question.answer = response.answer.trim();
      updated = true;
    }
  }

  return { changeGroups, updated };
}

function buildUserPrompt(group: ChangeGroup, question: ReviewQuestion): string {
  const fileList = group.files.map((file) => `- ${file}`).join("\n");
  const hunks = group.hunks
    .map(
      ({ file, hunk }, index) =>
        `### ${file} (Hunk ${index})\n@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.header}\n${hunk.content}`
    )
    .join("\n\n");

  const description = group.description
    ? `\nDescription: ${group.description}`
    : "";
  const symbolsIntroduced = group.symbolsIntroduced?.length
    ? `\nNew symbols: ${group.symbolsIntroduced.join(", ")}`
    : "";
  const symbolsModified = group.symbolsModified?.length
    ? `\nModified symbols: ${group.symbolsModified.join(", ")}`
    : "";

  return `## Question
${question.question}

## Changeset
Title: ${group.title}
Type: ${group.changeType}${description}${symbolsIntroduced}${symbolsModified}

Files:
${fileList}

## Diff
${hunks}`;
}
