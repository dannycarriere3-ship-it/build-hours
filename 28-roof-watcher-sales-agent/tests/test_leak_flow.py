from roof_watcher.models import Stage


def test_active_leak_skips_property_count_and_role(agent):
    r1 = agent.send("My roof is leaking badly.")
    assert "where" in r1.lower()
    assert "actively leaking" in r1.lower()
    assert agent.state.qualification.is_leaking is True

    r2 = agent.send("Front-left corner, near the HVAC unit, still dripping right now.")
    assert agent.state.qualification.leak_location == (
        "Front-left corner, near the HVAC unit, still dripping right now."
    )
    # Urgent path: goes straight to the booking CTA, never asks property
    # count or owner/manager.
    assert "Let's get the inspection booked" in r2
    assert agent.state.qualification.is_multiple_properties is None
    assert agent.state.qualification.role is None

    r3 = agent.send("456 Industrial Ave, Edmonton")
    assert agent.state.stage == Stage.BOOKED
    assert agent.state.booking.address == "456 Industrial Ave, Edmonton"


def test_leak_never_gets_a_diagnosis_or_price(agent):
    r1 = agent.send("Water is coming through the ceiling right now, it's an emergency.")
    lowered = r1.lower()
    for banned in ("$", "quote", "diagnos", "it's probably", "sounds like"):
        assert banned not in lowered


def test_leak_reported_mid_conversation_after_pricing_question(agent):
    agent.send("What do you charge?")
    r2 = agent.send("Actually it's leaking right now, one property.")
    assert agent.state.qualification.is_leaking is True
    assert "where" in r2.lower()
