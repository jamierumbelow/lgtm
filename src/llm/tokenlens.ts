import type { LLMUsageRecord } from './usage.js';

interface TokenLensModule {
  calculateCost?: (...args: any[]) => number | undefined;
  getCost?: (...args: any[]) => number | undefined;
  estimateCost?: (...args: any[]) => number | undefined;
  pricing?: {
    getCost?: (...args: any[]) => number | undefined;
    estimateCost?: (...args: any[]) => number | undefined;
  };
  costFromUsage?: (...args: any[]) => number | undefined;
  estimateConversationCost?: (...args: any[]) => number | undefined;
  resolveModel?: (...args: any[]) => unknown;
  normalizeUsage?: (...args: any[]) => unknown;
  getModelMeta?: (...args: any[]) => unknown;
  isModelId?: (...args: any[]) => boolean;
  aliases?: Record<string, string>;
  getUsage?: (...args: any[]) => unknown;
  getTokenCosts?: (...args: any[]) => unknown;
  estimateCost?: (...args: any[]) => unknown;
}

function tryCost(fn: ((...args: any[]) => number | undefined) | undefined, args: any[]): number | undefined {
  if (!fn) return undefined;
  try {
    const value = fn(...args);
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function buildTokenArgs(record: LLMUsageRecord): Record<string, number> {
  return {
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    cacheReadTokens: record.cacheReadTokens,
    totalTokens: record.totalTokens,
  };
}

function getModelId(tokenlens: TokenLensModule, model: string): string | undefined {
  if (tokenlens.isModelId?.(model)) return model;

  const resolved = tokenlens.resolveModel ? tokenlens.resolveModel(model) : undefined;
  if (typeof resolved === 'string') return resolved;
  if (resolved && typeof resolved === 'object') {
    const record = resolved as Record<string, unknown>;
    if (typeof record.id === 'string') return record.id;
    if (typeof record.modelId === 'string') return record.modelId;
    if (typeof record.name === 'string') return record.name;
  }

  const meta = tokenlens.getModelMeta ? tokenlens.getModelMeta(model) : undefined;
  if (meta && typeof meta === 'object') {
    const record = meta as Record<string, unknown>;
    if (typeof record.id === 'string') return record.id;
    if (typeof record.modelId === 'string') return record.modelId;
    if (typeof record.name === 'string') return record.name;
  }

  if (tokenlens.aliases && typeof tokenlens.aliases[model] === 'string') {
    return tokenlens.aliases[model];
  }

  return undefined;
}

function resolveRecordCost(
  tokenlens: TokenLensModule,
  record: LLMUsageRecord,
  log?: (message: string) => void
): number | undefined {
  if (!record.model) return undefined;

  const tokenArgs = buildTokenArgs(record);
  const resolvedModel = getModelId(tokenlens, record.model) ?? record.model;
  if (resolvedModel !== record.model) {
    log?.(
      `[tokenlens] Resolved model alias ${record.model} -> ${String(resolvedModel)}.`
    );
  }

  const normalizedUsage = {
    input: record.inputTokens,
    output: record.outputTokens,
    total: record.totalTokens,
  };

  const breakdownUsage = {
    ...normalizedUsage,
    cacheReads: record.cacheReadTokens,
    cacheWrites: record.cacheWriteTokens,
  };

  const usagePayload =
    tokenlens.normalizeUsage ? tokenlens.normalizeUsage(normalizedUsage) : normalizedUsage;

  const candidates: Array<[((...args: any[]) => number | undefined) | undefined, any[]]> = [
    [tokenlens.costFromUsage, [{ id: resolvedModel, usage: usagePayload }]],
    [tokenlens.costFromUsage, [resolvedModel, usagePayload]],
    [tokenlens.estimateCost, [{ modelId: resolvedModel, usage: breakdownUsage }]],
    [tokenlens.estimateCost, [resolvedModel, breakdownUsage]],
    [tokenlens.calculateCost, [{ modelId: resolvedModel, usage: breakdownUsage }]],
    [tokenlens.calculateCost, [resolvedModel, breakdownUsage]],
    [tokenlens.calculateCost, [{ modelId: resolvedModel, usage: usagePayload }]],
    [tokenlens.getCost, [{ modelId: resolvedModel, usage: breakdownUsage }]],
    [tokenlens.getCost, [resolvedModel, breakdownUsage]],
    [tokenlens.estimateConversationCost, [{ modelId: resolvedModel, usage: breakdownUsage }]],
    [tokenlens.pricing?.getCost, [{ modelId: resolvedModel, usage: breakdownUsage }]],
    [tokenlens.pricing?.estimateCost, [{ modelId: resolvedModel, usage: breakdownUsage }]],
  ];

  for (const [fn, args] of candidates) {
    const cost = tryCost(fn, args);
    if (cost !== undefined) return cost;
  }

  return undefined;
}

export async function calculateTokenlensCost(
  records: LLMUsageRecord[],
  log?: (message: string) => void
): Promise<number | undefined> {
  let tokenlens: TokenLensModule | undefined;

  try {
    const imported = await import('tokenlens');
    tokenlens = (imported.default ?? imported) as TokenLensModule;
  } catch {
    log?.('[tokenlens] Failed to import tokenlens package.');
    return undefined;
  }

  if (records.length === 0) {
    log?.('[tokenlens] No usage records captured; skipping cost calculation.');
    return undefined;
  }

  let total = 0;
  let hasValue = false;
  let missingModel = 0;
  let missingCost = 0;

  const moduleKeys = Object.keys(tokenlens);
  if (moduleKeys.length === 0) {
    log?.('[tokenlens] Module loaded but no exports found.');
  }

  for (const record of records) {
    log?.(
      `[tokenlens] Usage: model=${record.model ?? 'unknown'} input=${
        record.inputTokens
      } output=${record.outputTokens} cacheWrite=${record.cacheWriteTokens} cacheRead=${
        record.cacheReadTokens
      } total=${record.totalTokens}.`
    );
    const cost = resolveRecordCost(tokenlens, record, log);
    if (cost !== undefined) {
      total += cost;
      hasValue = true;
    } else {
      if (!record.model) missingModel += 1;
      else missingCost += 1;
      const resolvedModel = record.model
        ? getModelId(tokenlens, record.model) ?? record.model
        : 'unknown';
      const meta = record.model ? tokenlens.getModelMeta?.(resolvedModel) : undefined;
      const tokenCosts = record.model
        ? tokenlens.getTokenCosts?.({
            modelId: resolvedModel,
            usage: {
              input: record.inputTokens,
              output: record.outputTokens,
              total: record.totalTokens,
              cacheReads: record.cacheReadTokens,
              cacheWrites: record.cacheWriteTokens,
            },
          })
        : undefined;
      log?.(
        `[tokenlens] Could not resolve cost for model=${String(
          resolvedModel
        )} tokens=${record.totalTokens}. Meta=${JSON.stringify(
          meta ?? null
        )} TokenCosts=${JSON.stringify(tokenCosts ?? null)}.`
      );
    }
  }

  if (!hasValue) {
    log?.(
      `[tokenlens] No cost calculated. Missing model: ${missingModel}, unresolved cost: ${missingCost}. Exports: ${moduleKeys.join(
        ', '
      ) || '(none)'}`
    );
    return undefined;
  }

  return hasValue ? total : undefined;
}
