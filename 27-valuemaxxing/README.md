# Valuemaxxing Lab

A local, inspectable playground for comparing what different OpenAI models and
reasoning settings produce—and what those choices cost in tokens, latency, and
estimated spend.

This project is intentionally a learning harness, not a leaderboard. Results,
prompts, benchmark fixtures, and pricing assumptions are visible and editable.

## What you can explore

- **Visual matrix:** run one artifact prompt across model/reasoning
  combinations, compare sandboxed SVG or HTML results, inspect token ledgers,
  and import or export completed runs.
- **Optimization lab:** compare explicit prompt caching, direct versus
  programmatic tool calling, and long-context compaction using synthetic local
  scenarios.
- **Pareto frontier:** compare published OpenAI model-family benchmark scores
  against actual cost and end-to-end latency from the included SVG lab.
- **Included benchmark:** open a real, complete 18-result pelican SVG matrix
  immediately, even before configuring an API key.

The included pelican benchmark covers three models and six reasoning levels,
with recorded model outputs, token usage, latency, and estimated cost. New runs
stay available alongside the benchmark in the run selector.

You can switch to the included benchmark while another visual matrix is running.
The original run continues in the background, and its completed results appear
in **Your saved runs** without replacing the benchmark you selected.

## Requirements

- Node.js **22.15 or newer**; `.nvmrc` selects Node 22.
- npm, included with Node.js.
- An OpenAI API key with access to the models in `lib/catalog.ts` if you want to
  generate artifacts or run optimization experiments.

The included benchmark and Pareto frontier do not require a key.

## Quickstart

Clone the Build Hours repository and enter this session's directory:

```bash
git clone https://github.com/openai/build-hours.git
cd build-hours/27-valuemaxxing

# Optional if you use nvm:
nvm use

npm ci
cp .env.example .env.local
```

Set your own key in `.env.local`:

```dotenv
OPENAI_API_KEY=your_openai_api_key_here
```

Then start the app:

```bash
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). To use a different port:

```bash
npm run dev -- --port 3001
```

The development server uses webpack and binds only to the loopback interface.
Keep `.env.local` private: `.gitignore` excludes real environment files, and the
API key is read only by server-side routes.

## Add or replace included SVG labs

Edit [`data/example-runs.json`](data/example-runs.json). Each run contains a
display name, the original visual prompt, and one or more artifacts:

```json
{
  "schemaVersion": 1,
  "runs": [
    {
      "id": "my-demo-run",
      "name": "My recorded SVG lab",
      "prompt": "Generate an SVG of a pelican riding a bicycle",
      "createdAt": "2026-07-22T12:00:00.000Z",
      "items": [
        {
          "model": "gpt-5.6-luna",
          "effort": "low",
          "artifact": "<svg xmlns='http://www.w3.org/2000/svg'>...</svg>"
        }
      ]
    }
  ]
}
```

The project ships one 18-result recorded pelican benchmark. To replace it or add
another recorded benchmark, use the app's **Download run** action and place the
exported `items` inside a run entry. Complete exported items preserve their
recorded usage, latency, and estimated cost. Every included or imported artifact
passes through the same network-blocking HTML sandbox, and new in-app runs can
be recalled from the run selector.

## Customize optimization prompts

All user-facing and developer instructions live in
[`data/lab-prompts.json`](data/lab-prompts.json):

| Section | What to change |
| --- | --- |
| `visualArtifact.instructions` | Shared instructions for generated SVG/HTML artifacts. |
| `promptCaching.systemTemplate` | Stable cached prefix; keep `{{ACCOUNT_LEDGER}}` where the synthetic ledger belongs. |
| `promptCaching.primingQuestion` | Question used to write the prompt-cache entry. |
| `promptCaching.comparisonQuestion` | Identical question used for cached and uncached comparisons. |
| `programmaticToolCalling.task` | User task shared by direct and programmatic tool loops. |
| `programmaticToolCalling.directInstructions` | Developer instructions for direct tool calls. |
| `programmaticToolCalling.programmaticInstructions` | Developer instructions for hosted programmatic calls. |
| `contextCompaction.developerInstructions` | Instructions applied to the long synthetic incident history. |
| `contextCompaction.followUpQuestion` | Identical question asked with full and compacted context. |

Restart the server if your environment does not automatically reload JSON
changes. The programmatic-tool and compaction experiments include deterministic
answer checks; if you change their task semantics, update the corresponding
synthetic fixture and validator in the experiment route as well.

Prompt caching works only when the stable prefix is long enough and otherwise
eligible for caching. Keep its shared prefix identical between comparison runs.

## Models, benchmarks, and pricing

- [`lib/catalog.ts`](lib/catalog.ts) declares available model IDs, labels,
  reasoning efforts, and default selections.
- [`data/pricing.json`](data/pricing.json) records standard-tier rates, cached
  input, cache writes, output, long-context multipliers, and its source date.
- [`data/openai-frontier-models.json`](data/openai-frontier-models.json)
  combines OpenAI's published MRCR model-family scores with cost and wall-clock
  measurements from the recorded SVG lab. Scores are shared by configurations
  in the same model family; reasoning-effort-specific scores were not measured.

Reasoning tokens are already part of output tokens and are not charged twice.
Higher reasoning levels receive larger output budgets because reasoning tokens
count against the same limit. Per-run estimates use the usage returned by each
response; the interface does not make upfront spending promises.

Refresh model IDs and pricing before publishing a new session or when public
availability changes. Models your project cannot access return the upstream
API error; included benchmarks remain available.

## Commands

```bash
npm run dev        # Loopback-only Next.js development server
npm run build      # Standard production Next.js build
npm start          # Loopback-only production Next.js server
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm test           # Run rendering, security, and mocked API tests
npm run check      # Lint, typecheck, and test
```

## Security and cost boundaries

- API requests are made only from server routes; secrets never enter the
  client bundle, generated artifacts, or exported run files.
- Development and production commands bind to `127.0.0.1` by default.
- Mutation routes reject non-JSON, cross-origin, cross-site, and non-loopback
  requests. Malformed payloads and unsupported model choices are rejected
  before any billable API call.
- SVG and HTML artifacts run in an iframe with `sandbox="allow-scripts"` and a
  Content Security Policy that blocks network requests, external assets, forms,
  and parent-page access.
- Imported and persisted run data is size-limited, schema-validated, and
  re-sandboxed before rendering.
- Optimization scenarios use synthetic local data only.
- Running a new matrix or optimization experiment makes real, billable API
  calls; viewing the recorded benchmark and the frontier does not.

This is a local demonstration application. Add authentication, rate limiting,
request budgets, and managed server-side secrets before exposing it on a
network or deploying it as a shared service.

## Project layout

```text
app/
  ValuemaxxingLab.tsx              Visual matrix and optimization UI
  ParetoFrontier.tsx               Interactive benchmark explorer
  api/run/                         Artifact-generation route
  api/experiments/cache/           Explicit prompt-caching comparison
  api/experiments/ptc/             Direct versus programmatic tools
  api/experiments/compaction/      Full versus compacted context
data/
  example-runs.json                Recorded 3-by-6 pelican benchmark
  lab-prompts.json                 Editable prompts for every experiment
  openai-frontier-models.json      First-party benchmark and recorded-run fixture
  pricing.json                     Versioned pricing assumptions
lib/
  catalog.ts                       Model and reasoning catalog
  frontier.ts                      Frontier calculations and import validation
  html.ts                          Artifact normalization and CSP
  matrix-run-session.ts            Background generation and visible-run ownership
  openai.ts                        Responses API and cost helpers
  prompts.ts                       Prompt-template interpolation
  request-security.ts              Local-only mutation checks
  runs.ts                          Saved-run and experiment validation
tests/                             Offline integration and fixture tests
```

## API references

- [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Model and reasoning guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6)
- [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [Programmatic tool calling](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)
- [Context compaction](https://developers.openai.com/api/docs/guides/compaction)
- [API pricing](https://developers.openai.com/api/docs/pricing)
- [GPT-5.6 launch evaluation](https://openai.com/index/gpt-5-6/)

## License

MIT. See [`LICENSE`](LICENSE), which matches the parent
[`openai/build-hours`](https://github.com/openai/build-hours) repository.
