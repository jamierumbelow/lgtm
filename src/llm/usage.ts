type UsageLike = Record<string, unknown> | undefined | null;

export interface LLMUsageRecord {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

interface LLMUsageTotals {
  tokenCount: number;
  costUsd: number;
}

let totals: LLMUsageTotals = { tokenCount: 0, costUsd: 0 };
let records: LLMUsageRecord[] = [];

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function extractTokenCount(usage: UsageLike): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;

  const total = getNumber((usage as Record<string, unknown>).totalTokens);
  if (total !== undefined) return total;

  const prompt =
    getNumber((usage as Record<string, unknown>).promptTokens) ??
    getNumber((usage as Record<string, unknown>).inputTokens) ??
    getNumber((usage as Record<string, unknown>).prompt_tokens) ??
    getNumber((usage as Record<string, unknown>).input_tokens);

  const completion =
    getNumber((usage as Record<string, unknown>).completionTokens) ??
    getNumber((usage as Record<string, unknown>).outputTokens) ??
    getNumber((usage as Record<string, unknown>).completion_tokens) ??
    getNumber((usage as Record<string, unknown>).output_tokens);

  if (prompt !== undefined || completion !== undefined) {
    return (prompt ?? 0) + (completion ?? 0);
  }

  return getNumber((usage as Record<string, unknown>).tokens);
}

function extractCostUsd(costLike: unknown): number | undefined {
  if (typeof costLike === "number" && Number.isFinite(costLike)) {
    return costLike;
  }

  if (costLike && typeof costLike === "object") {
    const record = costLike as Record<string, unknown>;
    const total = getNumber(record.total) ?? getNumber(record.amount);
    if (total !== undefined) return total;
  }

  return undefined;
}

function extractTokens(usage?: UsageLike): LLMUsageRecord {
  const inputTokens =
    getNumber((usage as Record<string, unknown>)?.promptTokens) ??
    getNumber((usage as Record<string, unknown>)?.inputTokens) ??
    getNumber((usage as Record<string, unknown>)?.prompt_tokens) ??
    getNumber((usage as Record<string, unknown>)?.input_tokens) ??
    0;

  const outputTokens =
    getNumber((usage as Record<string, unknown>)?.completionTokens) ??
    getNumber((usage as Record<string, unknown>)?.outputTokens) ??
    getNumber((usage as Record<string, unknown>)?.completion_tokens) ??
    getNumber((usage as Record<string, unknown>)?.output_tokens) ??
    0;

  const cacheWriteTokens =
    getNumber((usage as Record<string, unknown>)?.cacheCreationInputTokens) ??
    getNumber((usage as Record<string, unknown>)?.cacheWriteTokens) ??
    0;

  const cacheReadTokens =
    getNumber((usage as Record<string, unknown>)?.cacheReadInputTokens) ??
    getNumber((usage as Record<string, unknown>)?.cacheReadTokens) ??
    0;

  const totalTokens =
    extractTokenCount(usage) ??
    inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens;

  return {
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    totalTokens,
  };
}

export function recordLLMUsage(
  usage?: UsageLike,
  model?: string,
  costLike?: unknown
): void {
  const tokens = extractTokens(usage);
  if (tokens.totalTokens > 0) {
    totals.tokenCount += tokens.totalTokens;
  }

  const costUsd = extractCostUsd(costLike);
  if (costUsd !== undefined) {
    totals.costUsd += costUsd;
  }

  records.push({ ...tokens, model });
}

export function resetLLMUsage(): void {
  totals = { tokenCount: 0, costUsd: 0 };
  records = [];
}

export function getLLMUsageTotals(): LLMUsageTotals {
  return { ...totals };
}

export function getLLMUsageRecords(): LLMUsageRecord[] {
  return records.slice();
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return count.toString();
}

export function getFormattedRunningTotal(): string {
  return formatTokenCount(totals.tokenCount);
}
