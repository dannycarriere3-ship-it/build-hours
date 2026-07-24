"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  FRONTIER_DATASET,
  getDominatingModels,
  getParetoFrontier,
  hasMetricsForView,
  intelligenceFor,
  parseFrontierDataset,
  type FrontierDataset,
  type FrontierModel,
  type FrontierView,
  type WorkloadLens,
} from "@/lib/frontier";

type ProviderFilter = "all" | "openai";
type Coordinate = { x: number; y: number };
type Rotation = { yaw: number; pitch: number };
type OrbitPreset = { id: string; label: string; rotation: Rotation };
type Ranges = {
  intelligence: { min: number; max: number };
  cost: { min: number; max: number };
  seconds: { min: number; max: number };
};
type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  initialRotation: Rotation;
  pendingRotation: Rotation | null;
  frame: number | null;
};

const CHART_WIDTH = 880;
const CHART_HEIGHT = 560;
const PLOT = { left: 97, right: 825, top: 64, bottom: 462 };
const DEFAULT_ROTATION = { yaw: -0.64, pitch: 0.31 };
const ORBIT_PRESETS: OrbitPreset[] = [
  { id: "overview", label: "Overview", rotation: DEFAULT_ROTATION },
  { id: "cost", label: "Cost", rotation: { yaw: -1.28, pitch: 0.24 } },
  { id: "speed", label: "Speed", rotation: { yaw: -0.12, pitch: 0.24 } },
  { id: "above", label: "Above", rotation: { yaw: -0.64, pitch: 0.72 } },
];
const MAX_IMPORT_BYTES = 512 * 1024;
const VIEW_OPTIONS: { id: FrontierView; label: string }[] = [
  { id: "3d", label: "3D frontier" },
  { id: "cost", label: "Score × cost" },
  { id: "speed", label: "Score × speed" },
];
function normalize(value: number, min: number, max: number) {
  return max === min ? 0.5 : (value - min) / (max - min);
}

function normalizeLog(value: number, min: number, max: number) {
  return normalize(Math.log(value), Math.log(min), Math.log(max));
}

function bounded(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatMoney(value: number | null) {
  if (value === null) return "—";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatSeconds(value: number | null) {
  if (value === null) return "—";
  if (value < 10) return `${value.toFixed(1)}s`;
  if (value < 100) return `${Math.round(value)}s`;
  return `${Math.round(value).toLocaleString("en-US")}s`;
}

function formatIntelligence(value: number) {
  return value % 1 === 0 ? String(value) : value.toFixed(1);
}

function providerStyle(color: string): CSSProperties {
  return { "--frontier-provider-color": color } as CSSProperties;
}

function plotRanges(models: FrontierModel[], lens: WorkloadLens): Ranges {
  let minIntelligence = Number.POSITIVE_INFINITY;
  let maxIntelligence = Number.NEGATIVE_INFINITY;
  let minCost = Number.POSITIVE_INFINITY;
  let maxCost = Number.NEGATIVE_INFINITY;
  let minSeconds = Number.POSITIVE_INFINITY;
  let maxSeconds = Number.NEGATIVE_INFINITY;

  for (const model of models) {
    const intelligence = intelligenceFor(model, lens);
    minIntelligence = Math.min(minIntelligence, intelligence);
    maxIntelligence = Math.max(maxIntelligence, intelligence);
    if (model.costPerTask !== null) {
      minCost = Math.min(minCost, model.costPerTask);
      maxCost = Math.max(maxCost, model.costPerTask);
    }
    if (model.secondsPerTask !== null) {
      minSeconds = Math.min(minSeconds, model.secondsPerTask);
      maxSeconds = Math.max(maxSeconds, model.secondsPerTask);
    }
  }

  return {
    intelligence: { min: minIntelligence, max: maxIntelligence },
    cost: Number.isFinite(minCost)
      ? { min: minCost, max: maxCost }
      : { min: 1, max: 1 },
    seconds: Number.isFinite(minSeconds)
      ? { min: minSeconds, max: maxSeconds }
      : { min: 1, max: 1 },
  };
}

function cubeProjection(
  coordinate: { x: number; y: number; z: number },
  rotation: Rotation,
): Coordinate {
  const x = coordinate.x - 0.5;
  const y = coordinate.y - 0.5;
  const z = coordinate.z - 0.5;
  const rotatedX = x * Math.cos(rotation.yaw) + z * Math.sin(rotation.yaw);
  const depth = -x * Math.sin(rotation.yaw) + z * Math.cos(rotation.yaw);
  const rotatedY = y * Math.cos(rotation.pitch) - depth * Math.sin(rotation.pitch);

  return {
    x: 451 + rotatedX * 455,
    y: 282 - rotatedY * 345,
  };
}

function modelProjection(
  model: FrontierModel,
  lens: WorkloadLens,
  view: FrontierView,
  ranges: Ranges,
  rotation: Rotation,
): Coordinate {
  const intelligence = normalize(
    intelligenceFor(model, lens),
    ranges.intelligence.min,
    ranges.intelligence.max,
  );
  const affordability =
    model.costPerTask === null
      ? 0
      : 1 - normalizeLog(model.costPerTask, ranges.cost.min, ranges.cost.max);
  const speed =
    model.secondsPerTask === null
      ? 0
      : 1 - normalizeLog(model.secondsPerTask, ranges.seconds.min, ranges.seconds.max);

  if (view === "3d") {
    return cubeProjection({ x: affordability, y: intelligence, z: speed }, rotation);
  }

  const horizontal = view === "cost" ? affordability : speed;
  return {
    x: PLOT.left + horizontal * (PLOT.right - PLOT.left),
    y: PLOT.bottom - intelligence * (PLOT.bottom - PLOT.top),
  };
}

function linePath(points: Coordinate[]) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
}

function chartTitle(view: FrontierView, lens: WorkloadLens) {
  const measure = lens === "routine" ? "Routine fit" : "Benchmark score";
  if (view === "cost") return `${measure} vs. cost per task`;
  if (view === "speed") return `${measure} vs. time per task`;
  return `${measure}, cost, and speed`;
}

function chartDescription(view: FrontierView) {
  if (view === "3d") {
    return "Drag to orbit · Hover a model to inspect";
  }

  return "Hover a model to inspect · Dashed line marks the frontier";
}

function CubeAxes({ lens, rotation }: { lens: WorkloadLens; rotation: Rotation }) {
  const origin = cubeProjection({ x: 0, y: 0, z: 0 }, rotation);
  const costEnd = cubeProjection({ x: 1, y: 0, z: 0 }, rotation);
  const intelligenceEnd = cubeProjection({ x: 0, y: 1, z: 0 }, rotation);
  const speedEnd = cubeProjection({ x: 0, y: 0, z: 1 }, rotation);
  const ticks = [0.2, 0.4, 0.6, 0.8, 1];

  return (
    <g aria-hidden="true">
      {ticks.map((tick) => {
        const left = cubeProjection({ x: 0, y: 0, z: tick }, rotation);
        const right = cubeProjection({ x: 1, y: 0, z: tick }, rotation);
        const front = cubeProjection({ x: tick, y: 0, z: 0 }, rotation);
        const back = cubeProjection({ x: tick, y: 0, z: 1 }, rotation);
        const lower = cubeProjection({ x: 0, y: tick, z: 0 }, rotation);
        const upper = cubeProjection({ x: 1, y: tick, z: 0 }, rotation);

        return (
          <g key={tick} className="frontier-grid">
            <line x1={left.x} y1={left.y} x2={right.x} y2={right.y} />
            <line x1={front.x} y1={front.y} x2={back.x} y2={back.y} />
            <line x1={lower.x} y1={lower.y} x2={upper.x} y2={upper.y} />
          </g>
        );
      })}

      <g className="frontier-axis">
        <line x1={origin.x} y1={origin.y} x2={costEnd.x} y2={costEnd.y} />
        <line x1={origin.x} y1={origin.y} x2={intelligenceEnd.x} y2={intelligenceEnd.y} />
        <line x1={origin.x} y1={origin.y} x2={speedEnd.x} y2={speedEnd.y} />
      </g>

      <text className="frontier-axis-label" x={costEnd.x + 12} y={costEnd.y + 7}>
        lower cost →
      </text>
      <text className="frontier-axis-label" x={intelligenceEnd.x - 7} y={intelligenceEnd.y - 14}>
        {lens === "routine" ? "routine fit (illustrative) ↑" : "benchmark score ↑"}
      </text>
      <text className="frontier-axis-label" x={speedEnd.x - 8} y={speedEnd.y - 15} textAnchor="end">
        faster →
      </text>
    </g>
  );
}

function PlaneAxes({
  lens,
  ranges,
  view,
}: {
  lens: WorkloadLens;
  ranges: Ranges;
  view: "cost" | "speed";
}) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const horizontalRange = view === "cost" ? ranges.cost : ranges.seconds;

  return (
    <g aria-hidden="true">
      {ticks.map((tick) => {
        const x = PLOT.left + tick * (PLOT.right - PLOT.left);
        const y = PLOT.bottom - tick * (PLOT.bottom - PLOT.top);
        const intelligence =
          ranges.intelligence.min + tick * (ranges.intelligence.max - ranges.intelligence.min);
        const horizontalValue = Math.exp(
          Math.log(horizontalRange.max) -
            tick * (Math.log(horizontalRange.max) - Math.log(horizontalRange.min)),
        );

        return (
          <g key={tick}>
            <line className="frontier-grid" x1={PLOT.left} y1={y} x2={PLOT.right} y2={y} />
            <line className="frontier-grid" x1={x} y1={PLOT.top} x2={x} y2={PLOT.bottom} />
            <text className="frontier-axis-label" x={PLOT.left - 13} y={y + 3} textAnchor="end">
              {formatIntelligence(intelligence)}
            </text>
            <text className="frontier-axis-label" x={x} y={PLOT.bottom + 21} textAnchor="middle">
              {view === "cost" ? formatMoney(horizontalValue) : formatSeconds(horizontalValue)}
            </text>
          </g>
        );
      })}

      <line className="frontier-axis" x1={PLOT.left} y1={PLOT.bottom} x2={PLOT.right} y2={PLOT.bottom} />
      <line className="frontier-axis" x1={PLOT.left} y1={PLOT.top} x2={PLOT.left} y2={PLOT.bottom} />
      <text className="frontier-axis-label" x={PLOT.left} y={PLOT.top - 16}>
        {lens === "routine" ? "routine fit (illustrative) ↑" : "benchmark score ↑"}
      </text>
      <text className="frontier-axis-label" x={PLOT.right} y={PLOT.bottom + 48} textAnchor="end">
        {view === "cost"
          ? "lower cost per task → · log scale"
          : "faster time per task → · log scale"}
      </text>
    </g>
  );
}

function FrontierPoint({
  model,
  coordinate,
  isFrontier,
  isHovered,
  isSelected,
  showLabel,
  onHover,
  onSelect,
}: {
  model: FrontierModel;
  coordinate: Coordinate;
  isFrontier: boolean;
  isHovered: boolean;
  isSelected: boolean;
  showLabel: boolean;
  onHover: (modelId: string | null) => void;
  onSelect: (modelId: string) => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(model.id);
    }
  };
  const classes = [
    "frontier-point",
    model.provider === "OpenAI" ? "frontier-point-openai" : "frontier-point-other",
    isFrontier ? "frontier-point-frontier" : "",
    isSelected ? "frontier-point-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <g
      aria-label={`${model.label}, ${model.provider}${isFrontier ? ", on the Pareto frontier" : ""}`}
      aria-pressed={isSelected}
      className={classes}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(model.id)}
      onFocus={() => onHover(model.id)}
      onKeyDown={handleKeyDown}
      onPointerEnter={() => onHover(model.id)}
      onPointerLeave={() => onHover(null)}
      role="button"
      style={providerStyle(model.color)}
      tabIndex={0}
      transform={`translate(${coordinate.x.toFixed(1)} ${coordinate.y.toFixed(1)})`}
    >
      <circle className="frontier-point-hit-target" r={14} />
      <circle r={isSelected ? 7.3 : isFrontier ? 6.1 : 4.8} />
      {showLabel ? (
        <text className="frontier-point-label" x={9} y={isSelected ? -9 : -7}>
          {isHovered ? model.label : model.shortLabel}
        </text>
      ) : null}
    </g>
  );
}

export default function ParetoFrontier() {
  const [dataset, setDataset] = useState<FrontierDataset>(FRONTIER_DATASET);
  const [view, setView] = useState<FrontierView>("3d");
  const [lens] = useState<WorkloadLens>("general");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rotation, setRotation] = useState<Rotation>(DEFAULT_ROTATION);
  const [isDragging, setIsDragging] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const filteredModels = useMemo(
    () =>
      providerFilter === "openai"
        ? dataset.models.filter((model) => model.provider === "OpenAI")
        : dataset.models,
    [dataset.models, providerFilter],
  );
  const visibleModels = useMemo(
    () => filteredModels.filter((model) => hasMetricsForView(model, view)),
    [filteredModels, view],
  );
  const frontierModels = useMemo(
    () => getParetoFrontier(visibleModels, lens, view),
    [visibleModels, lens, view],
  );
  const frontierIds = useMemo(
    () => new Set(frontierModels.map((model) => model.id)),
    [frontierModels],
  );
  const selectedModel =
    visibleModels.find((model) => model.id === selectedId) ??
    frontierModels.find((model) => model.provider === "OpenAI") ??
    frontierModels[0] ??
    visibleModels[0] ??
    null;
  const dominatingModels = useMemo(
    () =>
      selectedModel
        ? getDominatingModels(selectedModel, visibleModels, lens, view)
        : [],
    [selectedModel, visibleModels, lens, view],
  );
  const ranges = useMemo(
    () => (visibleModels.length ? plotRanges(visibleModels, lens) : null),
    [visibleModels, lens],
  );
  const providers = useMemo(() => {
    const unique = new Map<string, string>();
    for (const model of visibleModels) {
      if (!unique.has(model.provider)) unique.set(model.provider, model.color);
    }
    return Array.from(unique, ([name, color]) => ({ name, color }));
  }, [visibleModels]);
  const plottedModels = useMemo(
    () =>
      [...visibleModels].sort((left, right) => {
        const leftRank = Number(frontierIds.has(left.id)) + Number(left.id === selectedModel?.id) * 2;
        const rightRank = Number(frontierIds.has(right.id)) + Number(right.id === selectedModel?.id) * 2;
        return leftRank - rightRank;
      }),
    [visibleModels, frontierIds, selectedModel?.id],
  );
  const frontierPath = useMemo(() => {
    if (!ranges || view === "3d" || frontierModels.length < 2) return null;

    const points = frontierModels
      .map((model) => modelProjection(model, lens, view, ranges, rotation))
      .sort((left, right) => left.x - right.x);
    return linePath(points);
  }, [frontierModels, lens, ranges, rotation, view]);

  useEffect(
    () => () => {
      if (dragRef.current?.frame !== null && dragRef.current?.frame !== undefined) {
        cancelAnimationFrame(dragRef.current.frame);
      }
    },
    [],
  );

  const finishDrag = useCallback((event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.frame !== null) cancelAnimationFrame(drag.frame);
    if (drag.pendingRotation) setRotation(drag.pendingRotation);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  const handlePointerDown = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if (view !== "3d" || event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest(".frontier-point")) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        initialRotation: rotation,
        pendingRotation: null,
        frame: null,
      };
      setIsDragging(true);
    },
    [rotation, view],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      drag.pendingRotation = {
        yaw: drag.initialRotation.yaw + (event.clientX - drag.startX) * 0.009,
        pitch: bounded(
          drag.initialRotation.pitch - (event.clientY - drag.startY) * 0.006,
          -0.35,
          0.85,
        ),
      };

      if (drag.frame !== null) return;
      drag.frame = requestAnimationFrame(() => {
        if (!dragRef.current) return;
        if (dragRef.current.pendingRotation) setRotation(dragRef.current.pendingRotation);
        dragRef.current.frame = null;
      });
    },
    [],
  );

  const handleChartKeyDown = useCallback(
    (event: KeyboardEvent<SVGSVGElement>) => {
      if (view !== "3d") return;

      const adjustment: Record<string, Rotation> = {
        ArrowLeft: { yaw: -0.12, pitch: 0 },
        ArrowRight: { yaw: 0.12, pitch: 0 },
        ArrowUp: { yaw: 0, pitch: 0.08 },
        ArrowDown: { yaw: 0, pitch: -0.08 },
      };
      const change = adjustment[event.key];
      if (!change) return;

      event.preventDefault();
      setRotation((current) => ({
        yaw: current.yaw + change.yaw,
        pitch: bounded(current.pitch + change.pitch, -0.35, 0.85),
      }));
    },
    [view],
  );

  const handleModelHover = useCallback((modelId: string | null) => {
    setHoveredId(modelId);
    if (modelId) setSelectedId(modelId);
  }, []);

  const importDataset = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_IMPORT_BYTES) {
      setImportError("Benchmark imports must be smaller than 512 KB.");
      event.target.value = "";
      return;
    }

    try {
      const candidate = parseFrontierDataset(JSON.parse(await file.text()));
      if (!candidate) {
        throw new Error(
          "That file does not match the benchmark JSON format in data/openai-frontier-models.json.",
        );
      }
      setDataset(candidate);
      setSelectedId(null);
      setImportError(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Unable to import that benchmark file.");
    }

    event.target.value = "";
  };

  const resetDataset = () => {
    setDataset(FRONTIER_DATASET);
    setSelectedId(null);
    setImportError(null);
  };

  return (
    <div className="tab-page frontier-page">
      <section className="frontier-intro">
        <div>
          <span className="frontier-eyebrow">01 · Pareto frontier</span>
          <h1 className="frontier-title">Benchmark score, cost, speed.</h1>
        </div>
      </section>

      <section aria-label="Frontier visualization controls" className="frontier-controls">
        <div aria-label="Frontier chart view" className="frontier-segmented" role="group">
          {VIEW_OPTIONS.map((option) => (
            <button
              aria-pressed={view === option.id}
              className={`frontier-segment${view === option.id ? " frontier-segment-active" : ""}`}
              key={option.id}
              onClick={() => setView(option.id)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="frontier-filters">
          <div aria-label="Model provider" className="frontier-filter-group" role="group">
            {([
              { id: "all", label: "All models" },
              { id: "openai", label: "OpenAI" },
            ] as const).map((option) => (
              <button
                aria-pressed={providerFilter === option.id}
                className={`frontier-filter-button${
                  providerFilter === option.id ? " frontier-filter-active" : ""
                }`}
                key={option.id}
                onClick={() => setProviderFilter(option.id)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="frontier-layout">
        <div className="frontier-chart-card">
          <div className="frontier-chart-header">
            <div>
              <h2 className="frontier-chart-title">{chartTitle(view, lens)}</h2>
              <span className="frontier-source-badge">
                {dataset.illustrative ? "Illustrative dataset" : dataset.source}
              </span>
              <p className="frontier-chart-subtitle">{chartDescription(view)}</p>
            </div>
          </div>

          {ranges ? (
            <div
              className={`frontier-chart-wrap${view === "3d" ? " frontier-chart-wrap-orbit" : ""}`}
            >
              <svg
                aria-label={`${chartTitle(view, lens)} with ${visibleModels.length} models and ${frontierModels.length} Pareto-efficient configurations`}
                className="frontier-chart"
                onKeyDown={handleChartKeyDown}
                onPointerCancel={finishDrag}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishDrag}
                role="group"
                style={{ cursor: view === "3d" ? (isDragging ? "grabbing" : "grab") : "default" }}
                tabIndex={view === "3d" ? 0 : undefined}
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              >
                {view === "3d" ? (
                  <CubeAxes lens={lens} rotation={rotation} />
                ) : (
                  <PlaneAxes lens={lens} ranges={ranges} view={view} />
                )}

                {frontierPath ? <path className="frontier-frontier-line" d={frontierPath} /> : null}

                {view === "3d"
                  ? plottedModels.map((model) => {
                      if (model.costPerTask === null || model.secondsPerTask === null) {
                        return null;
                      }

                      const point = modelProjection(model, lens, view, ranges, rotation);
                      const floor = cubeProjection(
                        {
                          x:
                            1 -
                            normalizeLog(model.costPerTask, ranges.cost.min, ranges.cost.max),
                          y: 0,
                          z:
                            1 -
                            normalizeLog(
                              model.secondsPerTask,
                              ranges.seconds.min,
                              ranges.seconds.max,
                            ),
                        },
                        rotation,
                      );

                      return (
                        <line
                          key={`stem-${model.id}`}
                          opacity={frontierIds.has(model.id) ? 0.21 : 0.12}
                          stroke={model.provider === "OpenAI" ? "var(--green)" : model.color}
                          strokeWidth="1"
                          x1={point.x}
                          x2={floor.x}
                          y1={point.y}
                          y2={floor.y}
                        />
                      );
                    })
                  : null}

                {plottedModels.map((model) => {
                  const isFrontier = frontierIds.has(model.id);
                  const isHovered = hoveredId === model.id;
                  const isSelected = selectedModel?.id === model.id;
                  const showLabel =
                    isHovered || isSelected || (isFrontier && view !== "3d");

                  return (
                    <FrontierPoint
                      coordinate={modelProjection(model, lens, view, ranges, rotation)}
                      isFrontier={isFrontier}
                      isHovered={isHovered}
                      isSelected={isSelected}
                      key={model.id}
                      model={model}
                      onHover={handleModelHover}
                      onSelect={setSelectedId}
                      showLabel={showLabel}
                    />
                  );
                })}
              </svg>
              {view === "3d" ? (
                <div aria-label="3D camera angles" className="frontier-orbit-toolbar" role="group">
                  <span aria-hidden="true" className="frontier-orbit-label">
                    View
                  </span>
                  {ORBIT_PRESETS.map((preset) => {
                    const isActive =
                      Math.abs(rotation.yaw - preset.rotation.yaw) < 0.015 &&
                      Math.abs(rotation.pitch - preset.rotation.pitch) < 0.015;

                    return (
                      <button
                        aria-label={`${preset.label} camera angle`}
                        aria-pressed={isActive}
                        className={`frontier-orbit-preset${
                          isActive ? " frontier-orbit-preset-active" : ""
                        }`}
                        key={preset.id}
                        onClick={() => setRotation(preset.rotation)}
                        type="button"
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="frontier-empty">There are no models in the selected benchmark slice.</div>
          )}

          <div className="frontier-chart-footer">
            <div aria-label="Provider legend" className="frontier-legend">
              {providers.map((provider) => (
                <span className="frontier-legend-item" key={provider.name}>
                  <i
                    aria-hidden="true"
                    className={`frontier-legend-dot${
                      provider.name === "OpenAI" ? " frontier-point-openai" : ""
                    }`}
                    style={providerStyle(provider.color)}
                  />
                  {provider.name}
                </span>
              ))}
            </div>
            <span>
              {visibleModels.length === filteredModels.length
                ? `${visibleModels.length} models`
                : `${visibleModels.length} of ${filteredModels.length} models`}
            </span>
          </div>
        </div>

        <aside aria-label="Selected model" className="frontier-sidebar">
          {selectedModel ? (
            <div className="frontier-sidebar-card">
              <h2 className="frontier-selected-name">{selectedModel.label}</h2>
              <span className="frontier-provider">
                {selectedModel.provider} · {selectedModel.reasoning}
              </span>
              <br />
              <span
                className={`frontier-status ${
                  frontierIds.has(selectedModel.id)
                    ? "frontier-status-efficient"
                    : "frontier-status-dominated"
                }`}
              >
                {frontierIds.has(selectedModel.id) ? "Pareto efficient" : "Dominated"}
              </span>

              <div className="frontier-metrics">
                <div className="frontier-metric">
                  <span className="frontier-metric-value">
                    {formatIntelligence(intelligenceFor(selectedModel, lens))}
                  </span>
                  <span className="frontier-metric-label">
                    {lens === "routine" ? "derived routine index" : "benchmark score"}
                  </span>
                </div>
                <div className="frontier-metric">
                  <span className="frontier-metric-value">{formatMoney(selectedModel.costPerTask)}</span>
                  <span className="frontier-metric-label">cost / task</span>
                </div>
                <div className="frontier-metric">
                  <span className="frontier-metric-value">{formatSeconds(selectedModel.secondsPerTask)}</span>
                  <span className="frontier-metric-label">wall time / task</span>
                </div>
                <div className="frontier-metric">
                  <span className="frontier-metric-value">{selectedModel.family}</span>
                  <span className="frontier-metric-label">model family</span>
                </div>
              </div>

              {dominatingModels[0] ? (
                <p className="frontier-domination">
                  Dominated by <strong>{dominatingModels[0].shortLabel}</strong>.
                </p>
              ) : null}
            </div>
          ) : null}
        </aside>
      </section>

      <footer className="frontier-data-note">
        <p>
          <strong>{dataset.name}</strong> ·{" "}
          <a href={dataset.sourceUrl} rel="noreferrer" target="_blank">
            {dataset.source}
          </a>{" "}
          · Snapshot {dataset.updated}. {dataset.sourceNote}
          {dataset.illustrative || lens === "routine" ? " Routine scores are illustrative." : null}
        </p>
        <div className="frontier-data-actions">
          <input
            accept="application/json,.json"
            aria-label="Import benchmark JSON"
            className="sr-only"
            onChange={importDataset}
            ref={fileInputRef}
            type="file"
          />
          <button
            className="frontier-data-button"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            Import JSON
          </button>
          {dataset !== FRONTIER_DATASET ? (
            <button className="frontier-data-button" onClick={resetDataset} type="button">
              Restore snapshot
            </button>
          ) : null}
        </div>
      </footer>
      {importError ? (
        <p className="frontier-import-error" role="alert">
          {importError}
        </p>
      ) : null}
    </div>
  );
}
