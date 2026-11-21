"""PipedriveSink, tested against a fake transport (no network)."""

from roof_watcher.agent import RoofWatcherAgent
from roof_watcher.pipedrive import PipedriveSink


class FakePipedrive:
    def __init__(
        self,
        fail_on: str | None = None,
        stages: list[dict] | None = None,
        existing_phones: dict[str, int] | None = None,
    ):
        self.calls: list[tuple[str, str, dict | None]] = []
        self.headers: list[dict] = []
        self.urls: list[str] = []
        self.fail_on = fail_on
        self.stages = stages if stages is not None else []
        self.existing_phones = existing_phones or {}
        self._next_id = 100

    def __call__(self, method, url, body, headers):
        self.urls.append(url)
        self.headers.append(headers)
        path = url.split("/api/v1/")[1]
        bare = path.split("?")[0]
        self.calls.append((method, bare, body))
        if self.fail_on and bare.startswith(self.fail_on):
            return {"success": False, "error": "boom"}
        if method == "GET" and bare == "stages":
            return {"success": True, "data": self.stages}
        if method == "GET" and bare == "persons/search":
            term = path.split("term=")[1].split("&")[0].replace("%2B", "+")
            hit = self.existing_phones.get(term)
            items = [{"item": {"id": hit}}] if hit else []
            return {"success": True, "data": {"items": items}}
        self._next_id += 1
        return {"success": True, "data": {"id": self._next_id}}

    def paths(self):
        return [(m, p) for m, p, _ in self.calls]


def _sink(fake, stage_id=4):
    return PipedriveSink(api_token="t", domain="example", stage_id=stage_id, transport=fake)


def _book(agent, contact="Mike Brown, 780-555-0100"):
    agent.send("My roof is leaking.")
    agent.send("Back corner, actively dripping.")
    agent.send("456 Industrial Ave, Edmonton")
    agent.send(contact)


def test_booking_creates_deal_in_inspection_booked_stage_then_links_contact():
    fake = FakePipedrive()
    agent = RoofWatcherAgent(sink=_sink(fake))
    _book(agent)

    assert fake.paths() == [
        ("POST", "deals"),
        ("POST", "notes"),
        ("GET", "persons/search"),
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
    assert fake.calls[3][2]["phone"] == [{"value": "780-555-0100", "primary": True}]
    assert fake.calls[4][2] == {"person_id": 103}


def test_token_goes_in_header_never_in_url():
    fake = FakePipedrive()
    agent = RoofWatcherAgent(sink=_sink(fake))
    _book(agent)
    assert all("api_token" not in u and "=t&" not in u for u in fake.urls)
    assert all(h == {"x-api-token": "t"} for h in fake.headers)


def test_existing_person_is_reused_not_duplicated():
    fake = FakePipedrive(existing_phones={"780-555-0100": 42})
    sink = _sink(fake)
    agent = RoofWatcherAgent(sink=sink)
    _book(agent)
    assert ("POST", "persons") not in fake.paths()
    assert fake.calls[-1] == ("PUT", "deals/101", {"person_id": 42})


def test_stage_found_by_name_when_no_id_configured():
    fake = FakePipedrive(
        stages=[
            {"id": 1, "name": "New Lead"},
            {"id": 2, "name": "Qualification"},
            {"id": 9, "name": "Inspection Booked"},
        ]
    )
    sink = _sink(fake, stage_id=None)
    agent = RoofWatcherAgent(sink=sink)
    _book(agent)
    _book(RoofWatcherAgent(sink=sink))
    assert fake.paths().count(("GET", "stages")) == 1  # looked up once
    deals = [b for m, p, b in fake.calls if (m, p) == ("POST", "deals")]
    assert len(deals) == 2 and all(d["stage_id"] == 9 for d in deals)
    assert sink.errors == []


def test_missing_stage_name_falls_back_and_says_so():
    fake = FakePipedrive(stages=[{"id": 1, "name": "New Lead"}])
    sink = _sink(fake, stage_id=None)
    _book(RoofWatcherAgent(sink=sink))
    deal = next(b for m, p, b in fake.calls if (m, p) == ("POST", "deals"))
    assert "stage_id" not in deal
    assert any("no stage named" in e for e in sink.errors)


def test_escalation_creates_call_activity_with_transcript():
    fake = FakePipedrive()
    agent = RoofWatcherAgent(sink=_sink(fake))
    agent.send("Can you do a payment plan?")
    method, path, body = fake.calls[0]
    assert (method, path) == ("POST", "activities")
    assert body["type"] == "call"
    assert "customer: Can you do a payment plan?" in body["note"]


def test_number_given_after_escalation_lands_on_the_activity():
    fake = FakePipedrive()
    sink = _sink(fake)
    agent = RoofWatcherAgent(sink=sink)
    agent.send("Can you do a payment plan?")
    agent.send("Mike Brown, 780-555-0100")
    assert any(e["kind"] == "contact" for e in sink.events)
    assert fake.calls[-1] == ("PUT", "activities/101", {"person_id": 102})


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
