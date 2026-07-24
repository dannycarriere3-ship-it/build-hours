export const REASONING_EFFORTS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export function getVisualOutputTokenLimit(effort: ReasoningEffort) {
  if (effort === "max") return 32_000;
  if (effort === "xhigh") return 16_000;
  return 8_000;
}

export const MODEL_CATALOG = [
  {
    id: "gpt-5.6-sol",
    shortName: "Sol",
    label: "GPT-5.6 Sol",
    description: "Flagship",
    accent: "#d97757",
    efforts: REASONING_EFFORTS,
  },
  {
    id: "gpt-5.6-terra",
    shortName: "Terra",
    label: "GPT-5.6 Terra",
    description: "Balanced",
    accent: "#4d7c68",
    efforts: REASONING_EFFORTS,
  },
  {
    id: "gpt-5.6-luna",
    shortName: "Luna",
    label: "GPT-5.6 Luna",
    description: "Efficient",
    accent: "#7469a8",
    efforts: REASONING_EFFORTS,
  },
] as const;

export type ModelId = (typeof MODEL_CATALOG)[number]["id"];

export const MODEL_IDS = MODEL_CATALOG.map((model) => model.id) as ModelId[];

export const DEFAULT_SELECTIONS = [
  "gpt-5.6-sol:low",
  "gpt-5.6-sol:high",
  "gpt-5.6-terra:medium",
  "gpt-5.6-luna:medium",
];

export const DEFAULT_VISUAL_PROMPT =
  "Generate an SVG of a pelican riding a bicycle";

export const isModelId = (value: string): value is ModelId =>
  MODEL_IDS.includes(value as ModelId);

export const isReasoningEffort = (
  value: string,
): value is ReasoningEffort =>
  REASONING_EFFORTS.includes(value as ReasoningEffort);

export const getModel = (modelId: string) =>
  MODEL_CATALOG.find((model) => model.id === modelId);
