# Conference Launch Desk

A demo-ready conference production board built with the OpenAI Agents SDK.
The app has a Python API, SQLite persistence, a React board UI, hosted sandbox
agents, R2-backed task files and snapshots, workflow tools, and human approval
for task completion.

## Build And Run

You need Python 3.12+, [`uv`](https://docs.astral.sh/uv/), Node/npm, and
[`overmind`](https://github.com/DarthSim/overmind) for the combined dev
command:

```bash
brew install overmind
cp .env.example .env
uv sync --frozen
npm --prefix web ci
```

The final demo uses R2 as soon as the backend boots. Fill in these values in
`.env` before starting it:

```dotenv
OPENAI_API_KEY=...
R2_ENDPOINT_URL=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=conference-launch-desk
```

Authenticate with Modal in the environment where you run agent tasks. Build
the web client with:

```bash
npm --prefix web run build
```

Start the API and client together:

```bash
./bin/dev
```

Or run the two processes separately:

```bash
uv run --frozen uvicorn app.main:app --reload --host 127.0.0.1 --port 8421
npm --prefix web run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). To validate a checkout:

```bash
uv run --frozen ruff check app tests
uv run --frozen pytest -q
npm --prefix web run build
```

## Demo State

The UI can reset to an empty board or seed two file-backed conference tasks:

- `Review session copy for Priya Shah`
- `Produce agenda page preview for Priya Shah`

Agents consume the task packet through this workspace contract:

```text
/workspace/task/
  input/original/
  working/
  output/
  handoffs/
```

Task uploads live in `r2://<bucket>/tasks/<task>/...`; hosted agent inputs are
mounted from that prefix. Modal sandbox snapshots live in
`r2://<bucket>/snapshots/<run-id>.tar`.

The canonical synthetic packet lives in `fake data/`. It contains a real
speaker bio DOCX, landscape headshot PNG, and draft slide PDF; use those same
files for manual drag-and-drop rehearsal or the seeded reset state.

The Program Editor pulls its editorial skill from the public
[`sdcoffey/conference-program-editor-skill`](https://github.com/sdcoffey/conference-program-editor-skill)
repository with `Skills(from_=GitRepo(...))`, instead of bundling domain rules
inside this application.

Use `gpt-5.5` for sandbox agents. Older models such as `gpt-4.1` reject the
custom tool definitions emitted by sandbox capabilities.
