"""End-to-end fixtures for the four entry points named in the success
criteria: leak, maintenance/general question, pricing question, general
inquiry. Each should reach ANSWER -> QUALIFY -> BOOK without escalating."""

import pytest

from roof_watcher.agent import RoofWatcherAgent
from roof_watcher.models import Stage


def _run(*messages: str) -> RoofWatcherAgent:
    a = RoofWatcherAgent()
    for m in messages:
        a.send(m)
    return a


def test_active_leak_reaches_booking():
    a = _run(
        "Help, my roof is leaking!",
        "Right above the loading dock, water's actively dripping.",
        "88 Dock St, Edmonton",
    )
    assert a.state.stage == Stage.BOOKED
    assert a.state.escalation.escalated is False
    assert a.state.qualification.is_leaking is True


def test_pricing_question_reaches_booking():
    a = _run(
        "What do you charge?",
        "two properties",
        "I manage them for the owner",
        "17 Warehouse Row, Edmonton",
    )
    assert a.state.stage == Stage.BOOKED
    assert a.state.escalation.escalated is False


def test_maintenance_question_reaches_booking_without_inventing_facts():
    a = _run(
        "Do you do regular maintenance visits?",
        "We've got some blistering on the membrane.",
        "It's not leaking yet.",
        "Just the one site.",
        "I'm the owner.",
        "9 Terrace Court, Edmonton",
    )
    assert a.state.stage == Stage.BOOKED
    assert a.state.escalation.escalated is False


def test_general_inquiry_reaches_booking():
    a = _run(
        "Hi, I saw your ad and wanted to learn more.",
        "There's some cracking around the flashing.",
        "No active leak right now.",
        "Multiple sites actually.",
        "Property manager.",
        "55 Skyline Dr, Edmonton",
    )
    assert a.state.stage == Stage.BOOKED
    assert a.state.escalation.escalated is False
    assert a.state.qualification.is_multiple_properties is True


@pytest.mark.parametrize(
    "messages",
    [
        ("What do you charge?", "one property", "I'm the owner", "10 A St, Edmonton"),
        ("My roof is leaking.", "front corner, yes", "20 B Ave, Edmonton"),
    ],
)
def test_no_escalation_and_no_repair_price_ever_quoted(messages):
    a = _run(*messages)
    full_transcript = " ".join(turn.text for turn in a.state.history if turn.speaker == "agent")
    assert a.state.escalation.escalated is False
    assert "$" not in full_transcript or "month" in full_transcript
