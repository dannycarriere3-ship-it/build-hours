import pytest

from roof_watcher.config import TIERS


@pytest.mark.parametrize(
    "phrasing,tier_key",
    [
        ("What's included in Roof Watcher?", "roof_watcher"),
        ("Tell me about the Watcher plan.", "watcher"),
        ("What do I get with Platinum?", "platinum"),
    ],
)
def test_tier_question_quotes_real_price_and_description(agent, phrasing, tier_key):
    reply = agent.send(phrasing)
    tier = TIERS[tier_key]
    assert tier.name in reply
    assert f"${tier.monthly_price_usd}/month" in reply
    assert tier.description in reply


def test_tier_answer_is_followed_by_one_qualification_question(agent):
    reply = agent.send("What's included in Platinum?")
    # The tier fact comes first, then exactly one qualification question —
    # never two questions stacked in the same turn.
    assert reply.count("?") == 1
    assert reply.strip().endswith("?")


def test_no_tier_price_is_invented(agent):
    reply = agent.send("What's included in Watcher?")
    assert "$249/month" in reply
    assert "$99" not in reply
    assert "$599" not in reply
