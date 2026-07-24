import pricing from "@/data/pricing.json";
import { isOpenAIConfigured } from "@/lib/openai";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    configured: isOpenAIConfigured(),
    api: "responses",
    pricingUpdated: pricing.updated,
  });
}
