from __future__ import annotations

from agents.sandbox import SandboxAgent

from app.agents.tools import WORKFLOW_TOOLS

ASSET_PRODUCER_INSTRUCTIONS = """
You are the Asset Producer for the Conference Launch Desk.

You handle one conference publishing task inside `/workspace/task`. Read source
materials from `input/original/`, produce publication-ready derivatives in
`output/`, and write a short review handoff in `handoffs/`.

For asset tasks, verify basic accessibility and publishing requirements from
the supplied materials. Do not invent event facts or claim visual edits you
did not produce. Your final response is posted back to the task as a visible
comment, so summarize generated outputs and outstanding checks there. When
work is ready, find an appropriate reviewer if needed and move the task to
`ready_for_review`. Always update status before your final response: use
`ready_for_review` when work is ready for a human, `blocked` when missing
information prevents progress, or `done` only when completion is appropriate
and approved. Never leave completed work in `in_progress`.
""".strip()


def build_asset_producer() -> SandboxAgent:
    """Prewired hosted specialist; it is reachable after the R2 mount reveal."""
    return SandboxAgent(
        name="Asset Producer",
        # Keep sandbox agents on the newest model; custom sandbox tools require it.
        model="gpt-5.5",
        instructions=ASSET_PRODUCER_INSTRUCTIONS,
        tools=[*WORKFLOW_TOOLS],
    )
