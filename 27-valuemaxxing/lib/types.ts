import type { ModelId, ReasoningEffort } from "./catalog";

export type Usage = {
  inputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type CostBreakdown = {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  total: number;
  currency: "USD";
  estimated: true;
};

export type MatrixRunResult = {
  id: string;
  model: ModelId;
  effort: ReasoningEffort;
  html: string;
  rawText: string;
  usage: Usage;
  cost: CostBreakdown | null;
  latencyMs: number;
  responseId: string | null;
  createdAt: string;
  source?: "sample";
};

export type SavedRun = {
  id: string;
  name: string;
  prompt: string;
  createdAt: string;
  items: MatrixRunResult[];
  origin?: "bundled";
};

export type ExperimentRun = {
  label: string;
  output: string;
  usage: Usage;
  cost: CostBreakdown | null;
  latencyMs: number;
  apiTurns?: number;
  modelTurns?: number;
  toolCalls?: number;
  trace?: Array<{
    turn: number;
    status: string;
    items: string[];
    inputTokens: number;
    outputTokens: number;
  }>;
};

export type CacheExperimentResult = {
  model: ModelId;
  prime: ExperimentRun;
  uncached: ExperimentRun;
  cached: ExperimentRun;
  prefixTokensApprox: number;
  createdAt: string;
};

export type PtcExperimentResult = {
  model: ModelId;
  direct: ExperimentRun;
  programmatic: ExperimentRun;
  createdAt: string;
};

export type CompactionExperimentResult = {
  model: ModelId;
  full: ExperimentRun;
  compacted: ExperimentRun;
  compaction: {
    usage: Usage;
    cost: CostBreakdown | null;
    latencyMs: number;
    inputItems: number;
    outputItems: number;
  };
  historyTokensApprox: number;
  historyTurns: number;
  createdAt: string;
};
