"""Action tools the agent can call.

These are written as small, single-purpose functions — the same shape as
`function_tool`-decorated tools in 12-agentic-tool-calling and
26-agents-sdk/app/agents/tools.py — so they could be handed directly to an
LLM tool-calling loop later. For this build they're invoked by the
deterministic policy in policy.py instead of by a model, but the boundary
is the same: the dialogue policy decides *when* to act, these functions
decide *what actually happens*.

SIMULATED, NOT REAL INTEGRATIONS:
Neither tool below talks to a real calendar, CRM, or paging system. They
record structured records in-memory (or wherever the injected `sink`
writes them) and return a receipt. There is no fake confirmation of a
scheduled time slot, and no fake "Danny has been notified" claim beyond
"we logged a request for a human to follow up." Wire `book_inspection` and
`escalate_to_danny` up to real systems (a scheduling API, Slack/SMS to
Danny) by replacing `InMemorySink` with a real implementation of the
`EventSink` protocol — the agent-facing function signatures don't change.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol

from roof_watcher.config import COMPANY_NAME, COMPANY_PHONE, ESCALATION_CONTACT_NAME


class EventSink(Protocol):
    """Where booking/escalation records go. Swap for a real integration."""

    def record(self, kind: str, payload: dict) -> None: ...


@dataclass
class InMemorySink:
    """Default SIMULATED sink: just appends to a list. No network calls."""

    events: list[dict] = field(default_factory=list)

    def record(self, kind: str, payload: dict) -> None:
        self.events.append({"kind": kind, **payload})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def book_inspection(sink: EventSink, address: str) -> dict:
    """Log a simulated inspection request. Does NOT confirm a real time.

    Returns a receipt with a local reference number the agent can quote
    back to the customer. This is explicitly NOT a scheduled appointment —
    no date/time is invented — it's a record that a human needs to call
    the customer to schedule.
    """
    reference = f"RW-{uuid.uuid4().hex[:8].upper()}"
    payload = {
        "reference": reference,
        "address": address,
        "requested_at": _now(),
        "company": COMPANY_NAME,
        "status": "pending_human_confirmation",
    }
    sink.record("inspection_request", payload)
    return payload


def escalate_to_danny(sink: EventSink, reason: str, rule: int) -> dict:
    """Log a simulated escalation. Does NOT actually page/text/call anyone.

    Returns a receipt describing what would need to happen in a real
    integration (e.g. post to a Danny-notifications Slack channel, or fire
    an SMS via Twilio) so this is trivially swappable later.
    """
    payload = {
        "escalated_to": ESCALATION_CONTACT_NAME,
        "reason": reason,
        "rule": rule,
        "escalated_at": _now(),
        "callback_number": COMPANY_PHONE,
        "status": "logged_pending_human_notification",
    }
    sink.record("escalation", payload)
    return payload


def correct_booking_address(
    sink: EventSink, reference: str, old_address: str | None, new_address: str
) -> dict:
    """Log a simulated address correction on an already-logged request.

    Does NOT touch a real calendar/CRM record; it's a local log entry a
    real integration would replay against whatever system actually holds
    the inspection request.
    """
    payload = {
        "reference": reference,
        "old_address": old_address,
        "new_address": new_address,
        "corrected_at": _now(),
    }
    sink.record("address_correction", payload)
    return payload


def get_pricing_snapshot() -> dict:
    """Read-only lookup of the real, static pricing config (not a network
    call — just exposed as a tool for symmetry with the other two, and so
    a future LLM-tool-calling wrapper could call it directly)."""
    from roof_watcher.config import TIERS

    return {key: tier.__dict__ for key, tier in TIERS.items()}
