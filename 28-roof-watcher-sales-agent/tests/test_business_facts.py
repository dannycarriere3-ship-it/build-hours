"""The agent must state Carriere Flat Roofing's real, approved facts:
name, phone, $500 inspection (never free), separate infrared price, and
all four roof systems."""

from pathlib import Path

import pytest

from roof_watcher.config import (
    COMPANY_NAME,
    COMPANY_PHONE,
    FREE_INSPECTION_ANSWER,
    INSPECTION_PRICE_ANSWER,
    ROOF_SYSTEMS_ANSWER,
)

PACKAGE_DIR = Path(__file__).resolve().parent.parent / "roof_watcher"


def test_company_facts():
    assert COMPANY_NAME == "Carriere Flat Roofing"
    assert COMPANY_PHONE == "780-405-4440"


def test_no_stale_facts_left_in_source():
    source = " ".join(p.read_text() for p in PACKAGE_DIR.glob("*.py"))
    for stale in ("587-557-7138", "Carriere Roofing", "$99", "$249", "$599", "_usd"):
        assert stale not in source, stale


@pytest.mark.parametrize(
    "question",
    [
        "How much is an inspection?",
        "What does an inspection cost?",
        "What do you charge for a roof inspection?",
    ],
)
def test_inspection_price_question_gets_500(agent, question):
    reply = agent.send(question)
    assert reply.startswith(INSPECTION_PRICE_ANSWER)
    assert "$500 per roof" in reply
    assert "$700–$1,000" in reply
    assert reply.count("?") == 1


@pytest.mark.parametrize(
    "question",
    ["Is the inspection free?", "Do you do free estimates?", "Any free inspections?"],
)
def test_free_inspection_question_states_the_price(agent, question):
    reply = agent.send(question)
    assert reply.startswith(FREE_INSPECTION_ANSWER)
    assert "$500" in reply
    assert "free" not in reply.lower()


@pytest.mark.parametrize(
    "question",
    ["Do you do TPO roofs?", "Can you work on EPDM?", "What kinds of roofs do you do?"],
)
def test_roof_systems_question_names_all_four(agent, question):
    reply = agent.send(question)
    assert reply.startswith(ROOF_SYSTEMS_ANSWER)
    for system in ("SBS", "TPO", "EPDM", "BUR"):
        assert system in reply


def test_roof_system_mentioned_in_a_description_is_not_a_question(agent):
    agent.send("Hi")
    reply = agent.send("It's an old SBS roof with blisters.")
    assert ROOF_SYSTEMS_ANSWER not in reply
    assert agent.state.qualification.issue_description == "It's an old SBS roof with blisters."


def test_pricing_answer_is_monthly_cad_plus_gst_with_inspection(agent):
    reply = agent.send("What do you charge?")
    for piece in ("$167/month", "$333/month", "$542/month", "plus GST", "$500 per roof"):
        assert piece in reply
    assert "free" not in reply.lower()
    assert reply.count("?") == 1


def test_experience_answer_names_all_four_systems(agent):
    reply = agent.send("How long have you been in business?")
    for piece in ("20 years", "SBS", "TPO", "EPDM", "BUR", "Edmonton", COMPANY_NAME):
        assert piece in reply
