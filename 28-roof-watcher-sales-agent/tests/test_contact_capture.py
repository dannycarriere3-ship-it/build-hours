"""After booking (or a hand-off to Danny) the agent collects who to call
back, and gives Danny's number so the customer can reach him."""

from roof_watcher.config import COMPANY_PHONE, CONTACT_CLARIFICATION, CONTACT_QUESTION
from roof_watcher.nlu import extract_contact_name, extract_phone


def _book(agent):
    agent.send("My roof is leaking.")
    agent.send("Back corner, actively dripping.")
    return agent.send("456 Industrial Ave, Edmonton")


def test_booking_asks_who_to_call(agent):
    reply = _book(agent)
    assert reply.endswith(CONTACT_QUESTION)
    assert agent.state.qualification.awaiting_contact is True


def test_contact_reply_is_recorded_and_danny_number_given(agent):
    _book(agent)
    reply = agent.send("Mike Brown, 780-555-0100")
    q = agent.state.qualification
    assert q.contact_phone == "780-555-0100"
    assert q.contact_name == "Mike Brown"
    assert q.awaiting_contact is False
    assert "780-555-0100" in reply
    assert COMPANY_PHONE in reply
    contact_events = [e for e in agent.events if e["kind"] == "contact"]
    assert len(contact_events) == 1
    assert contact_events[0]["reference"] == agent.state.booking.request_reference


def test_missing_number_is_reasked_once_then_dropped(agent):
    _book(agent)
    assert agent.send("Just call the office") == CONTACT_CLARIFICATION
    reply = agent.send("I'd rather not")
    assert agent.state.qualification.awaiting_contact is False
    assert "already booked" in reply.lower()
    assert COMPANY_PHONE in reply


def test_number_volunteered_early_is_not_asked_again(agent):
    agent.send("My roof is leaking, call me at 780 555 0199.")
    agent.send("Back corner, actively dripping.")
    reply = agent.send("456 Industrial Ave, Edmonton")
    assert CONTACT_QUESTION not in reply
    assert "780-555-0199" in reply
    assert COMPANY_PHONE in reply
    booking = [e for e in agent.events if e["kind"] == "inspection_request"][0]
    assert booking["contact_phone"] == "780-555-0199"
    assert booking["qualification"]["is_leaking"] is True


def test_escalation_asks_for_number_and_gives_dannys(agent):
    reply = agent.send("Can you do a payment plan?")
    assert "What's the best number for him to reach you?" in reply
    assert COMPANY_PHONE in reply
    reply2 = agent.send("Sam, (587) 555-0123")
    assert "587-555-0123" in reply2
    assert "Danny will call you" in reply2
    assert agent.state.qualification.contact_phone == "587-555-0123"
    escalation = [e for e in agent.events if e["kind"] == "escalation"][0]
    assert escalation["transcript"][0] == "customer: Can you do a payment plan?"


def test_phone_and_name_extraction():
    assert extract_phone("+1 780.405.4440") == "780-405-4440"
    assert extract_phone("7804054440") == "780-405-4440"
    assert extract_phone("10234 104 Avenue NW") is None
    assert extract_contact_name("my name is jane doe, 780-555-0100") == "Jane Doe"
    assert extract_contact_name("780-555-0100") is None
