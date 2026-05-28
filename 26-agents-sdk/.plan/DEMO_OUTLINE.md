# Conference Launch Desk: 20-Minute Demo Outline

## One-Sentence Story

We start with an empty task board, add a locally running sandbox agent that can
review conference submission files, teach it the conference's editorial rules,
move it to Modal with R2-backed snapshots, give it workflow tools, then hand a
second task to a hosted agent reading uploaded inputs from R2.

## What To Prepare Before The Demo

Seed two tasks and keep the data deterministic:

```text
Review session copy for Priya Shah
  Tags: Editorial, Urgent

Produce agenda page preview for Priya Shah
  Tags: Assets, Accessibility, Publishing
```

Prepare synthetic source files:

```text
abstract-draft.md
speaker-bio.docx
session-metadata.json
agenda-content-rules.md
speaker-headshot-original.png
slides-draft.pdf
accessibility-request.txt
event-page-template/
```

Prepare seeded defects:

```text
Abstract too long
Conflicting session title
Email address in public bio
Missing track metadata
Non-square oversized headshot
Outdated sponsor logo on a slide
Captions and high-contrast support requested
```

Have the R2 bucket, snapshot prefix, and Modal credentials configured before
going on stage. The demo should teach the configuration shape, not wait on
setup.

## Opening State

Show the clean board:

```text
Queued | In Progress | Ready for Review | Done | Blocked
```

There are no tasks and no agents configured.

Narration:

> This is a conference production board. Sessions arrive as folders of copy,
> files, images, and slide drafts. We are going to add agents that can do work
> on those folders, not merely talk about the cards.

## Minute-By-Minute Flow

### 0:00-2:30 - Create A Real Task

Create:

```text
Review session copy for Priya Shah
Tags: Editorial, Urgent
Assignee: Unassigned
Status: Queued
```

Attach the four editorial source files and open the file list briefly.

Point out:

- The abstract is a draft document.
- The bio is a Word file.
- The metadata is structured JSON.
- Editorial policy is attached as reference material.

The task is clearly a folder-backed unit of work.

### 2:30-5:30 - Add A Docker Agent

Open `build_program_editor()`. The prepared `Program Editor` is already
visible; delete its single `NotImplementedError` guard.

Instructions:

```text
Review attached conference session materials for public agenda publication.
Read source files from /workspace/task/input/original.
Write proposed revisions to /workspace/task/working.
Write a review summary to /workspace/task/handoffs.
Never overwrite original source material.
```

Provider:

```text
Sandbox: Docker
```

Create the task with its files and `Program Editor Agent` already selected. It
dispatches immediately after the uploaded source files are staged:

```text
Review the attached submission and prepare the public agenda copy.
```

Open `Output` while it works:

```text
/workspace/task/input/original/abstract-draft.md
/workspace/task/input/original/speaker-bio.docx
/workspace/task/working/revised-abstract.md
/workspace/task/handoffs/editorial-review.md
```

Important beat: useful files exist, but the card itself still says `Queued`.
Its final summary is already visible as a comment, because every successful
agent run posts its final response back to the task.

Line:

> It can work inside a sandbox and report back. It does not know our editorial
> process, and it cannot yet route the card through the board.

### 5:30-8:00 - Add A Skill

Add the public `conference-program-editor` skill repository as a source:

```python
Skills(
    from_=GitRepo(
        repo="sdcoffey/conference-program-editor-skill",
        ref="main",
    )
)
```

Point out that the Docker sandbox image includes `git`, because Git-backed
skills are cloned into the sandbox at runtime.

Show a short excerpt, not the whole file:

```text
Abstract limit: 150 words
Public bios must omit personal contact information
Do not invent missing metadata
Write a normalized metadata file and editorial handoff
```

Comment on the assigned task to dispatch the newly specialized agent again.

Open generated artifacts:

```text
revised-abstract.md
public-speaker-bio.md
normalized-session-metadata.json
editorial-review.md
```

Expected result:

```text
Abstract shortened to 147 words.
Public email removed from bio.
Session title normalized.
Missing track metadata flagged for confirmation.
```

Line:

> The sandbox gave it a workplace. A versioned skill repository gave it the
> conference's way of doing the work.

### 8:00-10:00 - Configure Modal And Move Snapshots To R2

Open the prepared Modal provider. The complete R2-backed Modal provider is
already visible; delete its single `NotImplementedError` guard.

Keep this quick:

```text
Development provider: Docker + data/snapshots/<run-id>.tar
Hosted provider: Modal + r2://<bucket>/snapshots/<run-id>.tar
```

Explain:

> A single local run is fine while building the workflow. Agenda week means
> many independent session tasks arriving at once, so we want the same agent
> shape available in hosted sandboxes. Locally its paused workspace was a tar
> file on disk; in the hosted version I move that same resumable state to R2.

### 10:00-12:00 - Add Board Tools

Attach the prepared `WORKFLOW_TOOLS` bundle. It includes status updates,
assignment, and assignee discovery:

```py
tools=[*WORKFLOW_TOOLS]
```

Comment again to dispatch `Program Editor` with workflow tools attached. The
runtime immediately moves assigned work into `In Progress`; the agent must
move it out when it finishes.

The board card visibly moves:

```text
Queued -> In Progress -> Ready for Review
```

Its already-standard final-response comment can now report the state change:

```text
Editorial review complete. Revised abstract and public bio are ready for
review. Session title normalized. Track metadata is missing and needs
confirmation before publication.
```

Line:

> The agent already reported its work. Now it can move the card through the
> workflow, discover a reviewer, and ask for review where judgment is required.

### 12:00-13:00 - Require Approval For Done

Uncomment the prepared approval callback on `update_status`:

```py
@function_tool(needs_approval=requires_completion_approval)
```

Ask the assigned agent to mark the task `Done`. The run pauses in `Output`:

```text
Approve completion?
The agent wants to move this task to Done.    Decline  Approve
```

Approve once to show that the SDK resumes the same run through a human
decision, without placing approval friction on routine status updates.

### 13:00-14:00 - Route Work To The Next Owner

Use the assignee search tool already included in `WORKFLOW_TOOLS` to show
available users and agents:

```text
Asset Producer Agent      Assets, Accessibility, Publishing
Steve C                   Program Director
```

Have `Program Editor` discover and assign `Steve C` for review of the
editorial card.

Then create or reveal the second card:

```text
Produce agenda page preview for Priya Shah
Tags: Assets, Accessibility, Publishing
Status: Queued
```

Assign it by capability search to `Asset Producer Agent`.

### 14:00-16:30 - Move Task Inputs To R2 (`STEP-06`)

Open the attachment-store selection in `app/main.py`: it starts as flat local
blobs. Reveal `R2AttachmentStore`, then show how
`task_workspace_manifest()` mounts the uploaded input prefix:

```text
r2://conference-launch-desk/tasks/produce-agenda-preview-priya/
  input/original/
```

Show attachments placed in `input/original/`:

```text
speaker-headshot-original.png
slides-draft.pdf
accessibility-request.txt
event-page-template/
```

Explain:

> Comments coordinate ownership. Files carry the work. Uploads now land
> directly in R2, and a fresh hosted sandbox mounts exactly this task's input
> prefix. When the run finishes, the app stores generated artifacts back in
> the same R2-backed attachment store.

Uncomment the one prepared store switch. The manifest selects the scoped R2
input mount because the task's active attachment store is now R2-backed.

### 16:30-18:30 - Hosted Agent Produces The Preview

Assign `Asset Producer Agent`, then comment to dispatch it in Modal.

It should:

- Read original task files from the R2-backed mount.
- Create a square headshot.
- Inspect or flag the outdated sponsor logo.
- Generate the session-page preview.
- Preserve captioning and high-contrast requirements in a manifest.
- Comment on the card and move it to `Ready for Review`.

Generated workspace:

```text
output/
  session-page/
    index.html
    assets/headshot-square.png
  publish-manifest.json
handoffs/
  asset-production.md
```

Open the public session page preview.

### 18:30-20:00 - Close On The Workflow

Return to the board. Two cards are now in `Ready for Review`:

```text
Review session copy for Priya Shah
  Assignee: Steve C
  Last run: Docker

Produce agenda page preview for Priya Shah
  Assignee: Steve C
  Last run: Modal
```

Open the second card's activity and file tabs to show:

- Its comments and assignment history.
- Its R2-backed outputs and handoff note.
- Its hosted run.
- Its generated preview.

Closing line:

> The board routed the work. Skills gave agents job-specific behavior. The
> sandbox let them operate on real materials. R2 made their work durable, and
> Modal let a fresh agent continue it in the cloud.

## Code And UI Moments Worth Showing

Keep the code glimpses short and cumulative:

1. A tiny prepared `Program Editor` reveal using Docker.
2. The added `sdcoffey/conference-program-editor-skill` Git source.
3. The prepared Modal provider and R2 snapshot reveal.
4. Attaching the prepared workflow tools.
5. Uncommenting conditional approval for transitions to `Done`.
6. Switching task uploads to R2 and mounting its input prefix for the hosted run.

The board and artifacts should stay on screen longer than configuration.

## UI Content For The Mockup

Header:

```text
Conference Launch Desk
Sessions and production tasks for Summit 2026
```

Column cards:

```text
Queued
  Produce agenda page preview for Priya Shah
  Tags: Assets, Accessibility
  Assignee: Asset Producer Agent
  4 files

In Progress
  Validate sponsor slide branding
  Tags: Assets, Brand Review
  Assignee: Asset Producer Agent
  Modal run active

Ready for Review
  Review session copy for Priya Shah
  Tags: Editorial, Urgent
  Assignee: Steve C
  Docker run complete
```

Open task drawer:

```text
Review session copy for Priya Shah
Editorial / Urgent

Tabs: Files | Activity | Output | Preview

Latest activity:
Program Editor
Editorial review complete. Revised abstract and cleaned public bio are ready
for review. Missing track metadata flagged for confirmation.

Artifacts:
revised-abstract.md
public-speaker-bio.md
editorial-review.md
```

## Demo Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Document or PDF processing is slow live | Pre-stage compact synthetic files and cache dependencies |
| Generated copy varies unexpectedly | Seed clear source defects and require structured outputs |
| Modal or R2 setup consumes demo time | Configure credentials and bucket prefixes ahead of time |
| Audience mistakes the UI for the point | Keep returning to mounted files, generated outputs, and fresh sandbox handoff |
| Agent marks unresolved work complete | Gate `Done` transitions with the conditional human approval step |

## Stretch Ending

If time is available, have the reviewer send the asset task back to
`In Progress` because track metadata is still missing, then attach a corrected
JSON file and rerun. This demonstrates durable iteration without adding a new
concept.
