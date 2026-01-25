import { z } from "zod";
import { inspect } from "util";
import { loadPrompt, generateStructured, LLMOptions } from "./client.js";
import { ChangeGroup } from "../analysis/chunker.js";
import type { ReviewQuestion } from "../analysis/analyzer.js";
import {
  DEFAULT_MODEL,
  DEFAULT_CHANGESET_QUESTION_CONCURRENCY,
} from "../config.js";

const AnswerSchema = z.object({
  answer: z.string(),
});

export async function answerChangesetQuestionsWithLLM(
  changeGroups: ChangeGroup[],
  options: LLMOptions & {
    verbose?: boolean;
    log?: (message: string) => void;
    maxConcurrent?: number;
  } = {}
): Promise<{ changeGroups: ChangeGroup[]; updated: boolean }> {
  let updated = false;
  const log =
    options.log ??
    (options.verbose ? (message: string) => console.log(message) : undefined);
  const maxConcurrent = Math.max(
    1,
    Number(options.maxConcurrent ?? DEFAULT_CHANGESET_QUESTION_CONCURRENCY)
  );

  const tasks = buildQuestionTasks(changeGroups, log);
  if (tasks.length === 0) {
    return { changeGroups, updated };
  }

  log?.(
    `[lgtm] processing ${tasks.length} questions (parallel=${maxConcurrent})`
  );

  await runWithConcurrency(
    tasks,
    maxConcurrent,
    async ({ group, question }) => {
      const effectiveModel = question.model ?? options.model ?? DEFAULT_MODEL;
      try {
        log?.(`[lgtm] answering ${question.id} for "${group.title}"`);
        const systemPrompt = loadPrompt(
          `review-questions/${question.id}.v1.txt`,
          effectiveModel
        );
        const userPrompt = buildUserPrompt(group, question);

        const response = await generateStructured(
          systemPrompt,
          userPrompt,
          AnswerSchema,
          {
            temperature: 0.2,
            maxTokens: 512,
            ...options,
            model: effectiveModel,
          }
        );

        question.answer = response.answer.trim();
        updated = true;
        log?.(`[lgtm] answered ${question.id} for "${group.title}"`);
      } catch (error) {
        const message = formatErrorDetails(error);
        console.error(
          `[lgtm] failed ${question.id} for "${group.title}"`,
          `model=${effectiveModel}`,
          message
        );
        throw error;
      }
    }
  );

  return { changeGroups, updated };
}

function buildQuestionTasks(
  changeGroups: ChangeGroup[],
  log?: (message: string) => void
): Array<{ group: ChangeGroup; question: ReviewQuestion }> {
  const tasks: Array<{ group: ChangeGroup; question: ReviewQuestion }> = [];

  for (const group of changeGroups) {
    if (!group.reviewQuestions || group.reviewQuestions.length === 0) {
      log?.(`[lgtm] skipping changeset "${group.title}" (no questions)`);
      continue;
    }

    log?.(
      `[lgtm] changeset "${group.title}" (${group.reviewQuestions.length} questions)`
    );

    for (const question of group.reviewQuestions) {
      if (question.category !== "changeset") {
        continue;
      }
      if (question.answer && question.answer.trim().length > 0) {
        log?.(
          `[lgtm] skipping ${question.id} for "${group.title}" (already answered)`
        );
        continue;
      }
      tasks.push({ group, question });
    }
  }

  return tasks;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;

  let index = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (index < items.length) {
        const currentIndex = index++;
        await worker(items[currentIndex]);
      }
    }
  );

  await Promise.all(workers);
}

function formatErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    const details: string[] = [];
    details.push(`${error.name}: ${error.message}`);

    const extra = extractErrorExtras(error);
    if (extra) {
      details.push(extra);
    }

    if (error.stack) {
      details.push(error.stack);
    }

    const cause = (error as { cause?: unknown }).cause;
    if (cause) {
      details.push(`Cause: ${formatErrorDetails(cause)}`);
    }
    return details.join("\n");
  }
  if (typeof error === "string") {
    return error;
  }
  return inspect(error, { depth: 5, breakLength: 120 });
}

function extractErrorExtras(error: Error): string | undefined {
  const anyError = error as {
    statusCode?: number;
    responseBody?: unknown;
    response?: unknown;
    data?: unknown;
    url?: string;
    request?: unknown;
  };
  const extras: Record<string, unknown> = {};

  if (anyError.statusCode) extras.statusCode = anyError.statusCode;
  if (anyError.url) extras.url = anyError.url;
  if (anyError.responseBody) extras.responseBody = anyError.responseBody;
  if (anyError.data) extras.data = anyError.data;
  if (anyError.response) extras.response = anyError.response;
  if (anyError.request) extras.request = anyError.request;

  if (Object.keys(extras).length === 0) {
    return undefined;
  }

  return `Details: ${inspect(extras, { depth: 5, breakLength: 120 })}`;
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
