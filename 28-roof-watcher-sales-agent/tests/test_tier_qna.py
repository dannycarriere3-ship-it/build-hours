import pytest

from roof_watcher.config import PLANS


@pytest.mark.parametrize(
    "phrasing,plan_key",
    [
        ("What's included in the Essential plan?", "essential"),
        ("Tell me about the Professional plan.", "professional"),
        ("What do I get with Premium Platinum?", "premium_platinum"),
        ("What do I get with Platinum?", "premium_platinum"),
    ],
)
def test_plan_question_quotes_real_monthly_price(agent, phrasing, plan_key):
    reply = agent.send(phrasing)
    plan = PLANS[plan_key]
    assert plan.name in reply
    assert f"${plan.monthly_price_cad}/month plus GST" in reply


def test_plan_answer_is_followed_by_one_qualification_question(agent):
    reply = agent.send("What's included in Platinum?")
    assert reply.count("?") == 1
    assert reply.strip().endswith("?")


def test_no_plan_price_is_invented(agent):
    reply = agent.send("How much is the Professional plan?")
    assert "$333/month" in reply
    for wrong in ("$167", "$542", "$99", "$249", "$599", "USD"):
        assert wrong not in reply


def test_plans_match_the_approved_annual_prices():
    assert {k: (p.annual_price_cad, p.monthly_price_cad) for k, p in PLANS.items()} == {
        "essential": (2000, 167),
        "professional": (4000, 333),
        "premium_platinum": (6500, 542),
    }


@pytest.mark.parametrize(
    "text",
    ["It's essential we get this fixed.", "We want a professional crew on it."],
)
def test_ordinary_words_are_not_plan_questions(agent, text):
    reply = agent.send(text)
    assert "/month" not in reply
