"""Booking must be logged as a SIMULATED request, never a fake confirmed
appointment (no invented date/time, no claim of a real calendar hold)."""

import re

from roof_watcher.models import Stage


def _get_to_booking(agent) -> str:
    agent.send("What do you charge?")
    agent.send("Just one property.")
    agent.send("No leaks, just some wear.")
    agent.send("I'm the owner.")
    return agent.send("42 Flatline Blvd, Edmonton")


def test_booking_reply_never_claims_a_scheduled_time(agent):
    reply = _get_to_booking(agent)
    lowered = reply.lower()
    time_words = [
        "am",
        "pm",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "o'clock",
        ":00",
    ]
    for word in time_words:
        assert word not in lowered, f"unexpected fake schedule claim: {word!r}"
    assert "confirm timing" in lowered


def test_booking_produces_a_reference_and_logs_a_simulated_event(agent):
    _get_to_booking(agent)
    assert agent.state.booking.requested is True
    assert re.match(r"^RW-[0-9A-F]{8}$", agent.state.booking.request_reference)
    assert agent.state.stage == Stage.BOOKED

    booking_events = [e for e in agent.events if e["kind"] == "inspection_request"]
    assert len(booking_events) == 1
    assert booking_events[0]["status"] == "pending_human_confirmation"
    assert booking_events[0]["reference"] == agent.state.booking.request_reference


def test_second_message_after_booking_does_not_rebook(agent):
    _get_to_booking(agent)
    first_ref = agent.state.booking.request_reference
    agent.send("Thanks!")
    booking_events = [e for e in agent.events if e["kind"] == "inspection_request"]
    assert len(booking_events) == 1
    assert agent.state.booking.request_reference == first_ref


def test_escalation_never_fakes_that_danny_was_actually_reached(agent):
    reply = agent.send("I want a custom price.")
    lowered = reply.lower()
    assert "danny said" not in lowered
    assert "danny confirmed" not in lowered
    # Honest framing: he'll follow up / here's his number, not "you're set".
    assert "he'll" in lowered or "reach him" in lowered
