import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

const datasetUrl = new URL("../data/openai-frontier-models.json", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/data/openai-frontier-models.json") {
      return {
        url: datasetUrl.href,
        format: "module",
        shortCircuit: true,
      };
    }

    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === datasetUrl.href) {
      return {
        format: "module",
        shortCircuit: true,
        source: `export default ${readFileSync(datasetUrl, "utf8")};`,
      };
    }

    return nextLoad(url, context);
  },
});

const {
  FRONTIER_DATASET,
  getDominatingModels,
  getParetoFrontier,
  hasMetricsForView,
  parseFrontierDataset,
} = await import("../lib/frontier.ts");

function exampleModel(id, intelligence, costPerTask, secondsPerTask) {
  return {
    ...FRONTIER_DATASET.models[0],
    id,
    label: id,
    shortLabel: id,
    intelligence,
    routineIntelligence: intelligence,
    costPerTask,
    secondsPerTask,
  };
}

test("bundles published OpenAI MRCR scores and locally measured SVG runs", () => {
  assert.equal(FRONTIER_DATASET.illustrative, false);
  assert.equal(FRONTIER_DATASET.updated, "2026-07-23");
  assert.equal(FRONTIER_DATASET.models.length, 18);
  assert.match(FRONTIER_DATASET.source, /OpenAI MRCR v2/);
  assert.equal(
    FRONTIER_DATASET.sourceUrl,
    "https://openai.com/index/gpt-5-6/",
  );
  assert.match(FRONTIER_DATASET.sourceNote, /model-family scores/i);
  assert.match(FRONTIER_DATASET.sourceNote, /end-to-end elapsed time/i);

  const flagship = FRONTIER_DATASET.models.find(
    (model) => model.id === "openai-sol-max",
  );
  assert.ok(flagship);
  assert.equal(flagship.intelligence, 91.5);
  assert.equal(flagship.costPerTask, 0.487385);
  assert.equal(flagship.secondsPerTask, 348.223);

  const terra = FRONTIER_DATASET.models.find(
    (model) => model.id === "openai-terra-medium",
  );
  assert.equal(terra?.intelligence, 89.6);
  assert.equal(terra?.costPerTask, 0.032837);
  assert.equal(terra?.secondsPerTask, 18.582);

  const luna = FRONTIER_DATASET.models.find(
    (model) => model.id === "openai-luna-low",
  );
  assert.equal(luna?.intelligence, 41.3);
  assert.equal(luna?.costPerTask, 0.007789);
  assert.equal(luna?.secondsPerTask, 8.142);

  assert.ok(
    FRONTIER_DATASET.models.every(
      (model) => model.routineIntelligence === model.intelligence,
    ),
    "a separate routine-workload score must not be invented",
  );
  assert.ok(
    FRONTIER_DATASET.models.every((model) => model.provider === "OpenAI"),
    "the distributed fixture must not contain licensed third-party benchmark rows",
  );

  const recordedRun = JSON.parse(
    readFileSync(new URL("../data/example-runs.json", import.meta.url), "utf8"),
  ).runs[0];

  assert.equal(FRONTIER_DATASET.updated, recordedRun.createdAt.slice(0, 10));

  for (const configuration of FRONTIER_DATASET.models) {
    const recorded = recordedRun.items.find(
      (item) =>
        item.model === `gpt-5.6-${configuration.family.toLowerCase()}` &&
        item.effort === configuration.reasoning,
    );

    assert.ok(recorded, `missing recorded SVG run for ${configuration.id}`);
    assert.equal(configuration.costPerTask, Number(recorded.cost.total.toFixed(6)));
    assert.equal(configuration.secondsPerTask, recorded.latencyMs / 1_000);
  }
});

test("recorded cost and wall-time charts produce their measured frontiers", () => {
  const costFrontier = getParetoFrontier(
    FRONTIER_DATASET.models,
    "general",
    "cost",
  );
  const speedFrontier = getParetoFrontier(
    FRONTIER_DATASET.models,
    "general",
    "speed",
  );

  assert.equal(costFrontier.length, 3);
  assert.equal(speedFrontier.length, 3);
  assert.deepEqual(
    costFrontier.map((model) => model.id),
    [
      "openai-luna-low",
      "openai-terra-medium",
      "openai-sol-none",
    ],
  );
  assert.deepEqual(
    speedFrontier.map((model) => model.id),
    [
      "openai-luna-low",
      "openai-terra-medium",
      "openai-sol-none",
    ],
  );
});

test("missing public metrics are unavailable instead of treated as zero", () => {
  const missingCost = exampleModel("missing-cost", 50, null, 30);
  assert.equal(hasMetricsForView(missingCost, "cost"), false);
  assert.equal(hasMetricsForView(missingCost, "speed"), true);
  assert.equal(hasMetricsForView(missingCost, "3d"), false);
  assert.equal(
    getParetoFrontier(
      [...FRONTIER_DATASET.models, missingCost],
      "general",
      "cost",
    ).some(
      (model) => model.id === missingCost.id,
    ),
    false,
  );

  const missingBoth = exampleModel("missing-both", 50, null, null);
  assert.equal(hasMetricsForView(missingBoth, "speed"), false);
  assert.equal(hasMetricsForView(missingBoth, "3d"), false);
});

test("dominance changes when the selected axes change", () => {
  const balanced = exampleModel("balanced", 50, 0.4, 100);
  const faster = exampleModel("faster", 48, 0.5, 20);
  const cheaper = exampleModel("cheaper", 50, 0.3, 200);
  const models = [balanced, faster, cheaper];

  assert.deepEqual(
    getParetoFrontier(models, "general", "cost").map((model) => model.id),
    ["cheaper"],
  );
  assert.deepEqual(
    getParetoFrontier(models, "general", "speed").map((model) => model.id),
    ["faster", "balanced"],
  );
  assert.equal(getParetoFrontier(models, "general", "3d").length, 3);
  assert.deepEqual(
    getDominatingModels(balanced, models, "general", "cost").map(
      (model) => model.id,
    ),
    ["cheaper"],
  );
});

test("equal-coordinate ties stay on the frontier", () => {
  const models = [
    exampleModel("same-a", 50, 0.25, 30),
    exampleModel("same-b", 50, 0.25, 30),
  ];

  assert.equal(getParetoFrontier(models, "general", "cost").length, 2);
  assert.equal(getParetoFrontier(models, "general", "3d").length, 2);
});

test("benchmark imports reject duplicate identifiers and unsafe values", () => {
  assert.ok(parseFrontierDataset(FRONTIER_DATASET));

  const duplicateIds = structuredClone(FRONTIER_DATASET);
  duplicateIds.models[1].id = duplicateIds.models[0].id;
  assert.equal(parseFrontierDataset(duplicateIds), null);

  const negativeCost = structuredClone(FRONTIER_DATASET);
  negativeCost.models[0].costPerTask = -1;
  assert.equal(parseFrontierDataset(negativeCost), null);

  const unknownCost = structuredClone(FRONTIER_DATASET);
  unknownCost.models[0].costPerTask = null;
  assert.ok(parseFrontierDataset(unknownCost));

  const unsafeColor = structuredClone(FRONTIER_DATASET);
  unsafeColor.models[0].color = "url(https://example.com/leak)";
  assert.equal(parseFrontierDataset(unsafeColor), null);

  const unsafeSource = structuredClone(FRONTIER_DATASET);
  unsafeSource.sourceUrl = "javascript:alert(1)";
  assert.equal(parseFrontierDataset(unsafeSource), null);
});
