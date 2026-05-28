# Conference Launch Desk

## The Pitch

Conference operations teams do not receive neat records. They receive folders:
abstracts, speaker bios, headshots, slide drafts, brand rules, accessibility
requests, and last-minute corrections. The demo is a lightweight work board
where sandboxed agents pick up those tasks, work directly with attached files,
and return reviewable artifacts.

The board stays intentionally generic:

```text
Queued -> In Progress -> Ready for Review -> Done
                         \-> Blocked
```

The conference-specific behavior lives in task tags, files, skills, and the
agents assigned to the work.

## Why This Demo

This is more convincing than a generic task tracker because the useful work
cannot happen in a chat transcript. An editorial task requires source
documents and produces revised copy. An asset task requires images and slides
and produces a page preview. A fresh hosted agent needs the durable folder
created by an earlier run.

It demonstrates the sandbox as the agent's working environment:

- Docker gives us a simple local development loop.
- A skill turns a general agent into a conference specialist.
- Board tools let the agent participate in the workflow.
- Assignee search enables specialist routing.
- R2 stores hosted sandbox snapshots, task uploads, and collected artifacts;
  hosted agents mount the task input prefix.
- Modal lets the same kind of work run in hosted sandboxes.

## Hero Session

The board is preparing a public agenda page for one submitted session:

```text
Production Readiness for Long-Running Agents
Speaker: Priya Shah, Acme Infrastructure
Track: Applied AI
Format: 30-minute breakout
```

Use two tasks tied to this session. This keeps the columns generic while
showing that different agents can contribute to the same event.

### Task 1: Review Session Copy

```text
Title: Review session copy for Priya Shah
Tags: Editorial, Urgent
Status: Queued
Files:
  abstract-draft.md
  speaker-bio.docx
  session-metadata.json
  agenda-content-rules.md
```

Seeded issues:

- Abstract is 348 words; the public site permits 150.
- The draft title disagrees with `session-metadata.json`.
- The public bio contains an email address.
- Track metadata is missing.

Expected outputs:

```text
revised-abstract.md
public-speaker-bio.md
normalized-session-metadata.json
editorial-review.md
```

### Task 2: Produce Session Page Assets

```text
Title: Produce agenda page preview for Priya Shah
Tags: Assets, Accessibility, Publishing
Status: Queued
Files:
  speaker-headshot-original.png
  slides-draft.pdf
  demo-screenshots/
  accessibility-request.txt
  event-page-template/
```

Seeded issues:

- Speaker headshot is too large and not square.
- Slides include an outdated sponsor logo.
- The speaker requested captions and high-contrast presentation support.

Expected outputs:

```text
headshot-square.png
slide-review.md
session-page/index.html
publish-manifest.json
asset-production.md
```

## Agent Roles

### Program Editor

The first and simplest agent. It reviews copy, normalizes public metadata, and
produces a handoff note. It must not invent missing speaker or scheduling data,
overwrite source files, or mark work done without review.

### Asset Producer

The second specialist agent. It creates publishable image and web assets from
approved copy and original source media, while carrying forward accessibility
requirements.

## Task Workspace

Each task owns a stable folder. Original uploads remain immutable; the agent
writes revised material and handoffs alongside them.

```text
/workspace/task/
  input/
    original/
  working/
  output/
  handoffs/
```

After the R2 upload step:

```text
r2://conference-launch-desk/tasks/review-session-copy-priya/
  input/original/
  working/
  output/
  handoffs/

r2://conference-launch-desk/tasks/produce-agenda-preview-priya/
  input/original/
  working/
  output/
  handoffs/
```

The discipline matters:

- `input/original/` is read-only source material.
- `working/` contains intermediate or revised materials.
- `output/` contains files a reviewer might approve or publish.
- `handoffs/` explains what happened and what the next owner must inspect.

The first implementation does not need project dependencies between cards.
Two cards can reference the same session and carry the relevant approved files
as attachments. That keeps the demo centered on sandbox agents.

## Product Surfaces

Keep the UI small. Four surfaces are enough:

1. **Board**: task cards organized by generic state.
2. **Task drawer**: tags, assignee, attached files, activity, artifacts, runs.
3. **Agent configuration**: instructions, skills, tools, sandbox provider.
4. **Preview**: the generated public session page.

Card contents:

```text
Task title
Tag pills
Assignee
Attachment count
Latest run environment: Docker or Modal
Latest artifact or comment
```

## Capability Ladder

### 1. Empty Board

Create the editorial task, attach its source documents, and leave it in
`Queued`. The UI can hold work, but nothing acts on it.

### 2. Docker Sandbox Agent

Create `Program Editor` backed by Docker. A new task created with the agent
already assigned runs once its attached files are staged; an additional
comment on an assigned task dispatches another pass. The agent mounts the task
files into `/workspace/task`, reads them, and writes proposed output files.

Dispatch immediately moves the card to `In Progress`. At this point the agent
can work on files and leave its final summary, but without workflow tools it
cannot choose the review outcome or assignment.

### 3. Conference Editorial Skill

Add the public `sdcoffey/conference-program-editor-skill` Git repository as a
skills source. It contains conference rules and output templates:

```text
conference-program-editor-skill/
  conference-program-editor/
    SKILL.md
    references/
      agenda-content-rules.md
      accessibility-checklist.md
    templates/
      editorial-review.md
```

Rules should be visible and practical:

- Titles are at most 80 characters.
- Abstracts are at most 150 words.
- Public bios may not contain contact information.
- Missing factual metadata is flagged, not fabricated.
- All generated material goes outside `input/original/`.

The next dispatch comment produces recognizable, repeatable conference work.

### 4. Modal Provider And Snapshot Destination

Configure Modal as the hosted sandbox provider while retaining the same agent
and skill shape. Present it as the next execution option for busy submission
periods, when many tasks can run concurrently.

Docker starts by writing sandbox snapshots to `data/snapshots/`. When Modal is
revealed, switch that same snapshot contract to R2 so a paused hosted run can
resume durably. Do the meaningful hosted task handoff later, after task inputs
also live in R2.

### 5. Board Tools

Attach the workflow functions:

```ts
update_status(taskId, status)
update_assignee(taskId, assigneeId)
search_assignees(query, capabilities)
```

Now `Program Editor` can:

- Move it to `Ready for Review` or `Blocked`.
- Assign it for review.

The app posts the agent's final response as its task comment after each
successful run. The agent must update status before its final response, so a
completed pass does not sit indefinitely in `In Progress`.

### 6. Completion Approval

Add a conditional approval to `update_status`: transitions to `Done` pause for
Steve C, while ordinary working transitions continue without interruption.

When the agent tries to complete the card, its output panel shows the pending
request and `Approve` / `Decline` actions. Approving resumes the paused run;
declining lets the agent leave the task in a reviewable state and explain why.

The workflow tools also include:

```ts
search_assignees(query, capabilities)
```

Seed a directory:

```text
Program Editor Agent      Editorial
Asset Producer Agent      Assets, Accessibility, Publishing
Steve C                   Program Director
```

The editorial agent can route review-ready work back to Steve rather than
relying on a hardcoded assignee. The asset task later uses `Asset Producer Agent`.

### 7. R2 Task Inputs

With Modal snapshots already in R2, switch task uploads to R2 and mount the
selected task's `input/` prefix into a fresh Modal sandbox. Comment on the
assigned asset task to dispatch it in the hosted environment. It reads the
uploaded inputs, writes a web preview and handoff artifacts, then updates its
card.

This is the decisive demo point: a new hosted agent can continue real work
because the task's filesystem outlives any one sandbox.

## Suggested Seeded Agent Behavior

The editorial task should end with:

```text
Status: Ready for Review
Assignee: Steve C

Comment:
Editorial review complete. Revised the abstract to 147 words, removed public
contact information from the bio, and normalized the session title. Track is
still missing from the submitted metadata and needs confirmation before
publication.
```

The asset task should end with:

```text
Status: Ready for Review
Assignee: Steve C

Comment:
Agenda-page preview ready. Headshot has been resized for publication, outdated
sponsor branding is flagged in the slide review, and captioning/high-contrast
requirements are included in the publish manifest.
```

## Guardrails

- Never modify original uploaded files.
- Never invent missing event facts or approvals.
- A task reaches `Done` only through an explicit human approval.
- Keep access scoped to the task's mounted workspace.
- Use synthetic conference materials and speaker identities in the live demo.

## Build Order

1. Board UI and task drawer with local seeded data.
2. Docker-backed `Program Editor` running on the editorial task.
3. Skill loading and a visible difference between generic and specialized runs.
4. Modal hosted execution with R2-backed sandbox snapshots.
5. Tool-backed status, assignment, and assignee discovery, with final responses posted as comments.
6. Conditional human approval for agent attempts to mark work `Done`.
7. R2-backed task uploads and mounted inputs.
8. Modal-backed run for the asset task.
9. Session-page preview and polished demo reset state.

## Questions To Settle

- Is R2 mounted as a filesystem abstraction, or synced before and after each
  sandbox run? Use whichever is most real in the SDK integration.
- Does the first version support multiple tasks for one session in the data
  model, or simply seed two independent cards with matching session metadata?
- Is `Done` gated by an explicit human approval in the live demo? Yes.
- Should the asset task run real image/PDF transformations or use prepared,
  deterministic processing scripts? Recommended: real but tightly bounded.
