import pricing from "@/data/pricing.json";
import type { ModelId } from "@/lib/catalog";
import { InvalidJsonRequestError } from "@/lib/request-security";
import type { CostBreakdown, Usage } from "@/lib/types";

type ApiErrorPayload = {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

type ResponseUsage = {
  input_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
  };
  output_tokens?: number;
  output_tokens_details?: {
    reasoning_tokens?: number;
  };
  total_tokens?: number;
};

export type OpenAIResponse = {
  id?: string;
  status?: string;
  incomplete_details?: {
    reason?: string;
  } | null;
  output?: Array<Record<string, unknown>>;
  output_text?: string;
  usage?: ResponseUsage;
  error?: {
    message?: string;
  };
};

export type OpenAICompactionResponse = {
  id?: string;
  object?: string;
  output?: Array<Record<string, unknown>>;
  usage?: ResponseUsage;
};

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export class OpenAIRequestError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "OpenAIRequestError";
    this.status = status;
    this.code = code;
  }
}

export function isOpenAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

async function postOpenAI(
  url: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<OpenAIResponse | OpenAICompactionResponse> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new OpenAIRequestError(
      "OPENAI_API_KEY is not configured in the server environment.",
      503,
      "missing_api_key",
    );
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  const payload = (await response.json().catch(() => ({}))) as
    | OpenAIResponse
    | OpenAICompactionResponse
    | ApiErrorPayload;

  if (!response.ok) {
    const error = (payload as ApiErrorPayload).error;
    throw new OpenAIRequestError(
      error?.message || `OpenAI request failed with status ${response.status}.`,
      response.status,
      error?.code || error?.type || null,
    );
  }

  return payload as OpenAIResponse | OpenAICompactionResponse;
}

export async function createResponse(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<OpenAIResponse> {
  return (await postOpenAI(
    OPENAI_RESPONSES_URL,
    {
      service_tier: "default",
      ...body,
    },
    signal,
  )) as OpenAIResponse;
}

export async function compactResponse(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<OpenAICompactionResponse> {
  return (await postOpenAI(
    `${OPENAI_RESPONSES_URL}/compact`,
    body,
    signal,
  )) as OpenAICompactionResponse;
}

export function normalizeUsage(usage?: ResponseUsage): Usage {
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;

  return {
    inputTokens,
    cachedTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens:
      usage?.input_tokens_details?.cache_write_tokens ?? 0,
    outputTokens,
    reasoningTokens:
      usage?.output_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? inputTokens + outputTokens,
  };
}

export function addUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
};

export function estimateCost(
  model: ModelId,
  usage: Usage,
): CostBreakdown | null {
  const rates = pricing.models[model];
  if (!rates) return null;

  const inputMultiplier =
    usage.inputTokens > pricing.longContextThreshold
      ? pricing.longContextInputMultiplier
      : 1;
  const outputMultiplier =
    usage.inputTokens > pricing.longContextThreshold
      ? pricing.longContextOutputMultiplier
      : 1;
  const uncachedTokens = Math.max(
    0,
    usage.inputTokens - usage.cachedTokens - usage.cacheWriteTokens,
  );

  const input =
    (uncachedTokens / 1_000_000) * rates.input * inputMultiplier;
  const cachedInput =
    (usage.cachedTokens / 1_000_000) *
    rates.cachedInput *
    inputMultiplier;
  const cacheWrite =
    (usage.cacheWriteTokens / 1_000_000) *
    rates.cacheWrite *
    inputMultiplier;
  const output =
    (usage.outputTokens / 1_000_000) *
    rates.output *
    outputMultiplier;

  return {
    input,
    cachedInput,
    cacheWrite,
    output,
    total: input + cachedInput + cacheWrite + output,
    currency: "USD",
    estimated: true,
  };
}

export function extractOutputText(response: OpenAIResponse): string {
  if (response.output_text) return response.output_text;

  const pieces: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content as Array<Record<string, unknown>>) {
      if (content.type === "output_text" && typeof content.text === "string") {
        pieces.push(content.text);
      }
    }
  }
  return pieces.join("\n");
}

export function assertCompleted(
  response: OpenAIResponse,
  context = "The model response",
) {
  if (response.status === "completed") return;
  const reason = response.incomplete_details?.reason;
  throw new OpenAIRequestError(
    `${context} did not complete${reason ? `: ${reason}` : "."}`,
    502,
    "incomplete_response",
  );
}

export function formatApiError(error: unknown) {
  if (error instanceof InvalidJsonRequestError) {
    return {
      status: 400,
      body: { error: error.message, code: error.code },
    };
  }

  if (error instanceof OpenAIRequestError) {
    return {
      status: error.status,
      body: { error: error.message, code: error.code },
    };
  }

  return {
    status: 500,
    body: {
      error:
        error instanceof Error
          ? error.message
          : "An unexpected server error occurred.",
      code: "server_error",
    },
  };
}
