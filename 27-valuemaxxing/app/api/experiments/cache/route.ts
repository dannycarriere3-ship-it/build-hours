import { isModelId, type ModelId } from "@/lib/catalog";
import {
  assertCompleted,
  createResponse,
  estimateCost,
  extractOutputText,
  formatApiError,
  normalizeUsage,
} from "@/lib/openai";
import { fillPromptTemplate, LAB_PROMPTS } from "@/lib/prompts";
import {
  readJsonObjectRequest,
  rejectUnsafeJsonRequest,
} from "@/lib/request-security";

export const runtime = "nodejs";

const SEGMENTS = [
  "Acquisition",
  "Activation",
  "Retention",
  "Expansion",
  "Support",
] as const;

const SIGNALS = [
  "weekly active seats rose while administrator activity stayed flat",
  "API usage increased after a new production workspace launched",
  "support volume fell after a documentation redesign",
  "automation runs grew but completion rate softened",
  "team invitations accelerated across two new departments",
  "evaluation traffic climbed before production traffic followed",
] as const;

const ACCOUNT_PREFIX = Array.from({ length: 240 }, (_, index) => {
  const id = String(index + 1).padStart(3, "0");
  const segment = SEGMENTS[index % SEGMENTS.length];
  const signal = SIGNALS[index % SIGNALS.length];
  const score = 52 + ((index * 17) % 47);
  return `ACCT-${id} | ${segment} | health ${score}/100 | ${signal}.`;
}).join("\n");

const STABLE_PREFIX = fillPromptTemplate(
  LAB_PROMPTS.promptCaching.systemTemplate,
  { ACCOUNT_LEDGER: ACCOUNT_PREFIX },
);

type CacheRequest = {
  model?: unknown;
};

type CacheMode = "prime" | "uncached" | "cached";

async function runCachedRequest(
  model: ModelId,
  question: string,
  cacheKey: string,
  mode: CacheMode,
  signal: AbortSignal,
) {
  const cacheEnabled = mode !== "uncached";
  const startedAt = performance.now();
  const response = await createResponse(
    {
      model,
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 1_800,
      prompt_cache_options: {
        mode: "explicit",
        ttl: "30m",
      },
      ...(cacheEnabled ? { prompt_cache_key: cacheKey } : {}),
      input: [
        {
          role: "developer",
          content: [
            {
              type: "input_text",
              text: STABLE_PREFIX,
              ...(cacheEnabled
                ? { prompt_cache_breakpoint: { mode: "explicit" } }
                : {}),
            },
          ],
        },
        {
          role: "user",
          content: question,
        },
      ],
    },
    signal,
  );
  assertCompleted(response, "The prompt-caching response");
  const latencyMs = Math.round(performance.now() - startedAt);
  const usage = normalizeUsage(response.usage);

  return {
    output: extractOutputText(response),
    usage,
    cost: estimateCost(model, usage),
    latencyMs,
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
    const body = (await readJsonObjectRequest(request)) as CacheRequest;
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

    const cacheKey = `valuemaxxing-cache-lab-${crypto.randomUUID()}`;
    const { comparisonQuestion, primingQuestion } = LAB_PROMPTS.promptCaching;
    const prime = await runCachedRequest(
      model,
      primingQuestion,
      cacheKey,
      "prime",
      request.signal,
    );
    const uncached = await runCachedRequest(
      model,
      comparisonQuestion,
      cacheKey,
      "uncached",
      request.signal,
    );
    const cached = await runCachedRequest(
      model,
      comparisonQuestion,
      cacheKey,
      "cached",
      request.signal,
    );

    if (uncached.usage.cachedTokens || uncached.usage.cacheWriteTokens) {
      throw new Error("The uncached control unexpectedly used prompt caching.");
    }

    return Response.json({
      model,
      prime: { label: "Cache priming", ...prime },
      uncached: { label: "Caching disabled", ...uncached },
      cached: { label: "Caching enabled", ...cached },
      prefixTokensApprox: Math.round(STABLE_PREFIX.length / 4),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    const formatted = formatApiError(error);
    return Response.json(formatted.body, { status: formatted.status });
  }
}
