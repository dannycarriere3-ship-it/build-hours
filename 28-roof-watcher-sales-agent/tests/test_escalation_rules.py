"""Escalation must fire ONLY under the four named rules, never otherwise."""

from roof_watcher.config import COMPANY_PHONE


def test_rule_1_think_it_over_without_explanation(agent):
    agent.send("I need to think about it.")
    agent.send("I don't know.")
    assert agent.state.escalation.triggered_rule == 1
    assert len(agent.events) == 1
    assert agent.events[0]["kind"] == "escalation"
    assert agent.events[0]["rule"] == 1
    assert agent.events[0]["callback_number"] == COMPANY_PHONE


def test_rule_2_custom_pricing_or_payment_plan(agent):
    reply = agent.send("Can you do a custom price or a payment plan?")
    assert agent.state.escalation.triggered_rule == 2
    assert agent.state.escalation.escalated is True
    assert COMPANY_PHONE in reply


def test_rule_3_repeated_call_you_back(agent):
    agent.send("I'll call you back.")
    agent.send("I'll call you back again later.")
    assert agent.state.escalation.triggered_rule == 3


def test_rule_4_customer_slipping_away(agent):
    agent.send("Hi.")
    agent.send("hmm")
    agent.send("meh")
    reply = agent.send("whatever")
    assert agent.state.escalation.triggered_rule == 4
    assert agent.state.escalation.escalated is True
    assert COMPANY_PHONE in reply


def test_normal_pricing_question_never_escalates(agent):
    agent.send("What do you charge?")
    agent.send("3 properties")
    agent.send("I'm the owner")
    agent.send("789 Commerce Way, Edmonton")
    assert agent.state.escalation.escalated is False
    assert agent.events == [] or all(e["kind"] != "escalation" for e in agent.events)


def test_normal_leak_report_never_escalates(agent):
    agent.send("My roof is leaking.")
    agent.send("Back corner, actively dripping.")
    agent.send("100 Roofline Rd, Edmonton")
    assert agent.state.escalation.escalated is False


def test_repair_cost_question_never_escalates(agent):
    agent.send("How much will the repair cost?")
    assert agent.state.escalation.escalated is False


def test_single_think_about_it_does_not_escalate_yet(agent):
    agent.send("I need to think about it.")
    assert agent.state.escalation.escalated is False


def test_single_call_back_does_not_escalate_yet(agent):
    agent.send("I'll call you back.")
    assert agent.state.escalation.escalated is False


def test_two_low_engagement_replies_alone_do_not_escalate(agent):
    agent.send("Hi.")
    agent.send("hmm")
    reply = agent.send("meh")
    assert agent.state.escalation.escalated is False


# --- Regression test for Gitar Bot finding 3 (refined by review round 2,
# bug 1) ---------------------------------------------------------------
# "ok"/"sure"/"fine" match both the low-engagement wordlist and the
# booking-affirmation wordlist. Right after the agent asks "Would you like
# to book the inspection?" (the repair-cost follow-up), such a reply is
# unambiguously an agreement to book and must never be miscounted as
# disengagement or trigger the rule-4 escalation. (Round 2's bug 1 fix
# narrowed this to ONLY that specific pending question -- "ok"/"sure" with
# no such question pending correctly falls through to low-engagement
# counting instead, since it could just as easily be answering some other
# pending qualification question; see test_review_round2_fixes.py.)
def test_booking_confirm_after_repair_cost_question_does_not_escalate(agent):
    agent.send("How much will the repair cost?")

    reply = agent.send("ok")

    assert agent.state.escalation.escalated is False
    assert agent.state.escalation.low_engagement_streak == 0
    assert "address" in reply.lower() or "building" in reply.lower()
