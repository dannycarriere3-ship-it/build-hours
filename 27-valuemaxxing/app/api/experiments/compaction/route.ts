import { isModelId, type ModelId } from "@/lib/catalog";
import {
  assertCompleted,
  compactResponse,
  createResponse,
  estimateCost,
  extractOutputText,
  formatApiError,
  normalizeUsage,
} from "@/lib/openai";
import { LAB_PROMPTS } from "@/lib/prompts";
import {
  readJsonObjectRequest,
  rejectUnsafeJsonRequest,
} from "@/lib/request-security";

export const runtime = "nodejs";

const SERVICES = [
  "payments-gateway",
  "identity-broker",
  "warehouse-sync",
  "checkout-router",
  "billing-ledger",
  "support-console",
  "search-indexer",
  "risk-engine",
] as const;

const OWNERS = [
  "Avery Chen",
  "Jordan Patel",
  "Morgan Diaz",
  "Riley Brooks",
  "Samir Haddad",
  "Taylor Kim",
] as const;

const HANDOFF_COUNT = 72;
const REPORTS_PER_HANDOFF = 4;

const HISTORY: Array<Record<string, unknown>> = [
  {
    role: "developer",
    content: LAB_PROMPTS.contextCompaction.developerInstructions,
  },
  ...Array.from({ length: HANDOFF_COUNT }, (_, handoff) => {
    const reports = Array.from({ length: REPORTS_PER_HANDOFF }, (_, offset) => {
      const index = handoff * REPORTS_PER_HANDOFF + offset;
      const critical = index === 84;
      const launchId = `LAUNCH-${100 + index}`;
      const service = critical
        ? "payments-gateway"
        : SERVICES[index % SERVICES.length];
      const owner = critical ? "Nadia Reyes" : OWNERS[index % OWNERS.length];
      const priority = critical ? "P0" : index % 7 === 0 ? "P1" : "P2";
      const status = critical || index % 9 === 0 ? "blocked" : "monitoring";
      const blocker = critical
        ? "cross-region replication lag"
        : `dependency check ${index % 13} awaiting routine verification`;
      const recoveryToken = critical
        ? "EMBER-214"
        : `SHIFT-${String(index + 31).padStart(3, "0")}`;

      return `${launchId} | service=${service} | priority=${priority} | status=${status} | owner=${owner} | blocker=${blocker} | recovery_token=${recoveryToken} | region=${index % 2 ? "eu-west" : "us-west"} | impact=${120 + ((index * 43) % 890)} affected accounts | next_update=${String(8 + (index % 12)).padStart(2, "0")}:00 UTC | mitigation=review deployment telemetry and confirm rollback readiness.`;
    }).join("\n");

    return [
      {
        role: "user",
        content: `Record incident shift ${String(handoff + 1).padStart(2, "0")}. Carry forward unresolved launches, owners, blockers, and recovery tokens.`,
      },
      {
        role: "assistant",
        content: `SHIFT ${String(handoff + 1).padStart(2, "0")} INCIDENT HANDOFF\n${reports}\nUnresolved launches, ownership, blockers, and recovery tokens are preserved for later escalation.`,
      },
    ];
  }).flat(),
];

type CompactionRequest = {
  model?: unknown;
};

function validateEscalation(output: string) {
  const normalized = output.toLowerCase();
  const required = [
    "launch-184",
    "nadia reyes",
    "cross-region replication lag",
    "ember-214",
  ];

  if (required.some((value) => !normalized.includes(value))) {
    throw new Error(
      "The incident escalation omitted details required to compare context quality.",
    );
  }
}

async function runContinuation(
  model: ModelId,
  history: Array<Record<string, unknown>>,
  signal: AbortSignal,
) {
  const startedAt = performance.now();
  const response = await createResponse(
    {
      model,
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 1_500,
      prompt_cache_options: { mode: "explicit", ttl: "30m" },
      input: [
        ...history,
        { role: "user", content: LAB_PROMPTS.contextCompaction.followUpQuestion },
      ],
    },
    signal,
  );
  assertCompleted(response, "The incident handoff response");

  const output = extractOutputText(response);
  validateEscalation(output);
  const usage = normalizeUsage(response.usage);

  return {
    output,
    usage,
    cost: estimateCost(model, usage),
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

export async function POST(request: Request) {
  const rejection = rejectUnsafeJsonRequest(request);
  if (rejection) {
    return Response.json(
      { error: rejection.error, code: rejection.code },
      { status: rejection.status },
    );
  }

  try {
    const body = (await readJsonObjectRequest(request)) as CompactionRequest;
    if (
      body.model !== undefined &&
      (typeof body.model !== "string" || !isModelId(body.model))
    ) {
      return Response.json(
        { error: "Select a supported model.", code: "invalid_request" },
        { status: 400 },
      );
    }
    const model: ModelId = body.model ?? "gpt-5.6-luna";

    const full = await runContinuation(model, HISTORY, request.signal);

    const compactionStartedAt = performance.now();
    const compactedHistory = await compactResponse(
      { model, input: HISTORY },
      request.signal,
    );
    const compactionLatencyMs = Math.round(
      performance.now() - compactionStartedAt,
    );

    if (
      !compactedHistory.output?.length ||
      !compactedHistory.output.some((item) => item.type === "compaction")
    ) {
      throw new Error("The API did not return a usable compacted context.");
    }

    const compacted = await runContinuation(
      model,
      compactedHistory.output,
      request.signal,
    );
    const compactionUsage = normalizeUsage(compactedHistory.usage);

    return Response.json({
      model,
      full: { label: "Full transcript", ...full },
      compacted: { label: "Compacted context", ...compacted },
      compaction: {
        usage: compactionUsage,
        cost: estimateCost(model, compactionUsage),
        latencyMs: compactionLatencyMs,
        inputItems: HISTORY.length,
        outputItems: compactedHistory.output.length,
      },
      historyTokensApprox: Math.ceil(JSON.stringify(HISTORY).length / 4),
      historyTurns: HANDOFF_COUNT,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    const formatted = formatApiError(error);
    return Response.json(formatted.body, { status: formatted.status });
  }
}
