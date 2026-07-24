import { isModelId, isReasoningEffort } from "@/lib/catalog";
import { normalizeGeneratedHtml } from "@/lib/html";
import type {
  CacheExperimentResult,
  CompactionExperimentResult,
  CostBreakdown,
  ExperimentRun,
  MatrixRunResult,
  PtcExperimentResult,
  SavedRun,
  Usage,
} from "@/lib/types";

const MAX_ARTIFACT_LENGTH = 1_000_000;
const MAX_RESULT_COUNT = 24;
const MAX_LATENCY_MS = 3_600_000;

const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function normalizeUsage(value: unknown): Usage | null {
  const candidate = asRecord(value);
  if (!candidate) return null;

  const inputTokens = nonNegativeInteger(candidate.inputTokens);
  const cachedTokens = nonNegativeInteger(candidate.cachedTokens);
  const cacheWriteTokens = nonNegativeInteger(candidate.cacheWriteTokens);
  const outputTokens = nonNegativeInteger(candidate.outputTokens);
  const reasoningTokens = nonNegativeInteger(candidate.reasoningTokens);
  const totalTokens = nonNegativeInteger(candidate.totalTokens);

  if (
    inputTokens === null ||
    cachedTokens === null ||
    cacheWriteTokens === null ||
    outputTokens === null ||
    reasoningTokens === null ||
    totalTokens === null ||
    cachedTokens + cacheWriteTokens > inputTokens ||
    reasoningTokens > outputTokens ||
    totalTokens !== inputTokens + outputTokens
  ) {
    return null;
  }

  return {
    inputTokens,
    cachedTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
  };
}

function normalizeCost(value: unknown): CostBreakdown | null {
  const candidate = asRecord(value);
  if (!candidate) return null;

  const input = nonNegativeNumber(candidate.input);
  const cachedInput = nonNegativeNumber(candidate.cachedInput);
  const cacheWrite = nonNegativeNumber(candidate.cacheWrite);
  const output = nonNegativeNumber(candidate.output);
  const total = nonNegativeNumber(candidate.total);

  if (
    input === null ||
    cachedInput === null ||
    cacheWrite === null ||
    output === null ||
    total === null ||
    (candidate.currency !== undefined && candidate.currency !== "USD") ||
    (candidate.estimated !== undefined && candidate.estimated !== true)
  ) {
    return null;
  }

  return {
    input,
    cachedInput,
    cacheWrite,
    output,
    total,
    currency: "USD",
    estimated: true,
  };
}

export function normalizeImportedResult(value: unknown): MatrixRunResult | null {
  const candidate = asRecord(value);
  if (
    !candidate ||
    typeof candidate.model !== "string" ||
    !isModelId(candidate.model) ||
    typeof candidate.effort !== "string" ||
    !isReasoningEffort(candidate.effort) ||
    typeof candidate.html !== "string" ||
    !candidate.html.length ||
    candidate.html.length > MAX_ARTIFACT_LENGTH
  ) {
    return null;
  }

  const usage = normalizeUsage(candidate.usage);
  const latencyMs = nonNegativeNumber(candidate.latencyMs);
  const cost = candidate.cost === null ? null : normalizeCost(candidate.cost);

  if (
    !usage ||
    latencyMs === null ||
    latencyMs > MAX_LATENCY_MS ||
    (candidate.cost !== null && !cost)
  ) {
    return null;
  }

  return {
    id:
      typeof candidate.id === "string" && candidate.id.length < 200
        ? candidate.id
        : crypto.randomUUID(),
    model: candidate.model,
    effort: candidate.effort,
    html: normalizeGeneratedHtml(candidate.html),
    rawText:
      typeof candidate.rawText === "string"
        ? candidate.rawText.slice(0, MAX_ARTIFACT_LENGTH)
        : "",
    usage,
    cost,
    latencyMs,
    responseId:
      typeof candidate.responseId === "string"
        ? candidate.responseId.slice(0, 200)
        : null,
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : new Date().toISOString(),
    ...(candidate.source === "sample" ? { source: "sample" } : {}),
  };
}

export function normalizeSavedRun(value: unknown): SavedRun | null {
  const candidate = asRecord(value);
  if (!candidate || !Array.isArray(candidate.items)) return null;

  const items = candidate.items
    .slice(0, MAX_RESULT_COUNT)
    .map(normalizeImportedResult)
    .filter((item): item is MatrixRunResult => Boolean(item));

  if (
    !items.length ||
    new Set(items.map((item) => `${item.model}:${item.effort}`)).size !==
      items.length
  ) {
    return null;
  }

  return {
    id:
      typeof candidate.id === "string"
        ? candidate.id.slice(0, 200)
        : crypto.randomUUID(),
    name:
      typeof candidate.name === "string"
        ? candidate.name.slice(0, 120)
        : "Saved run",
    prompt:
      typeof candidate.prompt === "string"
        ? candidate.prompt.slice(0, 500)
        : "Saved run",
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : new Date().toISOString(),
    items,
    ...(candidate.origin === "bundled" ? { origin: "bundled" } : {}),
  };
}

export function normalizeBundledRuns(value: unknown): SavedRun[] {
  const manifest = asRecord(value);
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.runs)) {
    return [];
  }

  return manifest.runs
    .slice(0, MAX_RESULT_COUNT)
    .map((entry) => {
      const run = asRecord(entry);
      if (!run || !Array.isArray(run.items)) return null;

      const items = run.items.map((entry, index) => {
        const item = asRecord(entry);
        if (!item) return null;

        const artifact =
          typeof item.artifact === "string"
            ? item.artifact
            : typeof item.rawText === "string"
              ? item.rawText
              : item.html;

        if (typeof artifact !== "string") return null;

        const hasRecordedUsage = asRecord(item.usage) !== null;

        return normalizeImportedResult({
          ...item,
          id:
            typeof item.id === "string"
              ? item.id
              : `${String(run.id ?? "example")}-${index}`,
          html: typeof item.html === "string" ? item.html : artifact,
          rawText: artifact,
          usage: item.usage ?? EMPTY_USAGE,
          cost: item.cost ?? null,
          latencyMs: item.latencyMs ?? 0,
          responseId: item.responseId ?? null,
          createdAt: item.createdAt ?? run.createdAt,
          ...(hasRecordedUsage ? {} : { source: "sample" }),
        });
      });

      if (items.some((item) => !item)) return null;

      return normalizeSavedRun({
        ...run,
        origin: "bundled",
        items,
      });
    })
    .filter((run): run is SavedRun => Boolean(run));
}

function isExperimentRun(value: unknown): value is ExperimentRun {
  const run = asRecord(value);
  if (!run || typeof run.label !== "string" || typeof run.output !== "string") {
    return false;
  }

  const latencyMs = nonNegativeNumber(run.latencyMs);
  if (
    !normalizeUsage(run.usage) ||
    latencyMs === null ||
    latencyMs > MAX_LATENCY_MS ||
    (run.cost !== null && !normalizeCost(run.cost))
  ) {
    return false;
  }

  return (
    (run.apiTurns === undefined || nonNegativeNumber(run.apiTurns) !== null) &&
    (run.modelTurns === undefined || nonNegativeNumber(run.modelTurns) !== null) &&
    (run.toolCalls === undefined || nonNegativeNumber(run.toolCalls) !== null) &&
    (run.trace === undefined || Array.isArray(run.trace))
  );
}

function hasExperimentMetadata(value: unknown): value is Record<string, unknown> {
  const candidate = asRecord(value);
  return Boolean(
    candidate &&
      typeof candidate.model === "string" &&
      isModelId(candidate.model) &&
      typeof candidate.createdAt === "string",
  );
}

export function isCacheExperimentResult(
  value: unknown,
): value is CacheExperimentResult {
  if (!hasExperimentMetadata(value)) return false;

  return (
    isExperimentRun(value.prime) &&
    isExperimentRun(value.uncached) &&
    isExperimentRun(value.cached) &&
    nonNegativeNumber(value.prefixTokensApprox) !== null
  );
}

export function isPtcExperimentResult(
  value: unknown,
): value is PtcExperimentResult {
  return Boolean(
    hasExperimentMetadata(value) &&
      isExperimentRun(value.direct) &&
      isExperimentRun(value.programmatic),
  );
}

export function isCompactionExperimentResult(
  value: unknown,
): value is CompactionExperimentResult {
  if (
    !hasExperimentMetadata(value) ||
    !isExperimentRun(value.full) ||
    !isExperimentRun(value.compacted)
  ) {
    return false;
  }

  const compaction = asRecord(value.compaction);
  if (!compaction) return false;

  return Boolean(
    normalizeUsage(compaction.usage) &&
      (compaction.cost === null || normalizeCost(compaction.cost)) &&
      nonNegativeNumber(compaction.latencyMs) !== null &&
      nonNegativeNumber(compaction.inputItems) !== null &&
      nonNegativeNumber(compaction.outputItems) !== null &&
      nonNegativeNumber(value.historyTokensApprox) !== null &&
      nonNegativeNumber(value.historyTurns) !== null,
  );
}
