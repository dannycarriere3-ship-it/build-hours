from roof_watcher.config import PRICING_QNA_ANSWER, PRIMARY_CTA
from roof_watcher.models import Role, Stage


def test_general_inquiry_walks_all_five_questions_in_order(agent):
    r1 = agent.send("Hi, I'd like to know more about your service.")
    assert "What's happening with the roof?" in r1

    r2 = agent.send("We've got some ponding water and cracking near the drains.")
    assert "Is it leaking right now?" in r2
    assert agent.state.qualification.issue_description == (
        "We've got some ponding water and cracking near the drains."
    )

    r3 = agent.send("No, not right now.")
    assert agent.state.qualification.is_leaking is False
    assert "one property" in r3.lower() or "multiple" in r3.lower()

    r4 = agent.send("We have 3 commercial buildings.")
    assert agent.state.qualification.is_multiple_properties is True
    assert "owner" in r4.lower() and "property manager" in r4.lower()

    r5 = agent.send("I'm the property manager.")
    assert agent.state.qualification.role == Role.PROPERTY_MANAGER
    assert r5 == PRIMARY_CTA

    r6 = agent.send("123 Main Street, Edmonton AB")
    assert agent.state.booking.requested is True
    assert agent.state.booking.address == "123 Main Street, Edmonton AB"
    assert agent.state.stage == Stage.BOOKED
    assert "Anything else?" in r6
    # Never invents a confirmed appointment time/date.
    for word in ("tomorrow", "am", "pm", "monday", "tuesday", "wednesday"):
        assert word not in r6.lower()


def test_pricing_question_short_circuits_straight_to_property_count(agent):
    r1 = agent.send("What do you charge?")
    assert r1 == PRICING_QNA_ANSWER

    # Pricing answer already asked "how many properties" -- the very next
    # unresolved field, so the agent should not re-ask what's happening
    # with the roof before following up on that.
    r2 = agent.send("Just one property.")
    assert agent.state.qualification.is_multiple_properties is False
    assert "roof" in r2.lower()  # falls back to asking what's happening


def test_agent_never_asks_two_questions_in_one_turn(agent):
    agent.send("Hi there")
    for msg in [
        "The membrane is bubbling in a few spots.",
        "No it's not leaking yet.",
        "Just the one building.",
        "I own the property.",
    ]:
        reply = agent.send(msg)
        assert reply.count("?") <= 1
