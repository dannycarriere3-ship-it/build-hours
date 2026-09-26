"""Regression tests for the second round of PR #2 review findings.

One test per bug, each reproducing the exact repro from the review before
asserting the fixed behavior.
"""

from roof_watcher.config import ADDRESS_CLARIFICATION


# --- Bug 1: "yes" hijacked mid-qualification answers ----------------------
def test_yes_answers_pending_is_leaking_question_instead_of_confirming_booking(agent):
    agent.send("Hi there")
    agent.send("Some cracking near the vents.")

    reply = agent.send("yes")

    # "yes" must be consumed as the answer to "Is it leaking right now?",
    # not treated as a booking confirmation that skips straight to the
    # address ask.
    assert agent.state.qualification.is_leaking is True
    assert "where" in reply.lower()
    assert "actively leaking" in reply.lower()
    assert agent.state.booking.requested is False
    assert agent.state.qualification.awaiting_address is False


def test_yes_answers_pending_leak_details_question_and_clears_the_flag(agent):
    agent.send("My roof is leaking!")

    reply = agent.send("yes")

    # Must be consumed as (an admittedly terse) answer to the leak-details
    # question, and that question's awaiting flag must be cleared so the
    # NEXT reply is correctly treated as the address, not more leak detail.
    assert agent.state.qualification.awaiting_leak_details is False
    assert agent.state.qualification.leak_location == "yes"
    assert "address" in reply.lower()

    reply2 = agent.send("456 Industrial Ave, Edmonton")
    assert agent.state.booking.requested is True
    assert agent.state.booking.address == "456 Industrial Ave, Edmonton"
    assert reply2 != ""


# --- Bug 2: garbage addresses get booked -----------------------------------
def test_unparseable_address_reply_reasks_instead_of_booking_garbage(agent):
    agent.send("My roof is leaking.")
    agent.send("Back corner, actively dripping.")

    reply = agent.send("I don't know the address, call me at 780-555-0100")

    assert agent.state.qualification.address is None
    assert agent.state.booking.requested is False
    assert agent.state.qualification.awaiting_address is True
    assert reply == ADDRESS_CLARIFICATION
    assert agent.events == []  # no inspection_request was logged

    # The retry must still work once a real address is given.
    reply2 = agent.send("100 Roofline Rd, Edmonton")
    assert agent.state.booking.requested is True
    assert agent.state.booking.address == "100 Roofline Rd, Edmonton"
    assert reply2 != ""


# --- Bug 3: escalation rule 2 skipped during objection follow-up ----------
def test_custom_pricing_ask_escalates_even_during_objection_followup(agent):
    agent.send("I need to think about it.")

    reply = agent.send("Can you do a payment plan?")

    assert agent.state.escalation.escalated is True
    assert agent.state.escalation.triggered_rule == 2
    assert "780-405-4440" in reply


# --- Bug 4: address can't be corrected after booking -----------------------
def test_address_correction_after_booking(agent):
    agent.send("My roof is leaking.")
    agent.send("Back corner, actively dripping.")
    agent.send("456 Industrial Ave, Edmonton")
    assert agent.state.booking.requested is True
    original_reference = agent.state.booking.request_reference

    # Round 3's finding 2 requires an explicit correction cue (see
    # test_review_round3_fixes.py) -- a bare new-looking address alone is
    # no longer enough, so this message says "actually" to signal intent.
    reply = agent.send("Actually the address is 789 Oak Ave, Edmonton")

    assert agent.state.booking.address != "456 Industrial Ave, Edmonton"
    assert agent.state.booking.address == agent.state.qualification.address
    # Same booking, just corrected -- not a second inspection request.
    assert agent.state.booking.request_reference == original_reference
    assert original_reference in reply

    booking_events = [e for e in agent.events if e["kind"] == "inspection_request"]
    correction_events = [e for e in agent.events if e["kind"] == "address_correction"]
    assert len(booking_events) == 1
    assert len(correction_events) == 1
    assert correction_events[0]["old_address"] == "456 Industrial Ave, Edmonton"
    assert correction_events[0]["new_address"] == agent.state.booking.address
    assert correction_events[0]["reference"] == original_reference
