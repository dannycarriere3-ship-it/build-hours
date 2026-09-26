from roof_watcher.config import EXPERIENCE_ANSWER, PRICING_QNA_ANSWER


def test_pricing_question_gets_exact_scripted_answer(agent):
    reply = agent.send("What do you charge?")
    assert reply == PRICING_QNA_ANSWER


def test_pricing_question_variants_all_match(agent):
    for phrasing in ["How much does this cost?", "What are your rates?", "pricing?"]:
        a = agent.__class__()
        assert a.send(phrasing) == PRICING_QNA_ANSWER


def test_pricing_answer_never_appears_without_being_asked(agent):
    agent.send("My roof has some ponding water near the drains.")
    assert PRICING_QNA_ANSWER not in agent.state.history[-1].text


def test_experience_question_uses_real_business_facts(agent):
    reply = agent.send("How long have you been in business?")
    assert reply.startswith(EXPERIENCE_ANSWER)
    assert "20 years" in reply
    assert "Edmonton" in reply
