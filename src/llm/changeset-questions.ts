import { z } from "zod";
import { inspect } from "util";
import { loadPrompt, generateStructured, LLMOptions } from "./client.js";
import { ChangeGroup } from "../analysis/chunker.js";
import type { ReviewQuestion } from "../analysis/analyzer.js";
import {
  DEFAULT_MODEL,
  DEFAULT_CHANGESET_QUESTION_CONCURRENCY,
} from "../config.js";
import { isLLMExcludedFile } from "./file-filters.js";
import { trimHunkContent } from "./diff-context.js";
import {
  getCachedChangesetQuestions,
  setCachedChangesetQuestions,
} from "../cache/changesets.js";

export interface ProgressInfo {
  step: string;
  current: number;
  total: number;
}

const ALL_QUESTION_IDS = [
  "failure-modes",
  "input-domain",
  "duplication",
  "abstractions",
  "invariants",
  "error-handling",
  "testing",
  "performance",
  "security-privacy",
  "compatibility",
  "observability",
] as const;

type QuestionId = (typeof ALL_QUESTION_IDS)[number];

const ANSWERABLE_QUESTION_IDS = new Set<QuestionId>(ALL_QUESTION_IDS);

function buildBatchedAnswersSchema(questionIds: QuestionId[]) {
  const shape: Record<string, z.ZodString> = {};
  for (const id of questionIds) {
    shape[id] = z.string();
  }
  return z.object(shape);
}

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

  await runWithConcurrency(
    tasks,
    maxConcurrent,
    async ({ group, questionIds }) => {
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
      const userPrompt = buildUserPrompt(group, questionIds);

      const answers = await generateStructured(
        systemPrompt,
        userPrompt,
        buildBatchedAnswersSchema(questionIds),
        {
          temperature: 0.2,
          maxTokens: 2048,
          ...options,
          model: effectiveModel,
        }
      );

      // Apply answers to the corresponding questions
      applyAnswersToGroup(group, answers as Record<QuestionId, string>);
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
      setCachedChangesetQuestions(group.id, group.reviewQuestions ?? []);
    } catch (error) {
      const message = formatErrorDetails(error);
      console.error(
        `[lgtm] failed answering questions for "${group.title}"`,
        `model=${effectiveModel}`,
        message
      );
      throw error;
    }
    }
  );

  return { changeGroups, updated };
}

function buildChangesetTasks(
  changeGroups: ChangeGroup[],
  log?: (message: string) => void
): Array<{ group: ChangeGroup; questionIds: QuestionId[] }> {
  const tasks: Array<{ group: ChangeGroup; questionIds: QuestionId[] }> = [];

  for (const group of changeGroups) {
    if (!group.reviewQuestions || group.reviewQuestions.length === 0) {
      log?.(`[lgtm] skipping changeset "${group.title}" (no questions)`);
      continue;
    }

    hydrateQuestionsFromCache(group);

    // Check if any changeset questions need answering
    const unansweredQuestions = group.reviewQuestions.filter(
      (q) =>
        q.category === "changeset" &&
        ANSWERABLE_QUESTION_IDS.has(q.id as QuestionId) &&
        (!q.answer || q.answer.trim().length === 0)
    );
    const questionIds = unansweredQuestions.map(
      (question) => question.id as QuestionId
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
    tasks.push({ group, questionIds });
  }

  return tasks;
}

function hydrateQuestionsFromCache(group: ChangeGroup): void {
  if (!group.reviewQuestions || group.reviewQuestions.length === 0) {
    return;
  }
  const cached = getCachedChangesetQuestions(group.id);
  if (!cached || cached.length === 0) {
    return;
  }

  const cachedById = new Map(cached.map((question) => [question.id, question]));
  for (const question of group.reviewQuestions) {
    if (question.answer && question.answer.trim().length > 0) {
      continue;
    }
    const cachedQuestion = cachedById.get(question.id);
    if (cachedQuestion?.answer && cachedQuestion.answer.trim().length > 0) {
      question.answer = cachedQuestion.answer;
    }
  }
}

function applyAnswersToGroup(
  group: ChangeGroup,
  answers: Record<QuestionId, string>
): void {
  if (!group.reviewQuestions) return;

  for (const question of group.reviewQuestions) {
    if (question.category !== "changeset") continue;
    const questionId = question.id as QuestionId;
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

function buildUserPrompt(
  group: ChangeGroup,
  questionIds: QuestionId[]
): string {
  const fileList = group.files.map((file) => `- ${file}`).join("\n");
  const excludedFiles = group.files.filter((file) => isLLMExcludedFile(file));
  const hunks = group.hunks
    .filter(({ file }) => !isLLMExcludedFile(file))
    .map(
      ({ file, hunk }, index) =>
        `### ${file} (Hunk ${index})\n@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.header}\n${trimHunkContent(
          hunk.content,
          1
        )}`
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
  const excludedNote = excludedFiles.length
    ? `\nExcluded (generated/lockfiles): ${excludedFiles.join(", ")}`
    : "";
  const questionList = questionIds.length
    ? `\nQuestions: ${questionIds.join(", ")}`
    : "";

  return `## Changeset
Title: ${group.title}
Type: ${group.changeType}${description}${symbolsIntroduced}${symbolsModified}${excludedNote}${questionList}

Files:
${fileList}

## Diff
${hunks}`;
}
