"""PipedriveSink, tested against a fake transport (no network)."""

from roof_watcher.agent import RoofWatcherAgent
from roof_watcher.pipedrive import PipedriveSink


class FakePipedrive:
    def __init__(self, fail_on: str | None = None):
        self.calls: list[tuple[str, str, dict]] = []
        self.fail_on = fail_on
        self._next_id = 100

    def __call__(self, method, url, body):
        path = url.split("/api/v1/")[1].split("?")[0]
        self.calls.append((method, path, body))
        if self.fail_on and path.startswith(self.fail_on):
            return {"success": False, "error": "boom"}
        self._next_id += 1
        return {"success": True, "data": {"id": self._next_id}}

    def paths(self):
        return [(m, p) for m, p, _ in self.calls]


def _sink(fake, stage_id=4):
    return PipedriveSink(api_token="t", domain="example", stage_id=stage_id, transport=fake)


def test_booking_creates_deal_in_inspection_booked_stage_then_links_contact():
    fake = FakePipedrive()
    agent = RoofWatcherAgent(sink=_sink(fake))
    agent.send("My roof is leaking.")
    agent.send("Back corner, actively dripping.")
    agent.send("456 Industrial Ave, Edmonton")
    agent.send("Mike Brown, 780-555-0100")

    assert fake.paths() == [
        ("POST", "deals"),
        ("POST", "notes"),
        ("POST", "persons"),
        ("PUT", "deals/101"),
    ]
    deal = fake.calls[0][2]
    assert deal == {
        "title": "Inspection — 456 Industrial Ave, Edmonton",
        "value": 500,
        "currency": "CAD",
        "stage_id": 4,
    }
    assert "Timing NOT confirmed" in fake.calls[1][2]["content"]
    assert fake.calls[2][2]["phone"] == [{"value": "780-555-0100", "primary": True}]
    assert fake.calls[3][2] == {"person_id": 103}


def test_escalation_creates_call_activity_with_transcript():
    fake = FakePipedrive()
    agent = RoofWatcherAgent(sink=_sink(fake))
    agent.send("Can you do a payment plan?")
    method, path, body = fake.calls[0]
    assert (method, path) == ("POST", "activities")
    assert body["type"] == "call"
    assert "customer: Can you do a payment plan?" in body["note"]


def test_api_failure_never_breaks_the_conversation():
    fake = FakePipedrive(fail_on="deals")
    sink = _sink(fake)
    agent = RoofWatcherAgent(sink=sink)
    agent.send("My roof is leaking.")
    agent.send("Back corner, actively dripping.")
    reply = agent.send("456 Industrial Ave, Edmonton")
    assert "inspection request logged" in reply
    assert sink.errors and "boom" in sink.errors[0]
    assert agent.events[0]["kind"] == "inspection_request"


def test_off_unless_token_and_domain_set(monkeypatch):
    monkeypatch.delenv("PIPEDRIVE_API_TOKEN", raising=False)
    monkeypatch.delenv("PIPEDRIVE_DOMAIN", raising=False)
    assert PipedriveSink.from_env() is None
    monkeypatch.setenv("PIPEDRIVE_API_TOKEN", "t")
    assert PipedriveSink.from_env() is None
    monkeypatch.setenv("PIPEDRIVE_DOMAIN", "example")
    monkeypatch.setenv("PIPEDRIVE_STAGE_ID_INSPECTION_BOOKED", "7")
    sink = PipedriveSink.from_env()
    assert sink is not None and sink.stage_id == 7
