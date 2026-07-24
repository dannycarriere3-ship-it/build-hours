import { isModelId, type ModelId } from "@/lib/catalog";
import {
  addUsage,
  assertCompleted,
  createResponse,
  EMPTY_USAGE,
  estimateCost,
  extractOutputText,
  formatApiError,
  normalizeUsage,
  type OpenAIResponse,
} from "@/lib/openai";
import { LAB_PROMPTS } from "@/lib/prompts";
import {
  readJsonObjectRequest,
  rejectUnsafeJsonRequest,
} from "@/lib/request-security";
import type { Usage } from "@/lib/types";

export const runtime = "nodejs";

const WEST_ACCOUNT_NAMES = [
  "Northstar Robotics",
  "Juniper Health",
  "Meridian Goods",
  "Lattice Energy",
  "Orbit Ledger",
  "Canvas Labs",
  "Harbor Systems",
  "Fieldwork AI",
  "Mosaic Commerce",
  "Signal Foundry",
  "Atlas Learning",
  "Cedar Finance",
  "Prism Climate",
  "Relay Studio",
  "Summit Bio",
  "Vector Works",
  "Willow Security",
  "Yellowbrick Data",
] as const;

const ACCOUNTS = [
  ...WEST_ACCOUNT_NAMES.map((name, index) => ({
    id: `acct_${101 + index}`,
    name,
    region: "west" as const,
  })),
  { id: "acct_201", name: "Kite Logistics", region: "east" as const },
];

const USAGE: Record<
  string,
  { growth_percent: number; weekly_runs: number }
> = Object.fromEntries(
  ACCOUNTS.map((account, index) => [
    account.id,
    {
      growth_percent: 11 + ((index * 17) % 61),
      weekly_runs: 6_800 + index * 1_370,
    },
  ]),
);

const SUPPORT: Record<
  string,
  { open_p1_cases: number; oldest_case_hours: number }
> = Object.fromEntries(
  ACCOUNTS.map((account, index) => {
    const open = [0, 1, 2, 0, 1, 3][index % 6];
    return [
      account.id,
      {
        open_p1_cases: open,
        oldest_case_hours: open ? 4 + ((index * 9) % 43) : 0,
      },
    ];
  }),
);

type ToolMode = "direct" | "programmatic";

type ToolCall = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments?: string;
  caller?: Record<string, unknown>;
};

const PARAMETERS = {
  type: "object",
  properties: {
    account_id: {
      type: "string",
      description: "The stable account ID, for example acct_101.",
    },
  },
  required: ["account_id"],
  additionalProperties: false,
};

const BASE_TOOLS = [
  {
    type: "function",
    name: "list_accounts",
    description:
      "List the account IDs and names in a region. Use this before looking up account-level signals.",
    parameters: {
      type: "object",
      properties: {
        region: {
          type: "string",
          enum: ["west", "east"],
        },
      },
      required: ["region"],
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        accounts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
            },
            required: ["id", "name"],
            additionalProperties: false,
          },
        },
      },
      required: ["accounts"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_usage",
    description: "Get current usage signals for one account.",
    parameters: PARAMETERS,
    output_schema: {
      type: "object",
      properties: {
        growth_percent: { type: "number" },
        weekly_runs: { type: "number" },
      },
      required: ["growth_percent", "weekly_runs"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_support",
    description: "Get current priority-one support signals for one account.",
    parameters: PARAMETERS,
    output_schema: {
      type: "object",
      properties: {
        open_p1_cases: { type: "number" },
        oldest_case_hours: { type: "number" },
      },
      required: ["open_p1_cases", "oldest_case_hours"],
      additionalProperties: false,
    },
  },
] as const;

function toolsFor(mode: ToolMode) {
  const caller = mode === "direct" ? "direct" : "programmatic";
  const tools: Array<Record<string, unknown>> = BASE_TOOLS.map((tool) => ({
    ...tool,
    allowed_callers: [caller],
  }));

  if (mode === "programmatic") {
    tools.push({ type: "programmatic_tool_calling" });
  }

  return tools;
}

function parseArguments(value?: string) {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new Error("The model returned malformed tool arguments.");
  }
}

function executeTool(call: ToolCall) {
  const args = parseArguments(call.arguments);

  if (call.name === "list_accounts") {
    const region = args.region;
    if (region !== "west" && region !== "east") {
      throw new Error("list_accounts requires a valid region.");
    }
    return {
      accounts: ACCOUNTS.filter((account) => account.region === region).map(
        ({ id, name }) => ({ id, name }),
      ),
    };
  }

  const accountId =
    typeof args.account_id === "string" ? args.account_id : "";
  if (!(accountId in USAGE)) {
    throw new Error(`Unknown account ID: ${accountId || "(missing)"}.`);
  }

  if (call.name === "get_usage") {
    return USAGE[accountId as keyof typeof USAGE];
  }
  if (call.name === "get_support") {
    return SUPPORT[accountId as keyof typeof SUPPORT];
  }

  throw new Error(`Unknown tool: ${call.name}.`);
}

function validateFinalAnswer(output: string) {
  const expected = ACCOUNTS.filter(
    (account) =>
      account.region === "west" &&
      USAGE[account.id].growth_percent > 30 &&
      SUPPORT[account.id].open_p1_cases > 0,
  );
  const excluded = ACCOUNTS.filter(
    (account) =>
      account.region === "west" &&
      !expected.some((candidate) => candidate.id === account.id),
  );
  const missing = expected.filter(
    (account) => !output.includes(account.name),
  );
  const unexpected = excluded.filter((account) =>
    output.includes(account.name),
  );

  if (missing.length || unexpected.length) {
    throw new Error(
      `The deterministic tool result failed validation (${missing.length} missing, ${unexpected.length} unexpected accounts).`,
    );
  }
}

function hasMessage(response: OpenAIResponse) {
  return (response.output ?? []).some((item) => item.type === "message");
}

async function runToolExperiment(
  model: ModelId,
  mode: ToolMode,
  signal: AbortSignal,
) {
  const input: Array<Record<string, unknown>> = [
    {
      role: "developer",
      content:
        mode === "programmatic"
          ? LAB_PROMPTS.programmaticToolCalling.programmaticInstructions
          : LAB_PROMPTS.programmaticToolCalling.directInstructions,
    },
    { role: "user", content: LAB_PROMPTS.programmaticToolCalling.task },
  ];
  const tools = toolsFor(mode);
  let usage: Usage = { ...EMPTY_USAGE };
  let apiTurns = 0;
  let toolCalls = 0;
  let sawProgram = false;
  let sawCompletedProgramOutput = false;
  const trace: Array<{
    turn: number;
    status: string;
    items: string[];
    inputTokens: number;
    outputTokens: number;
  }> = [];
  const startedAt = performance.now();

  while (apiTurns < 12) {
    apiTurns += 1;
    const response = await createResponse(
      {
        model,
        store: false,
        reasoning: { effort: "low" },
        max_output_tokens: 2_500,
        input,
        tools,
      },
      signal,
    );
    assertCompleted(response, "The tool-loop response");
    const turnUsage = normalizeUsage(response.usage);
    usage = addUsage(usage, turnUsage);
    trace.push({
      turn: apiTurns,
      status: response.status ?? "unknown",
      items: (response.output ?? []).map((item) => {
        const name =
          typeof item.name === "string" ? `:${item.name}` : "";
        return `${String(item.type ?? "unknown")}${name}`;
      }),
      inputTokens: turnUsage.inputTokens,
      outputTokens: turnUsage.outputTokens,
    });

    for (const item of response.output ?? []) {
      if (item.type === "program") sawProgram = true;
      if (
        item.type === "program_output" &&
        item.status === "completed"
      ) {
        sawCompletedProgramOutput = true;
      }
      input.push(item);
    }

    const calls = (response.output ?? []).filter(
      (item): item is ToolCall => item.type === "function_call",
    );

    for (const call of calls) {
      toolCalls += 1;
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(executeTool(call)),
        ...(call.caller ? { caller: call.caller } : {}),
      });
    }

    if (calls.length > 0) continue;

    const output = extractOutputText(response);
    if (hasMessage(response) && output) {
      if (
        mode === "programmatic" &&
        (!sawProgram || !sawCompletedProgramOutput)
      ) {
        throw new Error(
          "The programmatic comparison completed without a verified program execution.",
        );
      }
      validateFinalAnswer(output);
      return {
        label:
          mode === "direct" ? "Direct tool loop" : "Programmatic tool calling",
        output,
        usage,
        cost: estimateCost(model, usage),
        latencyMs: Math.round(performance.now() - startedAt),
        apiTurns,
        modelTurns: trace.filter(
          (turn) => turn.inputTokens > 0 || turn.outputTokens > 0,
        ).length,
        toolCalls,
        trace,
      };
    }
  }

  throw new Error(
    `${mode === "direct" ? "Direct" : "Programmatic"} tool run exceeded 12 API turns.`,
  );
}

type PtcRequest = {
  model?: unknown;
};

export async function POST(request: Request) {
  const rejection = rejectUnsafeJsonRequest(request);
  if (rejection) {
    return Response.json(
      { error: rejection.error, code: rejection.code },
      { status: rejection.status },
    );
  }

  try {
    const body = (await readJsonObjectRequest(request)) as PtcRequest;
    if (
      body.model !== undefined &&
      (typeof body.model !== "string" || !isModelId(body.model))
    ) {
      return Response.json(
        { error: "Select a supported model.", code: "invalid_request" },
        { status: 400 },
      );
    }
    const model: ModelId = body.model ?? "gpt-5.6-terra";
    if (model === "gpt-5.6-luna") {
      return Response.json(
        {
          error: "Programmatic tool calling requires GPT-5.6 Sol or Terra.",
          code: "unsupported_model",
        },
        { status: 400 },
      );
    }

    const direct = await runToolExperiment(
      model,
      "direct",
      request.signal,
    );
    const programmatic = await runToolExperiment(
      model,
      "programmatic",
      request.signal,
    );

    return Response.json({
      model,
      direct,
      programmatic,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    const formatted = formatApiError(error);
    return Response.json(formatted.body, { status: formatted.status });
  }
}
