"""Conversation state for the Roof Watcher sales agent.

The whole point of modeling state explicitly (instead of leaning on an LLM's
implicit context) is that a sales script with hard requirements — never
promise a price before inspection, escalate only under four named rules,
never fabricate a booking confirmation — needs to be auditable and testable
turn by turn. Every field below is something a unit test can assert on.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Stage(str, Enum):
    GREETING = "greeting"
    QUALIFYING = "qualifying"
    OBJECTION = "objection"
    BOOKING = "booking"
    BOOKED = "booked"
    ESCALATED = "escalated"


class Role(str, Enum):
    OWNER = "owner"
    PROPERTY_MANAGER = "property_manager"
    OTHER = "other"


@dataclass
class QualificationState:
    """Answers to the five primary qualification questions."""

    issue_description: str | None = None
    is_leaking: bool | None = None
    leak_location: str | None = None
    leak_active: bool | None = None
    is_multiple_properties: bool | None = None
    role: Role | None = None
    address: str | None = None

    # Each "awaiting_*" flag is set the turn we ask that specific
    # qualification question, and cleared the turn we consume the answer.
    # This is what lets a plain "yes"/"no"/free-text reply be attributed to
    # the right field instead of guessed at from keywords alone.
    awaiting_issue_description: bool = False
    awaiting_is_leaking: bool = False
    awaiting_leak_details: bool = False
    awaiting_is_multiple: bool = False
    awaiting_role: bool = False
    awaiting_address: bool = False

    def is_complete(self) -> bool:
        return self.address is not None

    def next_missing_field(self) -> str | None:
        """Returns the name of the next qualification field to collect.

        Leak reports use an abbreviated path per the business rule "move
        toward inspection immediately": once we know it's leaking and
        where, we go straight to booking instead of asking about property
        count / role, since an active leak is urgent.
        """
        if self.is_leaking:
            if self.leak_location is None:
                return "leak_location"
            if self.address is None:
                return "address"
            return None

        if self.issue_description is None:
            return "issue_description"
        if self.is_leaking is None:
            return "is_leaking"
        if self.is_multiple_properties is None:
            return "is_multiple_properties"
        if self.role is None:
            return "role"
        if self.address is None:
            return "address"
        return None


@dataclass
class EscalationState:
    """Tracks the four escalation triggers so we escalate ONLY on them."""

    escalated: bool = False
    reason: str | None = None
    triggered_rule: int | None = None
    think_it_over_unexplained_count: int = 0
    call_back_count: int = 0
    low_engagement_streak: int = 0
    custom_pricing_requested: bool = False
    # True while we're waiting on the customer to explain what they're
    # unsure about, after we've asked "What part are you unsure about?"
    awaiting_objection_explanation: bool = False
    # True while we're waiting on the customer's answer to "is there
    # anything holding you back from booking the inspection?"
    awaiting_callback_reason: bool = False


@dataclass
class BookingState:
    """Simulated inspection-booking state.

    IMPORTANT: `requested` means the customer asked for an inspection and we
    logged it locally. It is NOT a confirmed appointment time and does not
    touch any real calendar or CRM — see roof_watcher/tools.py.
    """

    requested: bool = False
    address: str | None = None
    request_reference: str | None = None


@dataclass
class Turn:
    speaker: str  # "customer" or "agent"
    text: str


@dataclass
class ConversationState:
    stage: Stage = Stage.GREETING
    qualification: QualificationState = field(default_factory=QualificationState)
    escalation: EscalationState = field(default_factory=EscalationState)
    booking: BookingState = field(default_factory=BookingState)
    history: list[Turn] = field(default_factory=list)

    def record(self, speaker: str, text: str) -> None:
        self.history.append(Turn(speaker=speaker, text=text))
