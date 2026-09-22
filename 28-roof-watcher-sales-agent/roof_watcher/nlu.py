"""Deterministic intent detection.

Why regex/keyword rules instead of an LLM call: every line this agent is
allowed to say is dictated by a fixed sales script (see config.py), and the
escalation rules are a closed set of four conditions. A rules-based
classifier makes the whole system reproducible and unit-testable turn by
turn, with zero dependency on an external model API being configured. It
mirrors the tool-calling examples elsewhere in this repo (12-agentic-tool-
calling, 26-agents-sdk) in spirit — small, single-purpose functions the
orchestrator composes — just applied to intent recognition instead of to an
LLM's function-calling loop. See README.md for how to swap in an LLM-backed
classifier if you outgrow this.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from roof_watcher.models import Role

_PRICING_RE = re.compile(
    r"\b(what.*(charge|cost)|how much|price|pricing|rates?|fees?)\b", re.I
)

_TIER_PATTERNS: dict[str, re.Pattern[str]] = {
    "roof_watcher": re.compile(r"\broof\s*watcher\b", re.I),
    "watcher": re.compile(r"\bwatcher\b", re.I),
    "platinum": re.compile(r"\bplatinum\b", re.I),
}

_EXPERIENCE_RE = re.compile(
    r"\b(how (long|experienced)|years? (of )?experience|been in business|"
    r"licensed|credentials|how experienced)\b",
    re.I,
)

_REPAIR_COST_RE = re.compile(
    r"\b(repair|fix).{0,40}(cost|price|much)\b|\bhow much.{0,20}repair\b", re.I
)

_LEAK_RE = re.compile(r"\bleak(s|ing|y)?\b|water.{0,15}(coming|dripping|pooling)", re.I)

_ACTIVE_LEAK_YES_RE = re.compile(
    r"\b(yes|yeah|yep|right now|currently|still|actively)\b", re.I
)
_ACTIVE_LEAK_NO_RE = re.compile(
    r"\b(no|not right now|not currently|stopped|it stopped|dried up)\b", re.I
)

_THINK_ABOUT_IT_RE = re.compile(
    r"\b(think about it|need (some|a) time|not (sure|ready) yet|let me think|"
    r"have to think|mull it over)\b",
    re.I,
)

_CALL_BACK_RE = re.compile(
    r"\b(i'?ll call you back|call you back|get back to you|reach out later|"
    r"circle back)\b",
    re.I,
)

_CUSTOM_PRICING_RE = re.compile(
    r"\b(discount|custom price|custom pricing|payment plan|negotiate|"
    r"lower price|cheaper rate|special rate)\b",
    re.I,
)

_BOOKING_AFFIRM_RE = re.compile(
    r"^\s*(yes|yeah|yep|sure|ok(ay)?|sounds good|let'?s (do|book) it|"
    r"book (it|me)|let'?s go)\s*\.?\s*$",
    re.I,
)

_NUMBER_WORDS = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
}
_MULTIPLE_KEYWORD_RE = re.compile(
    r"\b(multiple|several|many|a few|portfolio|couple)\b", re.I
)
_SINGLE_KEYWORD_RE = re.compile(r"\b(single|just one|only one)\b", re.I)

_ROLE_OWNER_RE = re.compile(r"\bowner\b|\bi own\b", re.I)
_ROLE_MANAGER_RE = re.compile(
    r"\bproperty manager\b|\bmanag\w*\b|\bpm\b", re.I
)

_YES_RE = re.compile(
    r"^\s*(yes|yeah|yep|yup|correct|right|it is|still (is|leaking)|"
    r"actively)\b",
    re.I,
)
_NO_RE = re.compile(
    r"^\s*(no|nope|not (currently|right now|anymore)|it'?s not|stopped)\b",
    re.I,
)


def is_negative_leak_status(text: str) -> bool:
    """True if the text reads as "not leaking (anymore)"."""
    return bool(_ACTIVE_LEAK_NO_RE.search(text))


def parse_yesno(text: str) -> bool | None:
    """Best-effort yes/no parse for a direct yes/no question's answer."""
    if _YES_RE.match(text):
        return True
    if _NO_RE.match(text):
        return False
    return None


def extract_is_multiple(text: str) -> bool | None:
    """True/False/None for "one property or multiple?"-shaped questions."""
    digits = re.search(r"\b(\d+)\b", text)
    if digits:
        return int(digits.group(1)) > 1
    for word, count in _NUMBER_WORDS.items():
        if re.search(rf"\b{word}\b", text, re.I):
            return count > 1
    if _MULTIPLE_KEYWORD_RE.search(text):
        return True
    if _SINGLE_KEYWORD_RE.search(text):
        return False
    return None

_ADDRESS_HINT_RE = re.compile(
    r"\d{1,6}\s+\w+.*\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|"
    r"way|crescent|cres|court|ct|lane|ln|row|place|pl|terrace|ter|close|"
    r"point|trail|loop|square|sq|park|gate|bend|heights|hts|grove)\b",
    re.I,
)

_GREETING_RE = re.compile(
    r"^\s*(hi|hello|hey|yo|good (morning|afternoon|evening)|howdy)[\s!.,]*$", re.I
)

_LOW_ENGAGEMENT_RE = re.compile(
    r"^\s*(ok|okay|k|idk|i (don'?t|dont) know|not sure|maybe|hmm+|meh|"
    r"whatever|fine|sure)\.?\s*$",
    re.I,
)

_REFUSAL_TO_EXPLAIN_RE = re.compile(
    r"^\s*(i (don'?t|dont) know|no reason|just because|i don'?t (want|wanna) "
    r"to say|nothing (specific|really)|can'?t say|not (sure|telling)|"
    r"just need time|i just need (some )?time)\.?\s*$",
    re.I,
)


@dataclass
class Classification:
    intent: str
    tier_key: str | None = None
    is_leaking: bool | None = None
    is_multiple: bool | None = None
    role: Role | None = None
    address_like: str | None = None
    low_engagement: bool = False
    refuses_to_explain: bool = False
    is_greeting: bool = False
    extra_intents: list[str] = field(default_factory=list)


def classify(text: str) -> Classification:
    text = text.strip()
    extra: list[str] = []

    tier_key = None
    for key, pattern in _TIER_PATTERNS.items():
        if pattern.search(text):
            tier_key = key
            break

    is_leaking: bool | None = None
    if _LEAK_RE.search(text) and _ACTIVE_LEAK_NO_RE.search(text):
        # e.g. "not leaking anymore" -- negation wins over the bare keyword.
        is_leaking = False
    elif _LEAK_RE.search(text):
        is_leaking = True

    is_multiple = extract_is_multiple(text)

    role: Role | None = None
    if _ROLE_OWNER_RE.search(text):
        role = Role.OWNER
    elif _ROLE_MANAGER_RE.search(text):
        role = Role.PROPERTY_MANAGER

    address_like = text if _ADDRESS_HINT_RE.search(text) else None

    low_engagement = bool(_LOW_ENGAGEMENT_RE.match(text))
    refuses_to_explain = bool(_REFUSAL_TO_EXPLAIN_RE.match(text)) or bool(
        _THINK_ABOUT_IT_RE.search(text)
    )

    # Priority order matters: repair-cost is a more specific case of both
    # "pricing" and "leak"-adjacent language, so it's checked first.
    if _REPAIR_COST_RE.search(text):
        intent = "repair_cost_question"
    elif _EXPERIENCE_RE.search(text):
        intent = "experience_question"
    elif _CUSTOM_PRICING_RE.search(text):
        intent = "custom_pricing_request"
    elif _CALL_BACK_RE.search(text):
        intent = "call_back"
    elif _THINK_ABOUT_IT_RE.search(text):
        intent = "think_about_it"
    elif tier_key is not None:
        intent = "tier_question"
    elif _PRICING_RE.search(text):
        intent = "pricing_question"
    elif is_leaking:
        intent = "leak_report"
    elif _BOOKING_AFFIRM_RE.match(text):
        intent = "booking_affirm"
    elif low_engagement:
        intent = "low_engagement"
    else:
        intent = "general"

    if is_leaking and intent != "leak_report":
        extra.append("leak_report")

    return Classification(
        intent=intent,
        tier_key=tier_key,
        is_leaking=is_leaking,
        is_multiple=is_multiple,
        role=role,
        address_like=address_like,
        low_engagement=low_engagement,
        refuses_to_explain=refuses_to_explain,
        is_greeting=bool(_GREETING_RE.match(text)),
        extra_intents=extra,
    )
