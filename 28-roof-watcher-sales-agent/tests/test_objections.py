from roof_watcher.config import CALL_BACK_PROMPT, COMPANY_PHONE, THINK_ABOUT_IT_PROMPT


def test_think_about_it_prompts_for_the_specific_concern(agent):
    reply = agent.send("I need to think about it.")
    assert reply == THINK_ABOUT_IT_PROMPT
    assert agent.state.escalation.escalated is False


def test_think_about_it_then_explaining_continues_normally(agent):
    agent.send("I need to think about it.")
    reply = agent.send("I'm not sure the monitoring is worth it for one building.")
    assert agent.state.escalation.escalated is False
    # Continues toward booking rather than stonewalling.
    assert reply.strip() != ""


def test_think_about_it_then_refusing_to_explain_escalates(agent):
    agent.send("I need to think about it.")
    reply = agent.send("I don't know.")
    assert agent.state.escalation.escalated is True
    assert agent.state.escalation.triggered_rule == 1
    assert COMPANY_PHONE in reply


def test_call_back_prompts_for_blocker_first(agent):
    reply = agent.send("I'll call you back.")
    assert reply == CALL_BACK_PROMPT
    assert agent.state.escalation.escalated is False


def test_call_back_repeated_escalates(agent):
    agent.send("I'll call you back.")
    reply = agent.send("I'll call you back.")
    assert agent.state.escalation.escalated is True
    assert agent.state.escalation.triggered_rule == 3


def test_call_back_then_naming_a_real_concern_continues_normally(agent):
    agent.send("I'll call you back.")
    reply = agent.send("I just want to check the price with my partner first.")
    assert agent.state.escalation.escalated is False
    assert reply.strip() != ""


def test_repair_cost_never_quoted_before_inspection(agent):
    reply = agent.send("How much will the repair cost?")
    assert "inspect it first" in reply
    assert "$" not in reply
    assert "Would you like to book the inspection?" in reply


def test_repair_cost_then_yes_moves_to_booking(agent):
    agent.send("How much will the repair cost?")
    reply = agent.send("Yes, let's book it.")
    assert "roof" in reply.lower() or "address" in reply.lower() or "?" in reply
