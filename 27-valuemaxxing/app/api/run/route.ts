import {
  getVisualOutputTokenLimit,
  isModelId,
  isReasoningEffort,
  type ModelId,
  type ReasoningEffort,
} from "@/lib/catalog";
import { normalizeGeneratedHtml } from "@/lib/html";
import {
  assertCompleted,
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

type RunRequest = {
  prompt?: unknown;
  model?: unknown;
  effort?: unknown;
};

function validateRequest(body: RunRequest) {
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const model = typeof body.model === "string" ? body.model : "";
  const effort = typeof body.effort === "string" ? body.effort : "";

  if (prompt.length < 8 || prompt.length > 500) {
    return {
      error: "Use a visual brief between 8 and 500 characters.",
      status: 400,
    } as const;
  }
  if (!isModelId(model)) {
    return { error: "Select a supported model.", status: 400 } as const;
  }
  if (!isReasoningEffort(effort)) {
    return {
      error: "Select a supported reasoning effort.",
      status: 400,
    } as const;
  }

  return {
    prompt,
    model: model as ModelId,
    effort: effort as ReasoningEffort,
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
    const body = (await readJsonObjectRequest(request)) as RunRequest;
    const parsed = validateRequest(body);

    if ("error" in parsed) {
      return Response.json(
        { error: parsed.error, code: "invalid_request" },
        { status: parsed.status },
      );
    }

    const startedAt = performance.now();
    const response = await createResponse(
      {
        model: parsed.model,
        store: false,
        reasoning: { effort: parsed.effort },
        max_output_tokens: getVisualOutputTokenLimit(parsed.effort),
        input: [
          {
            role: "developer",
            content: LAB_PROMPTS.visualArtifact.instructions,
          },
          {
            role: "user",
            content: parsed.prompt,
          },
        ],
      },
      request.signal,
    );
    assertCompleted(response, "The artifact response");
    const latencyMs = Math.round(performance.now() - startedAt);
    const rawText = extractOutputText(response);

    if (!rawText) {
      throw new Error("The model completed without returning a visual artifact.");
    }

    const usage = normalizeUsage(response.usage);

    return Response.json({
      id: crypto.randomUUID(),
      model: parsed.model,
      effort: parsed.effort,
      html: normalizeGeneratedHtml(rawText),
      rawText,
      usage,
      cost: estimateCost(parsed.model, usage),
      latencyMs,
      responseId: response.id ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    const formatted = formatApiError(error);
    return Response.json(formatted.body, { status: formatted.status });
  }
}
