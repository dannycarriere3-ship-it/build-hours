import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./register-module-hooks.mjs";

const examples = JSON.parse(
  readFileSync(new URL("../data/example-runs.json", import.meta.url), "utf8"),
);

const { fillPromptTemplate } = await import("../lib/prompts.ts");
const {
  DEFAULT_VISUAL_PROMPT,
  MODEL_CATALOG,
  REASONING_EFFORTS,
  getVisualOutputTokenLimit,
} = await import("../lib/catalog.ts");
const {
  isCacheExperimentResult,
  isCompactionExperimentResult,
  isPtcExperimentResult,
  normalizeBundledRuns,
  normalizeImportedResult,
  normalizeSavedRun,
} = await import("../lib/runs.ts");

const usage = {
  inputTokens: 150,
  cachedTokens: 20,
  cacheWriteTokens: 0,
  outputTokens: 80,
  reasoningTokens: 25,
  totalTokens: 230,
};

function experimentRun(label) {
  return {
    label,
    output: "The synthetic account qualifies.",
    usage,
    cost: null,
    latencyMs: 120,
  };
}

test("ships exactly one complete recorded 3-by-6 pelican benchmark", () => {
  const runs = normalizeBundledRuns(examples);
  const [pelican] = runs;

  assert.equal(runs.length, 1);
  assert.ok(runs.every((run) => run.origin === "bundled"));
  assert.equal(pelican.prompt, DEFAULT_VISUAL_PROMPT);
  assert.equal(
    pelican.items.length,
    MODEL_CATALOG.length * REASONING_EFFORTS.length,
  );
  assert.deepEqual(
    new Set(pelican.items.map((item) => `${item.model}:${item.effort}`)),
    new Set(
      MODEL_CATALOG.flatMap((model) =>
        REASONING_EFFORTS.map((effort) => `${model.id}:${effort}`),
      ),
    ),
  );

  for (const item of pelican.items) {
    assert.equal(item.source, undefined);
    assert.ok(item.cost?.total > 0);
    assert.ok(item.latencyMs > 0);
    assert.ok(item.usage.totalTokens > 0);
    assert.match(item.rawText, /^<svg\b/);
    assert.match(item.html, /Content-Security-Policy/);
    assert.match(item.html, /connect-src 'none'/);
  }

});

test("reserves enough output tokens for high-reasoning visual artifacts", () => {
  assert.equal(getVisualOutputTokenLimit("none"), 8_000);
  assert.equal(getVisualOutputTokenLimit("high"), 8_000);
  assert.equal(getVisualOutputTokenLimit("xhigh"), 16_000);
  assert.equal(getVisualOutputTokenLimit("max"), 32_000);
});

test("rejects unsafe or internally inconsistent imported runs", () => {
  const result = {
    id: "example",
    model: "gpt-5.6-luna",
    effort: "low",
    html: "<svg><circle cx='5' cy='5' r='4'/></svg>",
    rawText: "<svg><circle cx='5' cy='5' r='4'/></svg>",
    usage,
    cost: null,
    latencyMs: 100,
    responseId: null,
    createdAt: "2026-07-22T12:00:00.000Z",
  };

  assert.ok(normalizeImportedResult(result));
  assert.equal(
    normalizeImportedResult({
      ...result,
      usage: { ...usage, cachedTokens: 151 },
    }),
    null,
  );
  assert.equal(
    normalizeImportedResult({
      ...result,
      usage: { ...usage, reasoningTokens: 81 },
    }),
    null,
  );
  assert.equal(
    normalizeImportedResult({ ...result, model: "unrecognized-model" }),
    null,
  );
  assert.equal(
    normalizeImportedResult({ ...result, html: "x".repeat(1_000_001) }),
    null,
  );
  assert.equal(
    normalizeImportedResult({
      ...result,
      usage: { ...usage, totalTokens: 231 },
    }),
    null,
  );
  assert.equal(
    normalizeImportedResult({
      ...result,
      usage: { ...usage, inputTokens: 150.5 },
    }),
    null,
  );
  assert.equal(
    normalizeSavedRun({
      id: "duplicate",
      name: "Duplicate model pair",
      prompt: "Generate an SVG of a pelican riding a bicycle",
      items: [result, result],
    }),
    null,
  );
});

test("rejects stale experiment storage before result components read it", () => {
  const metadata = {
    model: "gpt-5.6-luna",
    createdAt: "2026-07-22T12:00:00.000Z",
  };

  const cache = {
    ...metadata,
    prime: experimentRun("Cache priming"),
    uncached: experimentRun("Caching disabled"),
    cached: experimentRun("Caching enabled"),
    prefixTokensApprox: 1_200,
  };
  assert.equal(isCacheExperimentResult(cache), true);
  assert.equal(isCacheExperimentResult({ ...cache, cached: undefined }), false);

  const ptc = {
    ...metadata,
    direct: experimentRun("Direct tool loop"),
    programmatic: experimentRun("Programmatic tool calling"),
  };
  assert.equal(isPtcExperimentResult(ptc), true);
  assert.equal(isPtcExperimentResult({ ...ptc, direct: {} }), false);

  const compaction = {
    ...metadata,
    full: experimentRun("Full transcript"),
    compacted: experimentRun("Compacted context"),
    compaction: {
      usage,
      cost: null,
      latencyMs: 90,
      inputItems: 20,
      outputItems: 4,
    },
    historyTokensApprox: 1_000,
    historyTurns: 10,
  };
  assert.equal(isCompactionExperimentResult(compaction), true);
  assert.equal(
    isCompactionExperimentResult({ ...compaction, compaction: {} }),
    false,
  );
});

test("renders named optimization-prompt placeholders explicitly", () => {
  assert.equal(
    fillPromptTemplate("Ledger: {{ACCOUNT_LEDGER}}", {
      ACCOUNT_LEDGER: "ACCT-001",
    }),
    "Ledger: ACCT-001",
  );
  assert.throws(
    () => fillPromptTemplate("Ledger: {{MISSING}}", {}),
    /unknown value: MISSING/,
  );
});
