import sourceDataset from "@/data/openai-frontier-models.json";

export type FrontierView = "3d" | "cost" | "speed";

export type WorkloadLens = "general" | "routine";

export type FrontierModel = {
  id: string;
  label: string;
  shortLabel: string;
  provider: string;
  family: string;
  reasoning: string;
  intelligence: number;
  routineIntelligence: number;
  costPerTask: number | null;
  secondsPerTask: number | null;
  color: string;
};

export type FrontierDataset = {
  name: string;
  updated: string;
  source: string;
  sourceUrl: string;
  sourceNote: string;
  illustrative: boolean;
  models: FrontierModel[];
};

const HEX_COLOR = /^#[\da-f]{6}$/i;
const MAX_MODEL_COUNT = 500;
const MAX_TEXT_LENGTH = 200;
const MAX_NOTE_LENGTH = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validText(
  value: unknown,
  maxLength = MAX_TEXT_LENGTH,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function validScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function publishedMetric(value: unknown): value is number | null {
  return value === null || positiveFinite(value);
}

function validSourceUrl(value: unknown): value is string {
  if (!validText(value, 2_000)) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function parseModel(value: unknown): FrontierModel | null {
  if (!isRecord(value)) return null;

  if (
    !validText(value.id) ||
    !validText(value.label) ||
    !validText(value.shortLabel) ||
    !validText(value.provider) ||
    !validText(value.family) ||
    !validText(value.reasoning) ||
    !validScore(value.intelligence) ||
    !validScore(value.routineIntelligence) ||
    !publishedMetric(value.costPerTask) ||
    !publishedMetric(value.secondsPerTask) ||
    typeof value.color !== "string" ||
    !HEX_COLOR.test(value.color)
  ) {
    return null;
  }

  return {
    id: value.id,
    label: value.label,
    shortLabel: value.shortLabel,
    provider: value.provider,
    family: value.family,
    reasoning: value.reasoning,
    intelligence: value.intelligence,
    routineIntelligence: value.routineIntelligence,
    costPerTask: value.costPerTask,
    secondsPerTask: value.secondsPerTask,
    color: value.color,
  };
}

export function parseFrontierDataset(value: unknown): FrontierDataset | null {
  if (!isRecord(value)) return null;

  if (
    !validText(value.name) ||
    !validText(value.updated) ||
    !Number.isFinite(Date.parse(value.updated)) ||
    !validText(value.source) ||
    !validSourceUrl(value.sourceUrl) ||
    !validText(value.sourceNote, MAX_NOTE_LENGTH) ||
    typeof value.illustrative !== "boolean" ||
    !Array.isArray(value.models) ||
    value.models.length === 0 ||
    value.models.length > MAX_MODEL_COUNT
  ) {
    return null;
  }

  const models: FrontierModel[] = [];
  const modelIds = new Set<string>();

  for (const item of value.models) {
    const model = parseModel(item);
    if (!model || modelIds.has(model.id)) return null;
    modelIds.add(model.id);
    models.push(model);
  }

  return {
    name: value.name,
    updated: value.updated,
    source: value.source,
    sourceUrl: value.sourceUrl,
    sourceNote: value.sourceNote,
    illustrative: value.illustrative,
    models,
  };
}

const parsedSourceDataset = parseFrontierDataset(sourceDataset);

if (!parsedSourceDataset) {
  throw new Error("The bundled Pareto frontier dataset is invalid.");
}

export const FRONTIER_DATASET: FrontierDataset = parsedSourceDataset;

export function intelligenceFor(model: FrontierModel, lens: WorkloadLens) {
  return lens === "routine" ? model.routineIntelligence : model.intelligence;
}

export function hasMetricsForView(model: FrontierModel, view: FrontierView) {
  if (view === "cost") return model.costPerTask !== null;
  if (view === "speed") return model.secondsPerTask !== null;
  return model.costPerTask !== null && model.secondsPerTask !== null;
}

function dominates(
  candidate: FrontierModel,
  model: FrontierModel,
  lens: WorkloadLens,
  view: FrontierView,
) {
  const candidateIntelligence = intelligenceFor(candidate, lens);
  const modelIntelligence = intelligenceFor(model, lens);
  const checks = [[candidateIntelligence, modelIntelligence, true]] as [
    number,
    number,
    boolean,
  ][];

  if (view !== "speed") {
    if (candidate.costPerTask === null || model.costPerTask === null) {
      return false;
    }
    checks.push([candidate.costPerTask, model.costPerTask, false]);
  }

  if (view !== "cost") {
    if (candidate.secondsPerTask === null || model.secondsPerTask === null) {
      return false;
    }
    checks.push([candidate.secondsPerTask, model.secondsPerTask, false]);
  }

  return (
    checks.every(([left, right, higherIsBetter]) =>
      higherIsBetter ? left >= right : left <= right,
    ) &&
    checks.some(([left, right, higherIsBetter]) =>
      higherIsBetter ? left > right : left < right,
    )
  );
}

export function getDominatingModels(
  model: FrontierModel,
  models: FrontierModel[],
  lens: WorkloadLens,
  view: FrontierView,
) {
  if (!hasMetricsForView(model, view)) return [];

  return models.filter(
    (candidate) =>
      candidate.id !== model.id &&
      hasMetricsForView(candidate, view) &&
      dominates(candidate, model, lens, view),
  );
}

export function getParetoFrontier(
  models: FrontierModel[],
  lens: WorkloadLens,
  view: FrontierView,
) {
  return models
    .filter((model) => hasMetricsForView(model, view))
    .filter((model) => getDominatingModels(model, models, lens, view).length === 0)
    .sort((left, right) => {
      if (view === "cost") {
        return (left.costPerTask ?? Number.POSITIVE_INFINITY) -
          (right.costPerTask ?? Number.POSITIVE_INFINITY);
      }
      if (view === "speed") {
        return (left.secondsPerTask ?? Number.POSITIVE_INFINITY) -
          (right.secondsPerTask ?? Number.POSITIVE_INFINITY);
      }
      return intelligenceFor(right, lens) - intelligenceFor(left, lens);
    });
}
