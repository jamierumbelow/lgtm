let totals = { tokenCount: 0, costUsd: 0 };
let records = [];
function getNumber(value) {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}
function extractTokenCount(usage) {
    if (!usage || typeof usage !== "object")
        return undefined;
    const total = getNumber(usage.totalTokens);
    if (total !== undefined)
        return total;
    const prompt = getNumber(usage.promptTokens) ??
        getNumber(usage.inputTokens) ??
        getNumber(usage.prompt_tokens) ??
        getNumber(usage.input_tokens);
    const completion = getNumber(usage.completionTokens) ??
        getNumber(usage.outputTokens) ??
        getNumber(usage.completion_tokens) ??
        getNumber(usage.output_tokens);
    if (prompt !== undefined || completion !== undefined) {
        return (prompt ?? 0) + (completion ?? 0);
    }
    return getNumber(usage.tokens);
}
function extractCostUsd(costLike) {
    if (typeof costLike === "number" && Number.isFinite(costLike)) {
        return costLike;
    }
    if (costLike && typeof costLike === "object") {
        const record = costLike;
        const total = getNumber(record.total) ?? getNumber(record.amount);
        if (total !== undefined)
            return total;
    }
    return undefined;
}
function extractTokens(usage) {
    const inputTokens = getNumber(usage?.promptTokens) ??
        getNumber(usage?.inputTokens) ??
        getNumber(usage?.prompt_tokens) ??
        getNumber(usage?.input_tokens) ??
        0;
    const outputTokens = getNumber(usage?.completionTokens) ??
        getNumber(usage?.outputTokens) ??
        getNumber(usage?.completion_tokens) ??
        getNumber(usage?.output_tokens) ??
        0;
    const cacheWriteTokens = getNumber(usage?.cacheCreationInputTokens) ??
        getNumber(usage?.cacheWriteTokens) ??
        0;
    const cacheReadTokens = getNumber(usage?.cacheReadInputTokens) ??
        getNumber(usage?.cacheReadTokens) ??
        0;
    const totalTokens = extractTokenCount(usage) ??
        inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens;
    return {
        inputTokens,
        outputTokens,
        cacheWriteTokens,
        cacheReadTokens,
        totalTokens,
    };
}
export function recordLLMUsage(usage, model, costLike) {
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
export function resetLLMUsage() {
    totals = { tokenCount: 0, costUsd: 0 };
    records = [];
}
export function getLLMUsageTotals() {
    return { ...totals };
}
export function getLLMUsageRecords() {
    return records.slice();
}
export function formatTokenCount(count) {
    if (count >= 1_000_000) {
        return `${(count / 1_000_000).toFixed(1)}M`;
    }
    if (count >= 1_000) {
        return `${(count / 1_000).toFixed(1)}k`;
    }
    return count.toString();
}
export function getFormattedRunningTotal() {
    return formatTokenCount(totals.tokenCount);
}
