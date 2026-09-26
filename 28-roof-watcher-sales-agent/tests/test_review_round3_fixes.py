"""Regression tests for the third round of Gitar Bot review findings.

One test per finding, each reproducing the exact repro from the review
before asserting the fixed behavior.
"""

from roof_watcher.models import Stage


# --- Finding 1: stale awaiting_booking_confirm -----------------------------
def test_non_yes_answer_after_repair_cost_question_clears_stale_flag(agent):
    agent.send("How much will the repair cost?")

    # A non-yes answer to the "Would you like to book the inspection?"
    # follow-up must consume/clear the flag, not leave it stuck true.
    agent.send("Some cracking near the vents.")
    agent.send("There's some cracking near the vents, nothing urgent.")

    # Now the agent has asked an UNRELATED yes/no question ("Is it leaking
    # right now?"). A "yes" here must answer THAT question, not be
    # hijacked into the booking-confirm/address-ask shortcut.
    reply = agent.send("yes")

    assert agent.state.qualification.is_leaking is True
    assert "where" in reply.lower()
    assert "actively leaking" in reply.lower()
    assert agent.state.booking.requested is False
    assert agent.state.qualification.awaiting_address is False
    assert agent.state.qualification.awaiting_booking_confirm is False


# --- Finding 2: post-booking correction too loose --------------------------
def test_address_shaped_chatter_after_booking_does_not_overwrite_address(agent):
    agent.send("My roof is leaking.")
    agent.send("Back corner, actively dripping.")
    agent.send("456 Industrial Ave, Edmonton")
    assert agent.state.booking.requested is True
    original_address = agent.state.booking.address
    original_reference = agent.state.booking.request_reference

    # This matches _ADDRESS_HINT_RE (a number + word + "gate") but has no
    # correction cue -- it's small talk about a callback time, not a
    # correction, and must not touch the booking.
    reply = agent.send("Can you come around 2 pm? I'll be at the front gate")

    assert agent.state.booking.address == original_address
    assert agent.state.booking.request_reference == original_reference
    assert agent.state.qualification.address == original_address
    assert "already booked" in reply.lower()

    correction_events = [e for e in agent.events if e["kind"] == "address_correction"]
    assert correction_events == []


def test_explicit_correction_cue_still_corrects_the_address(agent):
    agent.send("My roof is leaking.")
    agent.send("Back corner, actively dripping.")
    agent.send("123 Main Street, Edmonton")
    assert agent.state.booking.requested is True
    original_address = agent.state.booking.address
    original_reference = agent.state.booking.request_reference

    reply = agent.send("Actually the address is 456 Oak Ave")

    assert agent.state.booking.address != original_address
    assert agent.state.booking.address is not None
    assert agent.state.qualification.address == agent.state.booking.address
    # Same booking, corrected -- not a new inspection request.
    assert agent.state.booking.request_reference == original_reference
    assert original_reference in reply
    assert agent.state.stage == Stage.BOOKED

    correction_events = [e for e in agent.events if e["kind"] == "address_correction"]
    assert len(correction_events) == 1
    assert correction_events[0]["old_address"] == original_address
    assert correction_events[0]["new_address"] == agent.state.booking.address
