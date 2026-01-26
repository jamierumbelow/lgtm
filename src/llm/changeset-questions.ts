import { z } from "zod";
import { inspect } from "util";
import { loadPrompt, generateStructured, LLMOptions } from "./client.js";
import { ChangeGroup } from "../analysis/chunker.js";
import type { ReviewQuestion } from "../analysis/analyzer.js";
import {
  DEFAULT_MODEL,
  DEFAULT_CHANGESET_QUESTION_CONCURRENCY,
} from "../config.js";

export interface ProgressInfo {
  step: string;
  current: number;
  total: number;
}

// Schema for batched question answers - all 13 questions answered at once
const BatchedAnswersSchema = z.object({
  "failure-modes": z.string(),
  "input-domain": z.string(),
  "output-range": z.string(),
  duplication: z.string(),
  abstractions: z.string(),
  invariants: z.string(),
  "error-handling": z.string(),
  testing: z.string(),
  performance: z.string(),
  "security-privacy": z.string(),
  compatibility: z.string(),
  observability: z.string(),
});

type BatchedAnswers = z.infer<typeof BatchedAnswersSchema>;

const BATCHED_QUESTION_IDS = Object.keys(
  BatchedAnswersSchema.shape
) as (keyof BatchedAnswers)[];

export async function answerChangesetQuestionsWithLLM(
  changeGroups: ChangeGroup[],
  options: LLMOptions & {
    verbose?: boolean;
    log?: (message: string) => void;
    maxConcurrent?: number;
    onQuestionAnswered?: (changeGroups: ChangeGroup[]) => void | Promise<void>;
    onProgress?: (info: ProgressInfo) => void;
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

  const tasks = buildChangesetTasks(changeGroups, log);
  if (tasks.length === 0) {
    return { changeGroups, updated };
  }

  log?.(
    `[lgtm] processing ${tasks.length} changesets (parallel=${maxConcurrent})`
  );

  let completedCount = 0;
  const totalCount = tasks.length;

  await runWithConcurrency(tasks, maxConcurrent, async ({ group }) => {
    const effectiveModel = options.model ?? DEFAULT_MODEL;
    try {
      options.onProgress?.({
        step: `Analyzing "${group.title}"`,
        current: completedCount + 1,
        total: totalCount,
      });

      log?.(
        `[lgtm] answering all questions for "${group.title}" in single call`
      );
      const systemPrompt = loadPrompt(
        "review-questions/batched.v1.txt",
        effectiveModel
      );
      const userPrompt = buildUserPrompt(group);

      const answers = await generateStructured(
        systemPrompt,
        userPrompt,
        BatchedAnswersSchema,
        {
          temperature: 0.2,
          maxTokens: 2048,
          ...options,
          model: effectiveModel,
        }
      );

      // Apply answers to the corresponding questions
      applyAnswersToGroup(group, answers);
      updated = true;
      completedCount++;
      log?.(`[lgtm] answered all questions for "${group.title}"`);

      options.onProgress?.({
        step: `Analyzed "${group.title}"`,
        current: completedCount,
        total: totalCount,
      });

      // Persist to cache immediately after answering
      if (options.onQuestionAnswered) {
        await options.onQuestionAnswered(changeGroups);
      }
    } catch (error) {
      const message = formatErrorDetails(error);
      console.error(
        `[lgtm] failed answering questions for "${group.title}"`,
        `model=${effectiveModel}`,
        message
      );
      throw error;
    }
  });

  return { changeGroups, updated };
}

function buildChangesetTasks(
  changeGroups: ChangeGroup[],
  log?: (message: string) => void
): Array<{ group: ChangeGroup }> {
  const tasks: Array<{ group: ChangeGroup }> = [];

  for (const group of changeGroups) {
    if (!group.reviewQuestions || group.reviewQuestions.length === 0) {
      log?.(`[lgtm] skipping changeset "${group.title}" (no questions)`);
      continue;
    }

    // Check if any changeset questions need answering
    const unansweredQuestions = group.reviewQuestions.filter(
      (q) =>
        q.category === "changeset" &&
        BATCHED_QUESTION_IDS.includes(q.id as keyof BatchedAnswers) &&
        (!q.answer || q.answer.trim().length === 0)
    );

    if (unansweredQuestions.length === 0) {
      log?.(
        `[lgtm] skipping changeset "${group.title}" (all questions answered)`
      );
      continue;
    }

    log?.(
      `[lgtm] changeset "${group.title}" (${unansweredQuestions.length} unanswered questions)`
    );
    tasks.push({ group });
  }

  return tasks;
}

function applyAnswersToGroup(
  group: ChangeGroup,
  answers: BatchedAnswers
): void {
  if (!group.reviewQuestions) return;

  for (const question of group.reviewQuestions) {
    if (question.category !== "changeset") continue;
    const questionId = question.id as keyof BatchedAnswers;
    if (questionId in answers) {
      question.answer = answers[questionId].trim();
    }
  }
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

function buildUserPrompt(group: ChangeGroup): string {
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

  return `## Changeset
Title: ${group.title}
Type: ${group.changeType}${description}${symbolsIntroduced}${symbolsModified}

Files:
${fileList}

## Diff
${hunks}`;
}
