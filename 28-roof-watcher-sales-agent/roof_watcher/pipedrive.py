"""Optional Pipedrive sink: sends booked inspections and hand-offs to the
one CRM (Pipedrive) instead of only an in-memory list.

OFF by default. It only turns on when PIPEDRIVE_API_TOKEN is set, and it
only writes to your own CRM (people, deals, notes, activities). It never
emails, texts or messages a customer.

Environment variables:
    PIPEDRIVE_API_TOKEN       required. Settings > Personal preferences > API.
    PIPEDRIVE_DOMAIN          company domain, e.g. "carriereflatroofingcom"
                              (from carriereflatroofingcom.pipedrive.com).
    PIPEDRIVE_STAGE_ID_INSPECTION_BOOKED
                              optional numeric id of the "Inspection Booked"
                              stage. If unset, the sink looks the stage up
                              by its name ("Inspection Booked") on first use,
                              so you normally don't need this.

The API token travels in the x-api-token header, never in the URL, so it
does not end up in proxy or server logs.

What it does (Pipedrive API v1):
    inspection_request -> person (if a phone/name is known; an existing
                          person with the same phone is reused, never
                          duplicated) + deal
                          "Inspection — <address>" worth CA$500 in the
                          Inspection Booked stage + a note with the
                          qualification answers.
    contact            -> person (reused if the phone already exists),
                          linked to that booking's deal, or to the
                          hand-off activity when it was an escalation.
    address_correction -> note on the deal.
    escalation         -> a "call" activity for Danny with the reason, the
                          customer's number and the full transcript.

Every event is also kept in memory (`events`), and a failed API call is
recorded in `errors` instead of crashing the conversation.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Callable

from roof_watcher.config import CURRENCY, INSPECTION_PRICE_CAD

# (method, url, json body or None, headers) -> parsed JSON response
Transport = Callable[[str, str, "dict | None", dict], dict]

INSPECTION_BOOKED_STAGE_NAME = "Inspection Booked"


def _urllib_transport(method: str, url: str, body: dict | None, headers: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Content-Type": "application/json", **headers},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:  # noqa: S310
        return json.loads(resp.read().decode())


@dataclass
class PipedriveSink:
    api_token: str
    domain: str
    stage_id: int | None = None
    transport: Transport = _urllib_transport
    events: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    # booking reference -> Pipedrive deal id
    deals: dict[str, int] = field(default_factory=dict)
    # phone -> Pipedrive person id, so one caller is never created twice
    persons: dict[str, int] = field(default_factory=dict)
    # id of the last hand-off activity, so a number given afterwards lands on it
    last_escalation_activity: int | None = None
    _stage_looked_up: bool = field(default=False, repr=False)

    @classmethod
    def from_env(cls) -> "PipedriveSink | None":
        token = os.environ.get("PIPEDRIVE_API_TOKEN")
        domain = os.environ.get("PIPEDRIVE_DOMAIN")
        if not token or not domain:
            return None
        stage = os.environ.get("PIPEDRIVE_STAGE_ID_INSPECTION_BOOKED")
        return cls(api_token=token, domain=domain, stage_id=int(stage) if stage else None)

    # ---- EventSink -----------------------------------------------------
    def record(self, kind: str, payload: dict) -> None:
        self.events.append({"kind": kind, **payload})
        handler = getattr(self, f"_on_{kind}", None)
        if handler is None:
            return
        try:
            handler(payload)
        except Exception as exc:  # never break the customer conversation
            self.errors.append(f"{kind}: {exc}")

    # ---- handlers --------------------------------------------------------
    def _on_inspection_request(self, p: dict) -> None:
        person_id = self._find_or_create_person(p.get("contact_name"), p.get("contact_phone"))
        deal = {
            "title": f"Inspection — {p['address']}",
            "value": INSPECTION_PRICE_CAD,
            "currency": CURRENCY,
        }
        if person_id:
            deal["person_id"] = person_id
        stage_id = self._inspection_booked_stage()
        if stage_id:
            deal["stage_id"] = stage_id
        deal_id = self._post("deals", deal)["data"]["id"]
        self.deals[p["reference"]] = deal_id
        lines = [
            f"Booked by the Roof Watcher sales agent. Ref {p['reference']}.",
            f"Address: {p['address']}",
        ]
        for key, value in (p.get("qualification") or {}).items():
            if value is not None:
                lines.append(f"{key.replace('_', ' ').capitalize()}: {value}")
        lines.append("Timing NOT confirmed. Call the customer to schedule.")
        self._post("notes", {"deal_id": deal_id, "content": "<br>".join(lines)})

    def _on_contact(self, p: dict) -> None:
        person_id = self._find_or_create_person(p.get("contact_name"), p.get("contact_phone"))
        if not person_id:
            return
        deal_id = self.deals.get(p.get("reference") or "")
        if deal_id:
            self._request("PUT", f"deals/{deal_id}", {"person_id": person_id})
        elif p.get("escalated") and self.last_escalation_activity:
            self._request(
                "PUT",
                f"activities/{self.last_escalation_activity}",
                {"person_id": person_id},
            )

    def _on_address_correction(self, p: dict) -> None:
        deal_id = self.deals.get(p["reference"])
        if deal_id:
            self._post(
                "notes",
                {
                    "deal_id": deal_id,
                    "content": f"Address corrected: {p['old_address']} → {p['new_address']}",
                },
            )

    def _on_escalation(self, p: dict) -> None:
        who = p.get("contact_name") or "Customer"
        phone = p.get("contact_phone") or "no number given yet"
        note = [
            f"Reason (rule {p['rule']}): {p['reason']}",
            f"Customer: {who}, {phone}",
        ]
        if p.get("address"):
            note.append(f"Address: {p['address']}")
        note.append("Transcript:")
        note.extend(p.get("transcript") or [])
        activity = {
            "subject": f"Call back {who} — sales agent hand-off",
            "type": "call",
            "note": "<br>".join(note),
        }
        person_id = self._find_or_create_person(p.get("contact_name"), p.get("contact_phone"))
        if person_id:
            activity["person_id"] = person_id
        result = self._post("activities", activity)
        self.last_escalation_activity = result["data"]["id"]

    # ---- HTTP -------------------------------------------------------------
    def _inspection_booked_stage(self) -> int | None:
        """The configured stage id, else the id of the stage named
        "Inspection Booked" (looked up once). None means Pipedrive's
        default first stage."""
        if self.stage_id or self._stage_looked_up:
            return self.stage_id
        self._stage_looked_up = True
        try:
            stages = self._request("GET", "stages", None).get("data") or []
        except Exception as exc:
            self.errors.append(f"stage lookup: {exc}")
            return None
        wanted = INSPECTION_BOOKED_STAGE_NAME.casefold()
        for stage in stages:
            if (stage.get("name") or "").strip().casefold() == wanted:
                self.stage_id = int(stage["id"])
                break
        else:
            self.errors.append(
                f'stage lookup: no stage named "{INSPECTION_BOOKED_STAGE_NAME}"; '
                "deal goes to the pipeline's first stage"
            )
        return self.stage_id

    def _find_or_create_person(self, name: str | None, phone: str | None) -> int | None:
        if not name and not phone:
            return None
        if phone:
            if phone in self.persons:
                return self.persons[phone]
            found = self._search_person_by_phone(phone)
            if found:
                self.persons[phone] = found
                return found
        body: dict = {"name": name or f"Roof Watcher lead {phone}"}
        if phone:
            body["phone"] = [{"value": phone, "primary": True}]
        person_id = self._post("persons", body)["data"]["id"]
        if phone:
            self.persons[phone] = person_id
        return person_id

    def _search_person_by_phone(self, phone: str) -> int | None:
        query = urllib.parse.urlencode(
            {"term": phone, "fields": "phone", "exact_match": "true", "limit": 1}
        )
        result = self._request("GET", f"persons/search?{query}", None)
        items = (result.get("data") or {}).get("items") or []
        if items:
            return int(items[0]["item"]["id"])
        return None

    def _post(self, path: str, body: dict) -> dict:
        return self._request("POST", path, body)

    def _request(self, method: str, path: str, body: dict | None) -> dict:
        url = f"https://{self.domain}.pipedrive.com/api/v1/{path}"
        result = self.transport(method, url, body, {"x-api-token": self.api_token})
        if not result.get("success", False):
            raise RuntimeError(f"Pipedrive {method} {path} failed: {result.get('error')}")
        return result
