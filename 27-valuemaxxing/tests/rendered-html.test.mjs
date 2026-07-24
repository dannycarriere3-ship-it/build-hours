import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import "./register-module-hooks.mjs";
import { normalizeGeneratedHtml } from "../lib/html.ts";

const routeModules = new Map([
  ["/api/run", "../app/api/run/route.ts"],
  ["/api/experiments/cache", "../app/api/experiments/cache/route.ts"],
  ["/api/experiments/ptc", "../app/api/experiments/ptc/route.ts"],
  [
    "/api/experiments/compaction",
    "../app/api/experiments/compaction/route.ts",
  ],
]);

async function render(path = "/", init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("accept", "text/html");

  if (path === "/") {
    const { default: Home } = await import("../app/page.tsx");

    return new Response(renderToString(createElement(Home)), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const routeModule = routeModules.get(path);
  if (!routeModule) throw new Error(`Unknown test route: ${path}`);

  const { POST } = await import(routeModule);
  return POST(
    new Request(`http://localhost${path}`, {
      ...init,
      headers,
    }),
  );
}

test("server-renders the Valuemaxxing Lab shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /default:\s*"Valuemaxxing Lab"/);
  assert.match(html, /VALUEMAXXING/);
  assert.match(
    html,
    /Pareto frontier[\s\S]*Visual matrix[\s\S]*Optimization lab/,
  );
  assert.match(html, /01 · Pareto frontier/);
  assert.match(html, /Benchmark score, cost, speed\./);
  assert.match(html, /OpenAI MRCR v2/);
  assert.match(html, /wall time \/ task/);
  assert.doesNotMatch(html, /artificialanalysis\.ai/i);
  assert.match(html, /Included benchmarks/);
  assert.match(html, /Pelican benchmark/);
  assert.match(html, /value="recorded-pelican-bicycle" selected=""/);
  assert.doesNotMatch(html, /Orbital greenhouse|greenhouse floating in orbit/);
  assert.doesNotMatch(html, /A sentence is enough/);
  assert.doesNotMatch(html, /comparisons worth paying for/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});

test("keeps the API key server-side and avoids starter-only dependencies", async () => {
  const [page, client, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ValuemaxxingLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /ValuemaxxingLab/);
  assert.doesNotMatch(client, /process\.env\.OPENAI_API_KEY/);
  assert.match(client, />\s*Clear all\s*</);
  assert.doesNotMatch(client, /Max estimated cost/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("rejects unsafe API mutation requests before they can spend", async () => {
  const wrongType = await render("/api/run", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  });
  assert.equal(wrongType.status, 415);
  assert.equal((await wrongType.json()).code, "unsupported_media_type");

  const crossOrigin = await render("/api/run", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://malicious.example",
    },
    body: JSON.stringify({
      prompt: "Build a color wheel.",
      model: "gpt-5.6-luna",
      effort: "none",
    }),
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).code, "cross_origin_request");

  for (const path of [
    "/api/run",
    "/api/experiments/cache",
    "/api/experiments/ptc",
    "/api/experiments/compaction",
  ]) {
    const malformed = await render(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).code, "invalid_json");

    const nonObject = await render(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });

    assert.equal(nonObject.status, 400);
    assert.equal((await nonObject.json()).code, "invalid_request");

    const unsupportedModel = await render(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Generate an SVG of a pelican riding a bicycle",
        model: "unsupported-model",
        effort: "low",
      }),
    });

    assert.equal(unsupportedModel.status, 400);
    assert.equal((await unsupportedModel.json()).code, "invalid_request");
  }

  const unsupportedPtcModel = await render("/api/experiments/ptc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-5.6-luna" }),
  });

  assert.equal(unsupportedPtcModel.status, 400);
  assert.equal((await unsupportedPtcModel.json()).code, "unsupported_model");
});

test("preserves a standalone SVG response as one downloadable artifact", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /></svg>';
  let requestedBody;

  process.env.OPENAI_API_KEY = originalApiKey || "test-api-key";
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/responses");
    requestedBody = JSON.parse(init.body);
    return Response.json({
      id: "resp_test_pelican",
      status: "completed",
      output_text: svg,
      usage: {
        input_tokens: 40,
        output_tokens: 90,
        total_tokens: 130,
      },
    });
  };

  try {
    const response = await render("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Generate an SVG of a pelican riding a bicycle",
        model: "gpt-5.6-luna",
        effort: "low",
      }),
    });

    assert.equal(response.status, 200);
    assert.match(requestedBody.input[0].content, /return one complete <svg>/i);
    assert.equal(requestedBody.max_output_tokens, 8_000);
    assert.equal(
      requestedBody.input[1].content,
      "Generate an SVG of a pelican riding a bicycle",
    );
    const artifact = await response.json();
    assert.equal(artifact.rawText, svg);
    assert.match(artifact.html, /Content-Security-Policy/);
    assert.match(artifact.html, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test("compares identical uncached and cached requests after separate priming", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const requests = [];

  process.env.OPENAI_API_KEY = originalApiKey || "test-api-key";
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body);
    requests.push(body);
    const priming = requests.length === 1;
    const cached = requests.length === 3;

    return Response.json({
      status: "completed",
      output_text: "ACCT-001 is the highest-priority retention risk.",
      usage: {
        input_tokens: 5_120,
        input_tokens_details: {
          cached_tokens: cached ? 5_000 : 0,
          cache_write_tokens: priming ? 5_000 : 0,
        },
        output_tokens: 120,
        total_tokens: 5_240,
      },
    });
  };

  try {
    const response = await render("/api/experiments/cache", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6-luna" }),
    });

    assert.equal(response.status, 200);
    assert.equal(requests.length, 3);
    assert.deepEqual(requests[0].prompt_cache_options, {
      mode: "explicit",
      ttl: "30m",
    });
    assert.ok(requests[0].input[0].content[0].prompt_cache_breakpoint);
    assert.equal(requests[1].input[0].content[0].prompt_cache_breakpoint, undefined);
    assert.equal(requests[1].prompt_cache_key, undefined);
    assert.equal(requests[1].input[1].content, requests[2].input[1].content);
    assert.ok(requests[2].input[0].content[0].prompt_cache_breakpoint);
    assert.equal(requests[0].prompt_cache_key, requests[2].prompt_cache_key);

    const result = await response.json();
    assert.equal(result.prime.usage.cacheWriteTokens, 5_000);
    assert.equal(result.uncached.usage.cachedTokens, 0);
    assert.equal(result.cached.usage.cachedTokens, 5_000);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test("compacts a long incident history before replaying the same follow-up", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const requests = [];
  const answer = JSON.stringify({
    launch_id: "LAUNCH-184",
    owner: "Nadia Reyes",
    blocker: "cross-region replication lag",
    recovery_token: "EMBER-214",
  });

  process.env.OPENAI_API_KEY = originalApiKey || "test-api-key";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(init.body);
    requests.push({ url, body });

    if (url.endsWith("/compact")) {
      return Response.json({
        object: "response.compaction",
        output: [
          body.input[0],
          body.input[1],
          { type: "compaction", encrypted_content: "opaque-fixture" },
        ],
        usage: {
          input_tokens: 18_000,
          output_tokens: 1_100,
          total_tokens: 19_100,
        },
      });
    }

    const compacted = requests.length === 3;
    return Response.json({
      status: "completed",
      output_text: answer,
      usage: {
        input_tokens: compacted ? 1_350 : 18_300,
        output_tokens: 95,
        total_tokens: compacted ? 1_445 : 18_395,
      },
    });
  };

  try {
    const response = await render("/api/experiments/compaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6-luna" }),
    });

    assert.equal(response.status, 200);
    assert.equal(requests.length, 3);
    assert.equal(requests[0].url, "https://api.openai.com/v1/responses");
    assert.equal(requests[1].url, "https://api.openai.com/v1/responses/compact");
    assert.equal(requests[2].url, "https://api.openai.com/v1/responses");
    assert.ok(requests[0].body.input.length > 100);
    assert.match(requests[0].body.input[2].content, /LAUNCH-100/);
    assert.doesNotMatch(requests[0].body.input[1].content, /LAUNCH-100/);
    assert.equal(requests[1].body.service_tier, undefined);
    assert.equal(requests[2].body.input[0].role, "developer");
    assert.equal(requests[2].body.input[1].role, "user");
    assert.equal(requests[2].body.input[2].type, "compaction");
    assert.equal(
      requests[0].body.input.at(-1).content,
      requests[2].body.input.at(-1).content,
    );

    const result = await response.json();
    assert.equal(result.historyTurns, 72);
    assert.equal(result.compaction.usage.outputTokens, 1_100);
    assert.equal(result.full.usage.inputTokens, 18_300);
    assert.equal(result.compacted.usage.inputTokens, 1_350);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test("normalizes imported HTML with a network-blocking CSP", () => {
  const html = normalizeGeneratedHtml(
    '<html><head></head><body><script>fetch("https://example.com")</script></body></html>',
  );
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<body>"));
});

test("normalizes a standalone SVG artifact with the same sandbox policy", () => {
  const html = normalizeGeneratedHtml(
    '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /></svg>\n```',
  );
  assert.match(html, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /body>svg\{display:block;width:100%;height:100%/);
  assert.doesNotMatch(html, /```/);
});

test("fits fixed-size SVG documents without restyling unrelated HTML", () => {
  const oversized = normalizeGeneratedHtml(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="650" viewBox="0 0 900 650"></svg>',
  );
  const storedDocument = normalizeGeneratedHtml(
    '<html><head></head><body><svg width="900" height="650" viewBox="0 0 900 650"></svg></body></html>',
  );
  const interactiveHtml = normalizeGeneratedHtml(
    '<html><head></head><body><main><svg width="900" height="650"></svg></main></body></html>',
  );

  assert.match(oversized, /html,body\{width:100%;height:100%;margin:0/);
  assert.match(oversized, /width="900" height="650"/);
  assert.match(storedDocument, /body>svg\{display:block;width:100%/);
  assert.doesNotMatch(interactiveHtml, /body>svg\{display:block;width:100%/);
});
