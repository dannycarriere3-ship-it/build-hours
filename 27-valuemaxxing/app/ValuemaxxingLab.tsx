"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import bundledExampleRuns from "@/data/example-runs.json";
import pricing from "@/data/pricing.json";
import {
  DEFAULT_SELECTIONS,
  DEFAULT_VISUAL_PROMPT,
  MODEL_CATALOG,
  REASONING_EFFORTS,
  getModel,
  type ModelId,
  type ReasoningEffort,
} from "@/lib/catalog";
import { MatrixRunSession } from "@/lib/matrix-run-session";
import {
  isCacheExperimentResult,
  isCompactionExperimentResult,
  isPtcExperimentResult,
  normalizeBundledRuns,
  normalizeImportedResult,
  normalizeSavedRun,
} from "@/lib/runs";
import type {
  CacheExperimentResult,
  CompactionExperimentResult,
  MatrixRunResult,
  PtcExperimentResult,
  SavedRun,
  Usage,
} from "@/lib/types";
import ParetoFrontier from "./ParetoFrontier";

type Tab = "matrix" | "optimize" | "frontier";
type CellStatus = "queued" | "running" | "complete" | "error";

type MatrixCell = {
  key: string;
  model: ModelId;
  effort: ReasoningEffort;
  status: CellStatus;
  result?: MatrixRunResult;
  error?: string;
};

type AsyncExperiment<T> = {
  status: "idle" | "running" | "complete" | "error";
  result?: T;
  error?: string;
};

const STORAGE_KEY = "valuemaxxing-lab-runs-v1";
const CACHE_STORAGE_KEY = "valuemaxxing-lab-cache-result-v2";
const PTC_STORAGE_KEY = "valuemaxxing-lab-ptc-result-v1";
const COMPACTION_STORAGE_KEY = "valuemaxxing-lab-compaction-result-v2";
const BUNDLED_EXAMPLE_RUNS = normalizeBundledRuns(bundledExampleRuns);

function formatDuration(ms: number) {
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}K`;
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMoney(value?: number | null) {
  if (value === null || value === undefined) return "—";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(value < 1 ? 3 : 2)}`;
}

function selectionKey(model: string, effort: string) {
  return `${model}:${effort}`;
}

function cellsForRun(run: SavedRun): MatrixCell[] {
  return run.items.map((item) => ({
    key: selectionKey(item.model, item.effort),
    model: item.model,
    effort: item.effort,
    status: "complete",
    result: item,
  }));
}

function readStoredExperiment<T>(
  key: string,
  isValid: (value: unknown) => value is T,
): T | null {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const parsed: unknown = JSON.parse(stored);
    if (isValid(parsed)) return parsed;
  } catch {
    // Corrupt or older browser data should not prevent the lab from loading.
  }

  try {
    localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in restricted browsing modes.
  }

  return null;
}

function saveStoredExperiment(key: string, result: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(result));
  } catch {
    // The completed comparison stays available during this browser session.
  }
}

function resultFilename(prompt: string) {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `valuemaxxing-${slug || "run"}.json`;
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadJson(filename: string, data: unknown) {
  downloadFile(filename, JSON.stringify(data, null, 2), "application/json");
}

function artifactSource(result: MatrixRunResult) {
  const raw = result.rawText.trim();
  const fenced = raw.match(/^```(?:html|svg)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : raw;
}

function isSvgArtifact(result: MatrixRunResult) {
  return /^(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(artifactSource(result));
}

function downloadArtifact(result: MatrixRunResult) {
  const svg = isSvgArtifact(result);
  const model = getModel(result.model)?.shortName.toLowerCase() ?? result.model;
  const filename = `${model}-${result.effort}.${svg ? "svg" : "html"}`;
  downloadFile(
    filename,
    svg ? artifactSource(result) : result.html,
    svg ? "image/svg+xml" : "text/html",
  );
}

function readError(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

function usageDelta(left: Usage, right: Usage) {
  if (!left.inputTokens) return 0;
  return Math.round(((right.inputTokens - left.inputTokens) / left.inputTokens) * 100);
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

function StatusDot({ configured }: { configured: boolean | null }) {
  const label =
    configured === null
      ? "Checking API"
      : configured
        ? "API ready"
        : "API key missing";
  return (
    <span className={`api-status ${configured ? "is-ready" : ""}`}>
      <i />
      {label}
    </span>
  );
}

function ResultCard({
  cell,
  onInspect,
}: {
  cell: MatrixCell;
  onInspect: (result: MatrixRunResult) => void;
}) {
  const model = getModel(cell.model);
  const result = cell.result;
  const isSample = result?.source === "sample";

  return (
    <article
      className={`result-card result-${cell.status}`}
      role="gridcell"
      style={{ "--model-accent": model?.accent } as React.CSSProperties}
    >
      <div className="artifact-frame">
        {result ? (
          <iframe
            title={`${model?.label} at ${cell.effort} reasoning`}
            srcDoc={result.html}
            sandbox="allow-scripts"
            tabIndex={-1}
          />
        ) : cell.status === "error" ? (
          <div className="artifact-error">
            <span>Failed</span>
            <p title={cell.error}>{cell.error}</p>
          </div>
        ) : (
          <div className="artifact-loading">
            {cell.status === "running" ? <Spinner /> : null}
            <span>{cell.status === "queued" ? "Queued" : "Running"}</span>
          </div>
        )}
      </div>

      {result ? (
        <button
          className="artifact-open-button"
          type="button"
          aria-label={`Inspect ${model?.label ?? cell.model}, ${cell.effort} reasoning`}
          onClick={() => onInspect(result)}
        >
          <span className="artifact-cell-metrics">
            <span>{isSample ? "Example" : formatDuration(result.latencyMs)}</span>
            <span>{isSample ? "Offline" : formatMoney(result.cost?.total)}</span>
          </span>
        </button>
      ) : null}
    </article>
  );
}

function ResultInspector({
  result,
  onClose,
}: {
  result: MatrixRunResult;
  onClose: () => void;
}) {
  const model = getModel(result.model);
  const isSample = result.source === "sample";

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="inspector-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="inspector"
        aria-label="Run details"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="inspector-header">
          <div>
            <span className="eyebrow">Run details</span>
            <h2>
              {model?.label} · {result.effort}
            </h2>
          </div>
          <div className="inspector-actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => downloadArtifact(result)}
            >
              Download {isSvgArtifact(result) ? "SVG" : "HTML"}
            </button>
            <button className="icon-button" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        <div className="inspector-preview">
          <iframe
            title="Expanded generated artifact"
            srcDoc={result.html}
            sandbox="allow-scripts"
          />
        </div>

        <section className="inspector-section">
          <h3>Run</h3>
          <div className="inspector-metric-grid">
            <Metric
              label="Wall time"
              value={isSample ? "Not recorded" : formatDuration(result.latencyMs)}
            />
            <Metric
              label="Estimated cost"
              value={isSample ? "Not recorded" : formatMoney(result.cost?.total)}
              detail={isSample ? "Illustrative fixture" : "Standard tier"}
            />
            <Metric
              label="Total tokens"
              value={isSample ? "Not recorded" : formatTokens(result.usage.totalTokens)}
            />
            <Metric
              label="Reasoning"
              value={
                isSample ? "Not recorded" : formatTokens(result.usage.reasoningTokens)
              }
            />
          </div>
        </section>

        {isSample ? (
          <section className="inspector-section cost-section">
            <div>
              <h3>About this example</h3>
              <p>
                This offline SVG is an illustrative fixture. Replace it with a
                recorded run to display real usage, timing, and cost data.
              </p>
            </div>
          </section>
        ) : (
          <>
            <section className="inspector-section">
              <h3>Token ledger</h3>
              <dl className="token-ledger">
                <div>
                  <dt>Uncached input</dt>
                  <dd>
                    {formatTokens(
                      Math.max(
                        0,
                        result.usage.inputTokens -
                          result.usage.cachedTokens -
                          result.usage.cacheWriteTokens,
                      ),
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Cached read</dt>
                  <dd>{formatTokens(result.usage.cachedTokens)}</dd>
                </div>
                <div>
                  <dt>Cache write</dt>
                  <dd>{formatTokens(result.usage.cacheWriteTokens)}</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>{formatTokens(result.usage.outputTokens)}</dd>
                </div>
              </dl>
            </section>

            <section className="inspector-section cost-section">
              <div>
                <h3>Estimated cost</h3>
                <p>
                  Versioned rates from the public pricing page, updated{" "}
                  {pricing.updated}.
                </p>
              </div>
              <dl>
                <div>
                  <dt>Input</dt>
                  <dd>{formatMoney(result.cost?.input)}</dd>
                </div>
                <div>
                  <dt>Cached input</dt>
                  <dd>{formatMoney(result.cost?.cachedInput)}</dd>
                </div>
                <div>
                  <dt>Cache write</dt>
                  <dd>{formatMoney(result.cost?.cacheWrite)}</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>{formatMoney(result.cost?.output)}</dd>
                </div>
                <div className="cost-total">
                  <dt>Total</dt>
                  <dd>{formatMoney(result.cost?.total)}</dd>
                </div>
              </dl>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}

type ExperimentComparisonRow = {
  label: string;
  before: string;
  after: string;
  highlightAfter?: boolean;
};

function ExperimentComparison({
  label,
  beforeLabel,
  afterLabel,
  beforeIndex,
  afterIndex,
  rows,
}: {
  label: string;
  beforeLabel: string;
  afterLabel: string;
  beforeIndex: string;
  afterIndex: string;
  rows: ExperimentComparisonRow[];
}) {
  return (
    <div className="experiment-comparison-wrap">
      <table className="experiment-comparison" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">
              <span className="comparison-index index-1">{beforeIndex}</span>
              <span>{beforeLabel}</span>
            </th>
            <th scope="col">
              <span className="comparison-index index-2">{afterIndex}</span>
              <span>{afterLabel}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.before}</td>
              <td className={row.highlightAfter ? "is-improved" : undefined}>
                {row.after}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CacheResults({ result }: { result: CacheExperimentResult }) {
  const cacheRead = result.cached.usage.cachedTokens;
  const uncachedInputCost = result.uncached.cost?.input ?? null;
  const cachedInputCost = result.cached.cost
    ? result.cached.cost.input + result.cached.cost.cachedInput
    : null;
  const inputCostChange =
    uncachedInputCost !== null &&
    uncachedInputCost > 0 &&
    cachedInputCost !== null
      ? Math.round(
          ((cachedInputCost - uncachedInputCost) / uncachedInputCost) * 100,
        )
      : null;
  const timeSaved = result.uncached.latencyMs - result.cached.latencyMs;
  const timingChange =
    timeSaved > 0
      ? `${formatDuration(timeSaved)} faster`
      : timeSaved < 0
        ? `${formatDuration(Math.abs(timeSaved))} slower`
        : "same wall time";

  return (
    <div className="experiment-results">
      <div className="experiment-summary">
        <span className="summary-number">
          {!cacheRead
            ? "No cache hit"
            : inputCostChange === null
              ? formatTokens(cacheRead)
              : inputCostChange === 0
                ? "Same cost"
                : `${Math.abs(inputCostChange)}% ${
                    inputCostChange < 0 ? "lower" : "higher"
                  }`}
        </span>
        {cacheRead ? (
          <span>
            {inputCostChange === null
              ? "cached prefix tokens"
              : `input cost with caching enabled · ${timingChange}`}
          </span>
        ) : null}
      </div>
      <ExperimentComparison
        label="Prompt caching comparison"
        beforeLabel="Caching disabled"
        afterLabel="Caching enabled"
        beforeIndex="A"
        afterIndex="B"
        rows={[
          {
            label: "Cached prefix",
            before: formatTokens(result.uncached.usage.cachedTokens),
            after: formatTokens(result.cached.usage.cachedTokens),
          },
          {
            label: "Input cost",
            before: formatMoney(uncachedInputCost),
            after: formatMoney(cachedInputCost),
            highlightAfter:
              uncachedInputCost !== null &&
              cachedInputCost !== null &&
              cachedInputCost < uncachedInputCost,
          },
          {
            label: "Input tokens",
            before: formatTokens(result.uncached.usage.inputTokens),
            after: formatTokens(result.cached.usage.inputTokens),
          },
          {
            label: "Output tokens",
            before: formatTokens(result.uncached.usage.outputTokens),
            after: formatTokens(result.cached.usage.outputTokens),
          },
          {
            label: "Wall time",
            before: formatDuration(result.uncached.latencyMs),
            after: formatDuration(result.cached.latencyMs),
            highlightAfter: result.cached.latencyMs < result.uncached.latencyMs,
          },
          {
            label: "Total estimated cost",
            before: formatMoney(result.uncached.cost?.total),
            after: formatMoney(result.cached.cost?.total),
            highlightAfter:
              result.cached.cost !== null &&
              result.uncached.cost !== null &&
              result.cached.cost.total < result.uncached.cost.total,
          },
        ]}
      />
      <div className="experiment-overhead">
        <span>One-time cache priming</span>
        <strong>{formatMoney(result.prime.cost?.total)}</strong>
        <span>
          {formatTokens(result.prime.usage.cacheWriteTokens)} tokens written ·{" "}
          {formatDuration(result.prime.latencyMs)}
        </span>
      </div>
      {!cacheRead ? (
        <p className="result-footnote">No matching prefix was cached.</p>
      ) : null}
    </div>
  );
}

function PtcResults({ result }: { result: PtcExperimentResult }) {
  const inputChange = usageDelta(
    result.direct.usage,
    result.programmatic.usage,
  );

  return (
    <div className="experiment-results">
      <div className="experiment-summary">
        <span className="summary-number">
          {inputChange === 0
            ? "Same"
            : `${Math.abs(inputChange)}% ${inputChange < 0 ? "fewer" : "more"}`}
        </span>
        <span>input tokens with the hosted tool loop</span>
      </div>
      <ExperimentComparison
        label="Programmatic tool calling comparison"
        beforeLabel="Direct tool loop"
        afterLabel="Hosted tool loop"
        beforeIndex="A"
        afterIndex="B"
        rows={[
          {
            label: "Model turns",
            before: String(result.direct.modelTurns ?? result.direct.apiTurns ?? 0),
            after: String(
              result.programmatic.modelTurns ?? result.programmatic.apiTurns ?? 0,
            ),
            highlightAfter:
              (result.programmatic.modelTurns ?? result.programmatic.apiTurns ?? 0) <
              (result.direct.modelTurns ?? result.direct.apiTurns ?? 0),
          },
          {
            label: "API requests",
            before: String(result.direct.apiTurns ?? 0),
            after: String(result.programmatic.apiTurns ?? 0),
          },
          {
            label: "Tool calls",
            before: String(result.direct.toolCalls ?? 0),
            after: String(result.programmatic.toolCalls ?? 0),
          },
          {
            label: "Input tokens",
            before: formatTokens(result.direct.usage.inputTokens),
            after: formatTokens(result.programmatic.usage.inputTokens),
            highlightAfter:
              result.programmatic.usage.inputTokens < result.direct.usage.inputTokens,
          },
          {
            label: "Output tokens",
            before: formatTokens(result.direct.usage.outputTokens),
            after: formatTokens(result.programmatic.usage.outputTokens),
          },
          {
            label: "Reasoning tokens",
            before: formatTokens(result.direct.usage.reasoningTokens),
            after: formatTokens(result.programmatic.usage.reasoningTokens),
          },
          {
            label: "Wall time",
            before: formatDuration(result.direct.latencyMs),
            after: formatDuration(result.programmatic.latencyMs),
            highlightAfter: result.programmatic.latencyMs < result.direct.latencyMs,
          },
          {
            label: "Estimated cost",
            before: formatMoney(result.direct.cost?.total),
            after: formatMoney(result.programmatic.cost?.total),
            highlightAfter:
              result.programmatic.cost !== null &&
              result.direct.cost !== null &&
              result.programmatic.cost.total < result.direct.cost.total,
          },
        ]}
      />
      <div className="comparison-answers">
        <details>
          <summary>Direct-loop answer</summary>
          <pre>{result.direct.output}</pre>
        </details>
        <details>
          <summary>Hosted-loop answer</summary>
          <pre>{result.programmatic.output}</pre>
        </details>
      </div>
    </div>
  );
}

function CompactionResults({
  result,
}: {
  result: CompactionExperimentResult;
}) {
  const inputChange = usageDelta(result.full.usage, result.compacted.usage);

  return (
    <div className="experiment-results">
      <div className="experiment-summary">
        <span className="summary-number">
          {inputChange === 0
            ? "Same"
            : `${Math.abs(inputChange)}% ${inputChange < 0 ? "fewer" : "more"}`}
        </span>
        <span>input tokens on the same follow-up task</span>
      </div>
      <ExperimentComparison
        label="Context compaction comparison"
        beforeLabel="Full transcript"
        afterLabel="Compacted context"
        beforeIndex="A"
        afterIndex="B"
        rows={[
          {
            label: "Input tokens",
            before: formatTokens(result.full.usage.inputTokens),
            after: formatTokens(result.compacted.usage.inputTokens),
            highlightAfter:
              result.compacted.usage.inputTokens < result.full.usage.inputTokens,
          },
          {
            label: "Output tokens",
            before: formatTokens(result.full.usage.outputTokens),
            after: formatTokens(result.compacted.usage.outputTokens),
          },
          {
            label: "Reasoning tokens",
            before: formatTokens(result.full.usage.reasoningTokens),
            after: formatTokens(result.compacted.usage.reasoningTokens),
          },
          {
            label: "Wall time",
            before: formatDuration(result.full.latencyMs),
            after: formatDuration(result.compacted.latencyMs),
            highlightAfter: result.compacted.latencyMs < result.full.latencyMs,
          },
          {
            label: "Estimated cost",
            before: formatMoney(result.full.cost?.total),
            after: formatMoney(result.compacted.cost?.total),
            highlightAfter:
              result.compacted.cost !== null &&
              result.full.cost !== null &&
              result.compacted.cost.total < result.full.cost.total,
          },
        ]}
      />
      <div className="experiment-overhead">
        <span>One-time compaction</span>
        <strong>{formatMoney(result.compaction.cost?.total)}</strong>
        <span>
          {formatTokens(result.compaction.usage.inputTokens)} →{" "}
          {formatTokens(result.compaction.usage.outputTokens)} tokens ·{" "}
          {formatDuration(result.compaction.latencyMs)}
        </span>
      </div>
      <div className="comparison-answers">
        <details>
          <summary>Full-transcript answer</summary>
          <pre>{result.full.output}</pre>
        </details>
        <details>
          <summary>Compacted-context answer</summary>
          <pre>{result.compacted.output}</pre>
        </details>
      </div>
    </div>
  );
}

export default function ValuemaxxingLab() {
  const defaultRun = BUNDLED_EXAMPLE_RUNS[0];
  const [tab, setTab] = useState<Tab>("frontier");
  const [prompt, setPrompt] = useState(
    defaultRun?.prompt ?? DEFAULT_VISUAL_PROMPT,
  );
  const [selections, setSelections] = useState(
    () =>
      new Set(
        defaultRun
          ? defaultRun.items.map((item) => selectionKey(item.model, item.effort))
          : DEFAULT_SELECTIONS,
      ),
  );
  const [concurrency, setConcurrency] = useState(2);
  const [cells, setCells] = useState<MatrixCell[]>(() =>
    defaultRun ? cellsForRun(defaultRun) : [],
  );
  const [isRunning, setIsRunning] = useState(false);
  const [inspecting, setInspecting] = useState<MatrixRunResult | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>([]);
  const [activeRunId, setActiveRunId] = useState(defaultRun?.id ?? "");
  const [cacheModel, setCacheModel] = useState<ModelId>("gpt-5.6-luna");
  const [ptcModel, setPtcModel] = useState<ModelId>("gpt-5.6-terra");
  const [compactionModel, setCompactionModel] =
    useState<ModelId>("gpt-5.6-luna");
  const [cacheRun, setCacheRun] = useState<
    AsyncExperiment<CacheExperimentResult>
  >({ status: "idle" });
  const [ptcRun, setPtcRun] = useState<AsyncExperiment<PtcExperimentResult>>({
    status: "idle",
  });
  const [compactionRun, setCompactionRun] = useState<
    AsyncExperiment<CompactionExperimentResult>
  >({ status: "idle" });
  const controllers = useRef(new Set<AbortController>());
  const matrixRunSession = useRef(new MatrixRunSession());
  const savedRunsRef = useRef<SavedRun[]>([]);
  const importRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const activeControllers = controllers.current;
    const activeMatrixSession = matrixRunSession.current;

    fetch("/api/health")
      .then(
        (response) =>
          response.json() as Promise<{ configured?: boolean }>,
      )
      .then((data) => setConfigured(Boolean(data.configured)))
      .catch(() => setConfigured(false));

    const loadSavedRuns = window.setTimeout(() => {
      try {
        const saved: unknown = JSON.parse(
          localStorage.getItem(STORAGE_KEY) || "[]",
        );
        if (Array.isArray(saved)) {
          const normalized = saved
            .slice(0, 8)
            .map(normalizeSavedRun)
            .filter((run): run is SavedRun => Boolean(run));
          savedRunsRef.current = normalized;
          setSavedRuns(normalized);
          if (normalized.length && !BUNDLED_EXAMPLE_RUNS.length) {
            const latest = normalized[0];
            setPrompt(latest.prompt);
            setSelections(
              new Set(
                latest.items.map((item) =>
                  selectionKey(item.model, item.effort),
                ),
              ),
            );
            setCells(cellsForRun(latest));
            setActiveRunId(latest.id);
          }
        }
        const savedCache = readStoredExperiment(
          CACHE_STORAGE_KEY,
          isCacheExperimentResult,
        );
        const savedPtc = readStoredExperiment(
          PTC_STORAGE_KEY,
          isPtcExperimentResult,
        );
        const savedCompaction = readStoredExperiment(
          COMPACTION_STORAGE_KEY,
          isCompactionExperimentResult,
        );
        if (savedCache) {
          setCacheModel(savedCache.model);
          setCacheRun({ status: "complete", result: savedCache });
        }
        if (savedPtc) {
          setPtcModel(savedPtc.model);
          setPtcRun({ status: "complete", result: savedPtc });
        }
        if (savedCompaction) {
          setCompactionModel(savedCompaction.model);
          setCompactionRun({ status: "complete", result: savedCompaction });
        }
      } catch {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // Browsers can disable storage entirely in private or restricted modes.
        }
      }
    }, 0);

    return () => {
      window.clearTimeout(loadSavedRuns);
      activeMatrixSession.cancel();
      activeControllers.forEach((controller) => controller.abort());
      activeControllers.clear();
    };
  }, []);

  const orderedSelections = useMemo(
    () =>
      MODEL_CATALOG.flatMap((model) =>
        REASONING_EFFORTS.filter((effort) =>
          selections.has(selectionKey(model.id, effort)),
        ).map((effort) => ({
          model: model.id,
          effort,
          key: selectionKey(model.id, effort),
        })),
      ),
    [selections],
  );

  const completedResults = cells
    .filter((cell) => cell.result)
    .map((cell) => cell.result as MatrixRunResult);

  const cellsByKey = new Map(cells.map((cell) => [cell.key, cell]));
  const viewingActiveRun = isRunning && !activeRunId;

  const toggleSelection = (key: string) => {
    setSelections((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateCell = (
    key: string,
    patch: Partial<MatrixCell>,
    sessionId: number,
  ) => {
    if (!matrixRunSession.current.isDisplayed(sessionId)) return;

    setCells((current) =>
      matrixRunSession.current.isDisplayed(sessionId)
        ? current.map((cell) =>
            cell.key === key ? { ...cell, ...patch } : cell,
          )
        : current,
    );
  };

  const persistRun = (
    items: MatrixRunResult[],
    runPrompt: string,
    { activate = true }: { activate?: boolean } = {},
  ) => {
    if (!items.length) return;
    const now = new Date();
    const next: SavedRun = {
      id: crypto.randomUUID(),
      name:
        runPrompt === DEFAULT_VISUAL_PROMPT
          ? "Pelican benchmark"
          : runPrompt.slice(0, 60),
      prompt: runPrompt,
      createdAt: now.toISOString(),
      items,
    };
    const updated = [next, ...savedRunsRef.current].slice(0, 8);
    savedRunsRef.current = updated;
    setSavedRuns(updated);
    if (activate) setActiveRunId(next.id);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Completed runs remain available in memory if browser storage is full.
    }
  };

  const runMatrix = async () => {
    if (!orderedSelections.length || prompt.trim().length < 8) return;

    const sessionId = matrixRunSession.current.start();
    const runPrompt = prompt.trim();
    const finishedResults: MatrixRunResult[] = [];
    setIsRunning(true);
    setActiveRunId("");
    const jobs: MatrixCell[] = orderedSelections.map((selection) => ({
      ...selection,
      status: "queued",
    }));
    setCells(jobs);
    window.setTimeout(
      () =>
        resultsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      80,
    );
    let cursor = 0;

    const worker = async () => {
      while (cursor < jobs.length && matrixRunSession.current.isActive(sessionId)) {
        const job = jobs[cursor];
        cursor += 1;
        updateCell(job.key, { status: "running", error: undefined }, sessionId);
        const controller = new AbortController();
        controllers.current.add(controller);

        try {
          const response = await fetch("/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: runPrompt,
              model: job.model,
              effort: job.effort,
            }),
            signal: controller.signal,
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(readError(payload, "The run failed."));
          }
          if (matrixRunSession.current.isActive(sessionId)) {
            const result = payload as MatrixRunResult;
            finishedResults.push(result);
            updateCell(job.key, {
              status: "complete",
              result,
            }, sessionId);
          }
        } catch (error) {
          if (matrixRunSession.current.isActive(sessionId)) {
            updateCell(job.key, {
              status: "error",
              error:
                error instanceof Error && error.name === "AbortError"
                  ? "Canceled"
                  : error instanceof Error
                    ? error.message
                    : "The run failed.",
            }, sessionId);
          }
        } finally {
          controllers.current.delete(controller);
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, jobs.length) },
        () => worker(),
      ),
    );
    const activate = matrixRunSession.current.finish(sessionId);
    if (activate !== null) {
      setIsRunning(false);
      persistRun(finishedResults, runPrompt, { activate });
    }
  };

  const cancelMatrix = () => {
    matrixRunSession.current.cancel();
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    setIsRunning(false);
    setCells((current) =>
      current.map((cell) =>
        cell.status === "queued" || cell.status === "running"
          ? { ...cell, status: "error", error: "Canceled" }
          : cell,
      ),
    );
  };

  const exportRun = () => {
    if (!completedResults.length) return;
    downloadJson(resultFilename(prompt), {
      schemaVersion: 1,
      prompt,
      createdAt: new Date().toISOString(),
      pricing,
      items: completedResults,
    });
  };

  const loadSavedRun = (id: string) => {
    const saved = [...savedRuns, ...BUNDLED_EXAMPLE_RUNS].find(
      (run) => run.id === id,
    );
    if (!saved) return;
    matrixRunSession.current.detach();
    setPrompt(saved.prompt);
    setSelections(
      new Set(
        saved.items.map((item) => selectionKey(item.model, item.effort)),
      ),
    );
    setCells(cellsForRun(saved));
    setActiveRunId(saved.id);
    setTab("matrix");
  };

  const importRun = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 5_000_000) {
        throw new Error("Run files must be smaller than 5 MB.");
      }
      const data = JSON.parse(await file.text()) as unknown;
      if (!data || typeof data !== "object") {
        throw new Error("No run items found.");
      }
      const candidate = data as { prompt?: unknown; items?: unknown };
      if (!Array.isArray(candidate.items) || candidate.items.length === 0) {
        throw new Error("No run items found.");
      }
      const items = candidate.items
        .slice(0, 24)
        .map(normalizeImportedResult);
      if (items.some((item) => !item)) {
        throw new Error("One or more run items are invalid.");
      }
      const normalizedItems = items as MatrixRunResult[];
      if (
        new Set(
          normalizedItems.map((item) =>
            selectionKey(item.model, item.effort),
          ),
        ).size !== normalizedItems.length
      ) {
        throw new Error("Run files cannot repeat a model and reasoning pair.");
      }
      const importedPrompt =
        typeof candidate.prompt === "string"
          ? candidate.prompt.slice(0, 500)
          : "Imported run";
      matrixRunSession.current.detach();
      setPrompt(importedPrompt);
      setSelections(
        new Set(
          normalizedItems.map((item) =>
            selectionKey(item.model, item.effort),
          ),
        ),
      );
      setCells(
        normalizedItems.map((item) => ({
          key: selectionKey(item.model, item.effort),
          model: item.model,
          effort: item.effort,
          status: "complete",
          result: item,
        })),
      );
      persistRun(normalizedItems, importedPrompt);
    } catch {
      window.alert("That file is not a Valuemaxxing Lab run.");
    } finally {
      event.target.value = "";
    }
  };

  const runCacheExperiment = async () => {
    setCacheRun({ status: "running" });
    try {
      const response = await fetch("/api/experiments/cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: cacheModel }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(readError(payload, "The caching experiment failed."));
      }
      setCacheRun({
        status: "complete",
        result: payload as CacheExperimentResult,
      });
      saveStoredExperiment(CACHE_STORAGE_KEY, payload);
    } catch (error) {
      setCacheRun({
        status: "error",
        error: error instanceof Error ? error.message : "Experiment failed.",
      });
    }
  };

  const runPtcExperiment = async () => {
    setPtcRun({ status: "running" });
    try {
      const response = await fetch("/api/experiments/ptc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: ptcModel }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(readError(payload, "The PTC experiment failed."));
      }
      setPtcRun({
        status: "complete",
        result: payload as PtcExperimentResult,
      });
      saveStoredExperiment(PTC_STORAGE_KEY, payload);
    } catch (error) {
      setPtcRun({
        status: "error",
        error: error instanceof Error ? error.message : "Experiment failed.",
      });
    }
  };

  const runCompactionExperiment = async () => {
    setCompactionRun({ status: "running" });
    try {
      const response = await fetch("/api/experiments/compaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: compactionModel }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          readError(payload, "The compaction experiment failed."),
        );
      }
      setCompactionRun({
        status: "complete",
        result: payload as CompactionExperimentResult,
      });
      saveStoredExperiment(COMPACTION_STORAGE_KEY, payload);
    } catch (error) {
      setCompactionRun({
        status: "error",
        error: error instanceof Error ? error.message : "Experiment failed.",
      });
    }
  };

  return (
    <main className="lab-shell">
      <header className="site-header">
        <a
          className="brand"
          href="#"
          aria-label="Valuemaxxing Lab home"
          onClick={(event) => {
            event.preventDefault();
            setTab("frontier");
          }}
        >
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>VALUEMAXXING</strong>
            <small>LAB</small>
          </span>
        </a>

        <nav className="primary-nav" aria-label="Lab sections">
          <button
            aria-current={tab === "frontier" ? "page" : undefined}
            className={tab === "frontier" ? "is-active" : ""}
            onClick={() => setTab("frontier")}
            type="button"
          >
            Pareto frontier
          </button>
          <button
            aria-current={tab === "matrix" ? "page" : undefined}
            className={tab === "matrix" ? "is-active" : ""}
            onClick={() => setTab("matrix")}
            type="button"
          >
            Visual matrix
          </button>
          <button
            aria-current={tab === "optimize" ? "page" : undefined}
            className={tab === "optimize" ? "is-active" : ""}
            onClick={() => setTab("optimize")}
            type="button"
          >
            Optimization lab
          </button>
        </nav>

        <div className="header-actions">
          <StatusDot configured={configured} />
          {savedRuns.length || BUNDLED_EXAMPLE_RUNS.length ? (
            <select
              aria-label="Switch saved or included benchmark run"
              value={activeRunId}
              onChange={(event) => loadSavedRun(event.target.value)}
            >
              <option value="" disabled>
                Choose a run
              </option>
              {savedRuns.length ? (
                <optgroup label="Your saved runs">
                  {savedRuns.map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.name} · {run.items.length}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {BUNDLED_EXAMPLE_RUNS.length ? (
                <optgroup label="Included benchmarks">
                  {BUNDLED_EXAMPLE_RUNS.map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.name} · {run.items.length}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          ) : null}
        </div>
      </header>

      {configured === false && tab !== "frontier" ? (
        <div className="key-banner" role="status">
          <strong>API key missing.</strong>
          <span>
            Set <code>OPENAI_API_KEY</code> in <code>.env.local</code> and
            restart the local server.
          </span>
        </div>
      ) : null}

      {tab === "frontier" ? (
        <ParetoFrontier />
      ) : tab === "matrix" ? (
        <div className="tab-page matrix-page">
          <section className="page-intro">
            <div>
              <span className="eyebrow">02 · Visual matrix</span>
              <h1>One prompt. Three models.</h1>
            </div>
            <p>Six reasoning levels. Cost and latency per run.</p>
          </section>

          <section className="control-deck">
            <div className="prompt-panel">
              <div className="panel-heading">
                <div>
                  <span className="step-number">01</span>
                  <div>
                    <h2>Prompt</h2>
                  </div>
                </div>
                <span className="sentence-count">{prompt.length}/500</span>
              </div>
              <label className="prompt-field">
                <span className="sr-only">Visual brief</span>
                <textarea
                  disabled={viewingActiveRun}
                  value={prompt}
                  maxLength={500}
                  rows={3}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Describe one visual artifact…"
                />
                <span className="prompt-cursor" aria-hidden="true">
                  ↵
                </span>
              </label>
            </div>

            <div className="matrix-panel">
              <div className="panel-heading">
                <div>
                  <span className="step-number">02</span>
                  <div>
                    <h2>Model × reasoning</h2>
                  </div>
                </div>
                <div className="matrix-selection-actions">
                  <button
                    className="text-button"
                    disabled={viewingActiveRun}
                    type="button"
                    onClick={() =>
                      setSelections(
                        new Set(
                          MODEL_CATALOG.flatMap((model) =>
                            REASONING_EFFORTS.map((effort) =>
                              selectionKey(model.id, effort),
                            ),
                          ),
                        ),
                      )
                    }
                  >
                    Select all
                  </button>
                  <button
                    className="text-button"
                    disabled={viewingActiveRun}
                    type="button"
                    onClick={() => setSelections(new Set())}
                  >
                    Clear all
                  </button>
                </div>
              </div>

              <div className="matrix-table" role="group" aria-label="Run matrix">
                <div className="matrix-header">
                  <span>Model</span>
                  {REASONING_EFFORTS.map((effort) => (
                    <span key={effort}>{effort}</span>
                  ))}
                </div>
                {MODEL_CATALOG.map((model) => (
                  <div className="matrix-row" key={model.id}>
                    <div className="matrix-model">
                      <span style={{ background: model.accent }} />
                      <div>
                        <strong>{model.shortName}</strong>
                        <small>{model.description}</small>
                      </div>
                    </div>
                    {REASONING_EFFORTS.map((effort) => {
                      const key = selectionKey(model.id, effort);
                      const selected = selections.has(key);
                      return (
                        <button
                          key={effort}
                          type="button"
                          className={`matrix-cell ${selected ? "is-selected" : ""}`}
                          aria-pressed={selected}
                          aria-label={`${model.label}, ${effort} reasoning`}
                          disabled={viewingActiveRun}
                          onClick={() => toggleSelection(key)}
                        >
                          <span>{selected ? "✓" : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div className="run-panel">
              <div className="run-summary">
                <span className="step-number">03</span>
                <div aria-live="polite">
                  <strong>
                    {isRunning && activeRunId
                      ? "Run continuing in background"
                      : `${orderedSelections.length} run${
                          orderedSelections.length === 1 ? "" : "s"
                        } selected`}
                  </strong>
                </div>
              </div>
              <label className="concurrency-control">
                <span>Concurrency</span>
                <input
                  type="range"
                  disabled={viewingActiveRun}
                  min="1"
                  max="4"
                  value={concurrency}
                  onChange={(event) =>
                    setConcurrency(Number(event.target.value))
                  }
                />
                <strong>{concurrency}</strong>
              </label>
              {isRunning ? (
                <button
                  className="run-button cancel-button"
                  type="button"
                  onClick={cancelMatrix}
                >
                  Cancel run
                </button>
              ) : (
                <button
                  className="run-button"
                  type="button"
                  disabled={
                    !orderedSelections.length ||
                    prompt.trim().length < 8 ||
                    configured === false
                  }
                  onClick={runMatrix}
                >
                  <span>Run matrix</span>
                  <b>→</b>
                </button>
              )}
            </div>
          </section>

          <section className="results-section" ref={resultsRef}>
            <header className="results-header">
              <div>
                <span className="eyebrow">Output</span>
                <h2>Artifacts</h2>
                <span className="results-summary">
                  {cells.length
                    ? `${completedResults.length} / ${cells.length} complete${
                        activeRunId
                          ? BUNDLED_EXAMPLE_RUNS.find(
                              (run) => run.id === activeRunId,
                            )?.items.every((item) => item.source === "sample")
                            ? " · bundled example"
                            : BUNDLED_EXAMPLE_RUNS.some(
                                  (run) => run.id === activeRunId,
                                )
                              ? " · recorded benchmark"
                              : " · saved locally"
                          : ""
                      }`
                    : "3 models × 6 reasoning levels"}
                </span>
              </div>
              <div className="result-actions">
                <input
                  ref={importRef}
                  type="file"
                  accept="application/json"
                  className="sr-only"
                  onChange={importRun}
                />
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => importRef.current?.click()}
                >
                  Import
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!completedResults.length}
                  onClick={exportRun}
                >
                  Download run
                </button>
              </div>
            </header>

            <div className="artifact-matrix-scroll">
              <div
                className="artifact-matrix"
                role="grid"
                aria-label="Artifact matrix"
              >
                <div className="artifact-matrix-header" role="row">
                  <span role="columnheader">Model</span>
                  {REASONING_EFFORTS.map((effort) => (
                    <span key={effort} role="columnheader">
                      {effort}
                    </span>
                  ))}
                </div>
                {MODEL_CATALOG.map((model) => (
                  <div className="artifact-matrix-row" key={model.id} role="row">
                    <div className="artifact-matrix-model" role="rowheader">
                      <span style={{ background: model.accent }} />
                      <div>
                        <strong>{model.shortName}</strong>
                        <small>{model.description}</small>
                      </div>
                    </div>
                    {REASONING_EFFORTS.map((effort) => {
                      const key = selectionKey(model.id, effort);
                      const cell = cellsByKey.get(key);
                      if (cell) {
                        return (
                          <ResultCard
                            key={key}
                            cell={cell}
                            onInspect={setInspecting}
                          />
                        );
                      }
                      return (
                        <div
                          key={key}
                          role="gridcell"
                          className={`artifact-slot ${
                            selections.has(key) ? "is-selected" : ""
                          }`}
                          aria-label={`${model.label}, ${effort} reasoning: ${
                            selections.has(key) ? "selected" : "not selected"
                          }`}
                        >
                          <span aria-hidden="true">
                            {selections.has(key) ? "○" : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="tab-page optimization-page">
          <section className="page-intro optimization-intro">
            <div>
              <span className="eyebrow">03 · Optimization lab</span>
              <h1>Change the harness, not the task.</h1>
            </div>
            <p>Same task. Compare tokens, latency, and cost.</p>
          </section>

          <section className="experiment-card cache-card">
            <header className="experiment-header">
              <div className="experiment-number">A</div>
              <div className="experiment-title">
                <span className="eyebrow">Prompt caching</span>
                <h2>Caching off vs. caching on.</h2>
                <p>Prime once. Ask the same question twice.</p>
              </div>
              <div className="experiment-action">
                <label>
                  <span>Model</span>
                  <select
                    aria-label="Prompt caching model"
                    disabled={cacheRun.status === "running"}
                    value={cacheModel}
                    onChange={(event) =>
                      setCacheModel(event.target.value as ModelId)
                    }
                  >
                    {MODEL_CATALOG.map((model) => (
                      <option value={model.id} key={model.id}>
                        {model.shortName}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="run-button"
                  type="button"
                  onClick={runCacheExperiment}
                  disabled={
                    cacheRun.status === "running" || configured === false
                  }
                >
                  {cacheRun.status === "running" ? (
                    <>
                      <Spinner /> Running comparison
                    </>
                  ) : (
                    <>
                      Run comparison <b>→</b>
                    </>
                  )}
                </button>
              </div>
            </header>

            <div
              className="experiment-setup cache-flow"
              role="group"
              aria-label="How prompt caching works"
            >
              <div className="cache-flow-row">
                <span className="setup-label">Prime</span>
                <div className="cache-flow-track">
                  <span className="cache-flow-prefix">
                    <strong>Shared prefix</strong>
                    <span>~5.5K tokens</span>
                  </span>
                  <span className="cache-flow-tail">Activation question</span>
                </div>
                <span className="cache-flow-operation">Cache write</span>
              </div>
              <div className="cache-flow-row">
                <span className="setup-label">Control</span>
                <div className="cache-flow-track">
                  <span className="cache-flow-prefix is-uncached">
                    <strong>Shared prefix</strong>
                    <span>~5.5K tokens</span>
                  </span>
                  <span className="cache-flow-tail">Retention question</span>
                </div>
                <span className="cache-flow-operation is-uncached">
                  Cache off
                </span>
              </div>
              <div className="cache-flow-row">
                <span className="setup-label">Cached</span>
                <div className="cache-flow-track">
                  <span className="cache-flow-prefix is-cached">
                    <strong>Shared prefix</strong>
                    <span>~5.5K tokens</span>
                  </span>
                  <span className="cache-flow-tail">Retention question</span>
                </div>
                <span className="cache-flow-operation is-cached">
                  Cache read
                </span>
              </div>
            </div>

            {cacheRun.status === "error" ? (
              <div className="experiment-error" role="alert">
                {cacheRun.error}
              </div>
            ) : null}
            {cacheRun.status === "running" ? (
              <div className="experiment-progress">
                <span />
                <div>
                  <strong>Priming, then comparing the same question.</strong>
                  <p>Three API requests.</p>
                </div>
              </div>
            ) : null}
            {cacheRun.result ? <CacheResults result={cacheRun.result} /> : null}
          </section>

          <section className="experiment-card ptc-card">
            <header className="experiment-header">
              <div className="experiment-number">B</div>
              <div className="experiment-title">
                <span className="eyebrow">Programmatic tool calling</span>
                <h2>Move the loop out of the transcript.</h2>
                <p>Real tool calls. Local backend. Synthetic data.</p>
              </div>
              <div className="experiment-action">
                <label>
                  <span>Model</span>
                  <select
                    aria-label="Programmatic tool calling model"
                    disabled={ptcRun.status === "running"}
                    value={ptcModel}
                    onChange={(event) =>
                      setPtcModel(event.target.value as ModelId)
                    }
                  >
                    {MODEL_CATALOG.filter(
                      (model) => model.id !== "gpt-5.6-luna",
                    ).map((model) => (
                      <option value={model.id} key={model.id}>
                        {model.shortName}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="run-button"
                  type="button"
                  onClick={runPtcExperiment}
                  disabled={ptcRun.status === "running" || configured === false}
                >
                  {ptcRun.status === "running" ? (
                    <>
                      <Spinner /> Running comparison
                    </>
                  ) : (
                    <>
                      Run comparison <b>→</b>
                    </>
                  )}
                </button>
              </div>
            </header>

            <div className="ptc-task">
              <span>Fixed task</span>
              <p>
                West-region accounts with &gt;30% usage growth and an open P1
                case.
              </p>
              <div className="tool-chips">
                <span>list_accounts</span>
                <span>get_usage</span>
                <span>get_support</span>
              </div>
            </div>

            <div
              className="experiment-setup tool-flow"
              role="group"
              aria-label="How programmatic tool calling works"
            >
              <div className="tool-flow-row">
                <span className="setup-label">Direct loop</span>
                <div className="tool-flow-track">
                  <span>Model</span>
                  <span className="tool-flow-arrow">↔</span>
                  <span>Tools</span>
                  <span className="tool-flow-arrow">↔</span>
                  <span>Model</span>
                  <span className="tool-flow-arrow">→</span>
                  <strong>Answer</strong>
                </div>
              </div>
              <div className="tool-flow-row is-hosted">
                <span className="setup-label">Hosted loop</span>
                <div className="tool-flow-track">
                  <span>Model</span>
                  <span className="tool-flow-arrow">→</span>
                  <span className="hosted-loop-step">Hosted tool loop</span>
                  <span className="tool-flow-arrow">→</span>
                  <strong>Answer</strong>
                </div>
              </div>
            </div>

            {ptcRun.status === "error" ? (
              <div className="experiment-error" role="alert">
                {ptcRun.error}
              </div>
            ) : null}
            {ptcRun.status === "running" ? (
              <div className="experiment-progress">
                <span />
                <div>
                  <strong>Comparing direct and hosted tool loops.</strong>
                  <p>Same task, same tools.</p>
                </div>
              </div>
            ) : null}
            {ptcRun.result ? <PtcResults result={ptcRun.result} /> : null}
          </section>

          <section className="experiment-card compaction-card">
            <header className="experiment-header">
              <div className="experiment-number">C</div>
              <div className="experiment-title">
                <span className="eyebrow">Context compaction</span>
                <h2>Compress the handoff, not the answer.</h2>
                <p>72 incident shifts. One identical escalation.</p>
              </div>
              <div className="experiment-action">
                <label>
                  <span>Model</span>
                  <select
                    aria-label="Context compaction model"
                    disabled={compactionRun.status === "running"}
                    value={compactionModel}
                    onChange={(event) =>
                      setCompactionModel(event.target.value as ModelId)
                    }
                  >
                    {MODEL_CATALOG.map((model) => (
                      <option value={model.id} key={model.id}>
                        {model.shortName}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="run-button"
                  type="button"
                  onClick={runCompactionExperiment}
                  disabled={
                    compactionRun.status === "running" || configured === false
                  }
                >
                  {compactionRun.status === "running" ? (
                    <>
                      <Spinner /> Running comparison
                    </>
                  ) : (
                    <>
                      Run comparison <b>→</b>
                    </>
                  )}
                </button>
              </div>
            </header>

            <div className="ptc-task">
              <span>Fixed task</span>
              <p>Find the blocked P0 launch, owner, blocker, and recovery token.</p>
              <div className="tool-chips">
                <span>72 handoffs</span>
                <span>~25K tokens</span>
              </div>
            </div>

            <div
              className="experiment-setup tool-flow"
              role="group"
              aria-label="How context compaction works"
            >
              <div className="tool-flow-row">
                <span className="setup-label">Full history</span>
                <div className="tool-flow-track">
                  <span>72 handoffs</span>
                  <span className="tool-flow-arrow">→</span>
                  <span>Same question</span>
                  <span className="tool-flow-arrow">→</span>
                  <strong>Answer</strong>
                </div>
              </div>
              <div className="tool-flow-row is-hosted">
                <span className="setup-label">Compacted</span>
                <div className="tool-flow-track">
                  <span>72 handoffs</span>
                  <span className="tool-flow-arrow">→</span>
                  <span className="hosted-loop-step">Compact</span>
                  <span className="tool-flow-arrow">→</span>
                  <span>Same question</span>
                  <span className="tool-flow-arrow">→</span>
                  <strong>Answer</strong>
                </div>
              </div>
            </div>

            {compactionRun.status === "error" ? (
              <div className="experiment-error" role="alert">
                {compactionRun.error}
              </div>
            ) : null}
            {compactionRun.status === "running" ? (
              <div className="experiment-progress">
                <span />
                <div>
                  <strong>Comparing full and compacted incident history.</strong>
                  <p>Three API requests across 72 handoffs.</p>
                </div>
              </div>
            ) : null}
            {compactionRun.result ? (
              <CompactionResults result={compactionRun.result} />
            ) : null}
          </section>
        </div>
      )}

      <footer className="site-footer">
        <p>
          Local by design. Your API key stays server-side; generated artifacts
          render in a network-blocked sandbox.
        </p>
        <p>
          Estimates use standard-tier list prices from {pricing.updated}. This
          harness compares runs; it does not declare a winner.
        </p>
      </footer>

      {inspecting ? (
        <ResultInspector
          result={inspecting}
          onClose={() => setInspecting(null)}
        />
      ) : null}
    </main>
  );
}
