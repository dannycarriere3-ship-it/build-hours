# Conference Launch Desk: Skeleton Implementation Plan

## Goal

Build a polished, runnable task-board application before any agent code is
connected. During the demo, Steve should only need to fill small, clearly
marked Python integration points to progressively make the application
agentic:

```text
Empty board
  -> Docker-backed SandboxAgent
  -> conference editorial skill
  -> Modal sandbox provider
  -> R2-backed sandbox snapshots
  -> task mutation tools
  -> R2-backed uploads and mounted inputs
```

The app should never look broken while an integration is absent. Before the
agent is wired, it is a useful manual board. As each step is added, existing
UI surfaces naturally reveal the new capability.

## Product Principles

### The frontend is finished before the demo

The board, task drawer, file browser, run timeline, agent configuration panel,
and preview panel should all ship in the skeleton. Live-coding React is a poor
trade here: it burns time and hides the SDK story.

### Manual application behavior exists before agent tools

A human can create tasks, upload files, add comments, change status, and
change assignee from the start. Later, the agent receives Python function
tools that call the same service methods. We should not build separate
"agent writes directly to the database" logic.

### Local files are attachments; the manifest defines the workspace

On day one, uploaded files are stored as flat blobs, keyed by attachment id:

```text
data/files/<attachment-id>
```

When an agent run starts, the manifest materializes those attached blobs into
the task's working shape:

```text
/workspace/task/
  input/original/
  working/
  output/
  handoffs/
```

The final hosted step changes the attachment store so uploads land in R2 and
the manifest mounts its input prefix for the run.

### The demo edits backend Python only

All intentional live hooks live in the Python server under visible,
searchable comments such as:

```py
# STEP-01: Reveal the Docker-backed Program Editor agent here.
```

The UI consumes ordinary API state and should not need to be edited live.

## Stack

### Backend

Use:

- Python 3.12+
- FastAPI
- Uvicorn
- SQLAlchemy 2.0 with synchronous sessions
- Alembic for schema migrations
- SQLite in WAL mode for the demo database
- Pydantic models for API request/response types
- `python-multipart` for uploads
- `uv` for environment and commands

SQLite is the right choice for this demo. There is one user, one local server,
and a modest number of concurrent writes. It is a real relational database,
requires no infrastructure ceremony, and makes reset/rehearsal painless.
Moving to Postgres would add setup without demonstrating sandbox agents.

Use short-lived SQLAlchemy sessions per request and per agent event write.
The agent run itself should not hold a database transaction open.

### Frontend

Use:

- React
- TypeScript
- Vite
- TanStack Query for API state and invalidation
- React Router
- Plain CSS variables and component CSS, or a small utility layer; do not
  introduce a large design-system dependency for this demo

Style it as a compact Linear-like work board using the chosen Rose Pine light
palette:

```css
--background: #faf4ed;
--foreground: #575279;
--accent: #d7827e;
```

### Runtime Shape

Development should be two simple commands:

```bash
uv run uvicorn app.main:app --reload --port 8421
npm run dev
```

Vite proxies `/api` and `/files` to the Python server. Add an optional
`make dev` or `just dev` convenience target later, but do not couple the
initial scaffold to a process supervisor.

## Repository Layout

```text
oai-agents-conference-demo/
  README.md
  PLAN.md
  DEMO_OUTLINE.md
  SCAFFOLD_PLAN.md
  .env.example
  .gitignore
  pyproject.toml
  uv.lock
  alembic.ini
  migrations/
    env.py
    versions/
      0001_initial.py

  app/
    __init__.py
    main.py
    config.py
    db.py
    models.py
    schemas.py
    seed.py
    api/
      tasks.py
      assignees.py
      files.py
      runs.py
      settings.py
      reset.py
    services/
      task_service.py
      activity_service.py
      run_service.py
      assignee_service.py
      workspace_service.py
    storage/
      base.py
      local.py
      r2.py
    agents/
      registry.py
      program_editor.py
      asset_producer.py
      runtime.py
      tools.py
      providers/
        docker.py
        modal.py
    demo/
      capability_flags.py

  data/
    .gitkeep
    fixtures/
      editorial-task/
        abstract-draft.md
        speaker-bio.docx
        session-metadata.json
        agenda-content-rules.md
      asset-task/
        speaker-headshot-original.png
        slides-draft.pdf
        accessibility-request.txt
        event-page-template/

  web/
    package.json
    vite.config.ts
    tsconfig.json
    src/
      main.tsx
      app.tsx
      api/
        client.ts
        queries.ts
        types.ts
      pages/
        board-page.tsx
        agents-page.tsx
      components/
        app-shell.tsx
        board.tsx
        board-column.tsx
        task-card.tsx
        task-drawer.tsx
        file-list.tsx
        activity-list.tsx
        runs-list.tsx
        preview-panel.tsx
        agent-config-panel.tsx
      styles/
        tokens.css
        app.css

  tests/
    test_tasks_api.py
    test_workspace_service.py
    test_reset_seed.py
    test_agent_tools.py
```

## Application Behavior In The Skeleton

Before any demo step is completed, the application supports:

- An empty board at first boot.
- Creating, editing, and deleting tasks.
- Generic status columns:

  ```text
  Queued | In Progress | Ready for Review | Done | Blocked
  ```

- Tags such as `Editorial`, `Assets`, `Accessibility`, `Publishing`, and
  `Urgent`.
- A fixed current human user: `Steve C`.
- A directory of available human and agent-shaped assignees.
- Task comments authored manually by Steve.
- File uploads and downloads.
- A task drawer with `Files`, `Activity`, `Output`, and `Preview` tabs.
- A reset/seed endpoint that prepares the two known demonstration tasks.
- An agent settings surface showing integration readiness:

  ```text
  Program Editor       Not configured
  Docker sandbox       Not configured
  Editorial skill      Not configured
  Modal sandbox        Not configured
  Workflow tools       Not configured
  Assignee search      Not configured
  R2 workspace         Local storage
  ```

- Creating a task assigned to an available agent dispatches it after its
  attachments are staged. A comment becomes the follow-up dispatch surface:

  ```text
  Commenting dispatches this task to Program Editor Agent.
  ```

Before Step 1 is implemented, dispatch comments remain ordinary task comments.

## Database Schema

Use database rows for board and run metadata. Use filesystem or R2 objects for
actual attached/generated bytes.

### `users`

Represents assignees. Agents are assignees too; authentication is not part of
this demo.

```text
id                  text primary key
display_name        text not null
kind                text not null        -- human | agent
title               text
avatar_initials     text not null
capabilities_json   text not null        -- JSON array
created_at          datetime not null
```

Seed:

```text
steve-c               Steve C                  human   Program Director
program-editor        Program Editor Agent     agent   Editorial
asset-producer        Asset Producer Agent     agent   Assets, Accessibility, Publishing
```

### `tasks`

```text
id                  text primary key
issue_key           text unique not null       -- CLS-101
title               text not null
description         text not null default ''
status              text not null              -- queued | in_progress | ready_for_review |
                                               -- done | blocked
assignee_id         text nullable references users(id)
created_by_id       text not null references users(id)
session_name        text nullable
workspace_key       text not null unique       -- tasks/cls-101-review-session-copy-priya
created_at          datetime not null
updated_at          datetime not null
```

### `tags` and `task_tags`

```text
tags: id, name, color
task_tags: task_id, tag_id
```

### `attachments`

Tracks both original uploads and generated artifacts.

```text
id                  text primary key
task_id             text not null references tasks(id)
kind                text not null              -- input | output | handoff
file_name           text not null
storage_path        text not null              -- destination path in the run manifest
content_type        text nullable
size_bytes          integer not null
uploaded_by_id      text nullable references users(id)
created_at          datetime not null
```

Do not store file bytes in SQLite. The point of the demo is that files have a
workspace life beyond the database.

### `comments`

```text
id                  text primary key
task_id             text not null references tasks(id)
author_id           text not null references users(id)
body_markdown       text not null
created_at          datetime not null
```

### `activity_events`

Feeds a compact timeline in the task drawer.

```text
id                  text primary key
task_id             text not null references tasks(id)
actor_id            text nullable references users(id)
event_type          text not null              -- task_created | status_changed |
                                               -- assignee_changed | file_added |
                                               -- comment_added | run_started |
                                               -- run_completed | run_failed
payload_json        text not null
created_at          datetime not null
```

### `agent_runs`

```text
id                  text primary key
task_id             text not null references tasks(id)
agent_user_id       text not null references users(id)
provider            text not null              -- docker | modal
status              text not null              -- queued | running | awaiting_approval | completed | failed
workspace_backend   text not null              -- local | r2
summary             text nullable
trace_id            text nullable
started_at          datetime nullable
completed_at        datetime nullable
created_at          datetime not null
```

### `demo_capabilities`

This makes the UI truthful about what Steve has wired in during the demo.

```text
key                 text primary key           -- docker_agent | editorial_skill | modal |
                                               -- board_tools | completion_approval | r2
enabled             boolean not null
detail              text nullable
updated_at          datetime not null
```

The service updates a flag only after the corresponding implementation is
actually active.

## Attachment Storage And Manifest

Define a deliberately small local file store from the beginning:

```py
class AttachmentStore(Protocol):
    def write(self, task: Task, attachment: Attachment, source: BinaryIO) -> int: ...
    def open(self, task: Task, attachment: Attachment) -> BinaryIO: ...
    def clear_all(self) -> None: ...
```

### Baseline: `LocalAttachmentStore`

The initial server stores bytes under:

```text
data/files/<attachment.id>
```

`Attachment.storage_path` records where each blob should appear inside
`/workspace/task`. The Docker manifest creates the folders and maps each
attached blob into place when a run begins.

### Demo Step 6: R2 Attachments And Mounted Inputs

Once revealed, UI uploads and collected generated artifacts use R2 object
storage while preserving their manifest-relative paths:

```text
s3://<bucket>/<task.workspace_key>/
  input/original/
  working/
  output/
  handoffs/
```

R2 uses the S3-compatible API. The prepared `S3Mount` maps only the task's
`input/` prefix to `/workspace/task/input`; `working/`, `output/`, and
`handoffs/` remain ordinary sandbox directories whose generated files are
collected back into the active attachment store after a run.

## API Surface

The frontend should use conventional CRUD APIs from the first commit.

```text
GET    /api/me
GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/{task_id}
PATCH  /api/tasks/{task_id}
POST   /api/tasks/{task_id}/comments
POST   /api/tasks/{task_id}/approval
POST   /api/tasks/{task_id}/attachments
GET    /api/tasks/{task_id}/attachments/{attachment_id}/download
GET    /api/tasks/{task_id}/activity

GET    /api/assignees
GET    /api/tags
GET    /api/demo/capabilities
POST   /api/demo/reset

```

Use server-sent events or short polling for run updates. For this demo, short
polling every second is adequate and materially simpler; the user needs a
credible activity stream, not a realtime infrastructure lesson.

## Backend Service Boundaries

The regular HTTP endpoints and future agent tools must call the same service
methods:

```py
TaskService.update_status(task_id, status, actor_id)
TaskService.update_assignee(task_id, assignee_id, actor_id)
ActivityService.add_comment(task_id, body, actor_id)
AssigneeService.search(query, capabilities)
WorkspaceService.for_task(task_id)
RunService.dispatch_comment(task_id, agent_id, comment)
```

This matters for the live demo. Step 4 exposes existing application operations
as SDK function tools. Step 5 adds an SDK approval boundary around completion;
neither stage introduces a parallel business-logic path.

## Agent Runtime Shape

Agent execution is dispatched after an assigned task is created with all of
its attachments staged, or by the ordinary comment endpoint once an existing
task is assigned to an agent:

```py
POST /api/tasks
POST /api/tasks/{task_id}/comments
```

Before Step 1, the task remains usable as a manual board and no configured
agent starts.

After Step 1:

1. Create a task assigned to `Program Editor Agent`, including its source files.
2. The completed create operation dispatches its initial pass.
3. Dispatch moves the task to `In Progress`.
4. Later comments dispatch follow-up passes on the assigned task.
5. Create an `agent_runs` row.
6. Resolve the task workspace.
7. Execute `Program Editor` against the mounted workspace.
8. Record run events and files generated by the sandbox.
9. Refresh the task drawer from normal APIs.

Run events shown in the UI should be restrained:

```text
Started Docker sandbox
Mounted task workspace
Read input/original/abstract-draft.md
Wrote working/revised-abstract.md
Wrote handoffs/editorial-review.md
Run completed
```

Do not dump model chain-of-thought or raw internal reasoning into the UI.

## Structured Demo Comments

Use a single short searchable marker only at source locations Steve edits:

```py
# STEP-01: Reveal the file-working Program Editor.
```

In code this line uses an `@` before `STEP` so `rg '[@]STEP-' app` finds only
live edits. Documentation and UI copy use plain `STEP-NN` so they do not show
up in that search. Keep the insertion points small enough to type or paste
live; do not leave core database, routing, upload, or UI plumbing as a demo
TODO.

## Live Integration Hooks

### `STEP-01`: Docker-Backed Program Editor

Location:

```text
app/agents/program_editor.py
```

Skeleton behavior:

- `build_program_editor()` raises `NotImplementedError`.
- Docker provider, task manifest construction, run recording, and artifact
  collection are already implemented.
- Capability flag `docker_agent` is false.
- Create/comment dispatch waits for the agent implementation to be revealed.

Live change:

- Delete the `NotImplementedError`; the prepared `SandboxAgent` return named
  `Program Editor` immediately below it becomes live.
- Keep the empty tools list unchanged at this stage.

After the edit:

- Enable `docker_agent`.
- Creating an assigned editorial card with source files creates output files.
- The task remains `Queued`, highlighting that the agent cannot yet act on the
  board.

### `STEP-02`: Add The Editorial Skill

Location:

```text
app/agents/program_editor.py
https://github.com/sdcoffey/conference-program-editor-skill
```

Skeleton behavior:

- The skill does not live in this application repository.
- The Program Editor constructor contains the prepared insertion point.
- Capability flag `editorial_skill` is false.

Live change:

- Add the SDK `Skills` capability to the Program Editor agent with
  `from_=GitRepo(repo="sdcoffey/conference-program-editor-skill", ref="main")`.
- Use a Docker sandbox image with `git` installed so `GitRepo` can materialize
  the source inside the sandbox.
- Show the external `SKILL.md`, which contains abstract length, public bio,
  source preservation, missing metadata, and output format rules.

After the edit:

- Enable `editorial_skill`.
- The next dispatch comment produces normalized editorial outputs and a structured handoff.

### `STEP-03`: Configure Modal And Move Snapshots To R2

Location:

```text
app/agents/providers/modal.py
.env.example
```

Skeleton behavior:

- Docker runs store sandbox snapshots locally under `data/snapshots/`.
- The Modal SDK extra is installed but its prepared provider return is disabled.
- The runtime has one provider selection path shared by both agents.
- The UI shows Modal as not configured.

Live change:

- Delete the `NotImplementedError`; the complete Modal and R2 snapshot
  configuration immediately below it becomes live.

After the edit:

- Enable `modal`.
- The settings panel shows a hosted provider is ready.
- Both implemented agents now run in Modal.
- A hosted run that pauses for approval persists its sandbox snapshot in R2
  and restores it when Steve resolves the approval.

### `STEP-04`: Give Agents Board Tools

Location:

```text
app/agents/program_editor.py
```

Skeleton behavior:

- Humans already use comments, status, and assignment APIs.
- Successful agent final responses are already posted as task comments.
- The SDK workflow tools are already implemented over the same services as
  the UI, including assignee discovery.
- They are not attached to the Program Editor.

Live change:

- Import `WORKFLOW_TOOLS`, which includes status, assignment, and assignee
  search.
- Add `*WORKFLOW_TOOLS` to the prepared agent `tools` list.

After the edit:

- Enable `board_tools`.
- The runtime has already moved active work into `In Progress`; the agent must
  choose `Ready for Review`, `Blocked`, or approved `Done` before finishing.
- The editorial card moves:

  ```text
  Queued -> In Progress -> Ready for Review
  ```

- Its final response appears as an agent-authored comment in `Activity`,
  independently of the mutation tools.

### `STEP-05`: Require Approval For Done

Location:

```text
app/agents/tools.py
```

Skeleton behavior:

- The output panel and approval endpoint are already prepared for paused runs.
- `requires_completion_approval()` returns true only for a `done` transition.
- The callback is not yet attached to `update_status`.

Live change:

- Add `needs_approval=requires_completion_approval` to the prepared
  `@function_tool(...)` decorator.

After the edit:

- Enable `completion_approval`.
- An agent can move through ordinary workflow states without interruption.
- An attempted move to `Done` pauses in `Output` until Steve approves or
  declines it.
- The demo keeps the resumable SDK state in server memory; a production
  approval queue would serialize that state into durable storage.

### `STEP-06`: Move Task Uploads And Inputs To R2

Location:

```text
app/main.py
app/storage/manifest.py
.env.example
```

Skeleton behavior:

- Manual UI uploads store flat local blobs.
- The local manifest maps those blobs into the common `/workspace/task` layout.
- `R2AttachmentStore` and its R2 input manifest are fully prepared.

Live change:

- Configure R2 credentials.
- Uncomment the prepared `R2AttachmentStore(settings_config)` switch.
- Create the asset task with attached files after the switch.

After the edit:

- Enable `r2`.
- Assign the asset task and comment to dispatch it in Modal.
- Task upload artifacts are written to R2, the fresh hosted sandbox reads the
  scoped R2 input mount, and generated preview/handoff artifacts are collected
  into R2 after the run.

## Important Stagecraft Decision

Do not build automatic task-to-task dependencies in the skeleton. Use two
independent tasks concerning the same session:

```text
CLS-101  Review session copy for Priya Shah
CLS-102  Produce agenda page preview for Priya Shah
```

This avoids spending the demo explaining a project-management data model. The
real lesson is that different sandboxed specialists can work from different
file-intensive tasks through the same board.

## Seed And Reset Strategy

`POST /api/demo/reset` should:

1. Delete and recreate only demo database rows and local workspace contents.
2. Preserve environment configuration and code-enabled capabilities.
3. Offer two modes:

   ```json
   { "state": "empty" }
   { "state": "ready_for_agent_demo" }
   ```

Use `empty` for the start of the live demonstration. Use
`ready_for_agent_demo` during rehearsal or recovery; it creates the two
conference tasks and attaches all fixtures.

Do not require a terminal reset during the demo.

## Skeleton Delivery Milestones

### Milestone 1: Runnable Board

Deliver:

- Python/FastAPI server boot.
- SQLite database and initial migration.
- React/Vite UI in the Rose Pine Linear-like design.
- Task CRUD, tags, assignees, comments, local attachment storage.
- Empty and seeded reset states.

Verification:

- Start backend and frontend.
- Create a card manually, attach a file, comment, change status and assignee.
- Reload and confirm persistence.

### Milestone 2: Workspace And Run Surfaces

Deliver:

- Local task workspace convention.
- Files/activity/output/preview drawer tabs.
- Agent configuration page.
- Agent-assignment and comment-dispatch messaging.
- `agent_runs` and activity event recording plumbing.

Verification:

- Seed tasks and browse their local files in the UI.
- Confirm disabled agent UI is polished and truthful.

### Milestone 3: Narrow Live-Code Hook Points

Deliver:

- Prepared Python implementation with only staged constructor/mount reveals
  and tool attachment edits disabled.
- Structured `STEP-NN` comment anchors at the live edit locations.
- Capability readiness flags surfaced in the UI.
- Small tests proving staged hooks are disabled cleanly and normal board APIs remain
  usable.

Verification:

- `rg '[@]STEP-' app` shows every stage insertion point.
- Complete none of the TODOs and confirm the application still runs.

### Milestone 4: Rehearsal Pass

Complete all seven staged edits in a rehearsal copy or commit series. This is
your recovery route and verifies the demo is possible end to end.

Do not start from a partially wired main demo state. The on-stage branch should
open with its intentionally disabled reveal points.

## Tests Worth Building Into The Skeleton

Focus tests on plumbing that must not break during a demo:

```text
test_empty_board_boots
test_create_task_and_persist_status
test_upload_creates_input_original_attachment
test_add_comment_creates_activity_event
test_reset_empty_clears_tasks
test_reset_seed_creates_known_fixture_tasks
test_assigned_create_stages_attachments_before_dispatch
test_assignment_alone_does_not_dispatch_agent
test_assignee_search_service_finds_seeded_agents
test_local_workspace_uses_final_directory_contract
```

Later wired-branch tests:

```text
test_agent_tool_updates_status_through_task_service
test_completed_agent_run_posts_final_response_as_agent_comment
test_task_manifest_scopes_workspace_to_one_task
test_r2_prefix_is_task_scoped
```

Avoid mocking the board services heavily. The most valuable tests use a
temporary SQLite database and temporary workspace directory so the same code
paths exercised in the UI are covered.

## Configuration

The skeleton `.env.example` should contain placeholders, even while the
features are disabled:

```bash
DATABASE_URL=sqlite:///./data/conference_desk.sqlite3
FILE_STORAGE_ROOT=./data/files
OPENAI_API_KEY=

# Hosted sandbox settings used by STEP-03.
MODAL_APP_NAME=conference-launch-desk

# R2 settings used by STEP-03 snapshots and STEP-06 task uploads.
R2_ENDPOINT_URL=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=conference-launch-desk
R2_PREFIX=tasks
R2_SNAPSHOT_PREFIX=snapshots
```

Never bake working credentials into the repo or stage them in the UI.

## Definition Of Done For The Skeleton

The initial skeleton is done when:

- `uv run uvicorn app.main:app --reload --port 8421` starts the Python API.
- `npm run dev` from `web/` starts the client.
- The app opens with an empty, polished task board.
- Steve can create the hero tasks and upload fixtures without editing code.
- Manual comments, status changes, and assignment work and persist in SQLite.
- Local attached files can be switched to R2 without changing API behavior or
  the agent-facing workspace layout.
- The agent settings and run surfaces exist but honestly show integrations as
  disabled.
- Every live demo code insertion point is marked with a structured
  `STEP-NN` anchor in the Python file it changes.
- A follow-up implementation can complete each agentic stage without
  restructuring the server or client.
