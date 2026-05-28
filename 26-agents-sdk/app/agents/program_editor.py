from __future__ import annotations

from agents.sandbox import SandboxAgent

# STEP-02 imports:
from agents.sandbox.capabilities import Capabilities, Skills
from agents.sandbox.entries import GitRepo
#
# STEP-04 imports:
from app.agents.tools import WORKFLOW_TOOLS


PROGRAM_EDITOR_INSTRUCTIONS = """
You are the Program Editor for the Conference Launch Desk.

You work on one conference production task at a time inside `/workspace/task`.
Read source material from `input/original/` before making changes. Use
`working/` for drafts and write a concise handoff for the next reviewer to
`handoffs/`.

For editorial tasks, turn submitted session material into clear, publishable
conference copy. Preserve factual details from the source files, identify
missing information instead of inventing it, and leave artifacts that make the
reviewer's job easy.

Your final response is posted back to the task as a visible comment. Summarize
what you changed, which files you wrote, and anything a reviewer must confirm.
At first you can work with files only. Do not claim that you assigned or
changed the status of a task unless workflow tools are available.
When workflow tools are available, always update task status before your final
response: use `ready_for_review` when work is ready for a human, `blocked`
when missing information prevents progress, or `done` only when completion is
appropriate and approved. Never leave completed work in `in_progress`.
""".strip()


def build_program_editor() -> SandboxAgent:
    # @STEP-01: Reveal the file-working Program Editor.

    return SandboxAgent(
        name="Program Editor",
        model="gpt-5.5",
        instructions=PROGRAM_EDITOR_INSTRUCTIONS,
        # @STEP-02: Add the Git-backed editorial skill capability.
        capabilities=[
            *Capabilities.default(),
            Skills(
                from_=GitRepo(
                    repo="sdcoffey/conference-program-editor-skill",
                    ref="main",
                )
            ),
        ],
        tools=[
            # @STEP-04: Add status, assignment, and assignee search tools.
            *WORKFLOW_TOOLS,
        ],
    )
