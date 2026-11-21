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
                              numeric id of the "Inspection Booked" stage.
                              If unset, Pipedrive puts the deal in the
                              pipeline's first stage.

What it does (Pipedrive API v1):
    inspection_request -> person (if a phone/name is known) + deal
                          "Inspection — <address>" worth CA$500 in the
                          Inspection Booked stage + a note with the
                          qualification answers.
    contact            -> person, linked to that booking's deal.
    address_correction -> note on the deal.
    escalation         -> a "call" activity for Danny with the reason, the
                          customer's number and the full transcript.

Every event is also kept in memory (`events`), and a failed API call is
recorded in `errors` instead of crashing the conversation.
"""

from __future__ import annotations

import json
import os
import urllib.request
from dataclasses import dataclass, field
from typing import Callable

from roof_watcher.config import CURRENCY, INSPECTION_PRICE_CAD

Transport = Callable[[str, str, dict], dict]


def _urllib_transport(method: str, url: str, body: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        method=method,
        headers={"Content-Type": "application/json"},
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
        person_id = self._create_person(p.get("contact_name"), p.get("contact_phone"))
        deal = {
            "title": f"Inspection — {p['address']}",
            "value": INSPECTION_PRICE_CAD,
            "currency": CURRENCY,
        }
        if person_id:
            deal["person_id"] = person_id
        if self.stage_id:
            deal["stage_id"] = self.stage_id
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
        person_id = self._create_person(p.get("contact_name"), p.get("contact_phone"))
        deal_id = self.deals.get(p.get("reference") or "")
        if person_id and deal_id:
            self._request("PUT", f"deals/{deal_id}", {"person_id": person_id})

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
        self._post(
            "activities",
            {
                "subject": f"Call back {who} — sales agent hand-off",
                "type": "call",
                "note": "<br>".join(note),
            },
        )

    # ---- HTTP -------------------------------------------------------------
    def _create_person(self, name: str | None, phone: str | None) -> int | None:
        if not name and not phone:
            return None
        body: dict = {"name": name or f"Roof Watcher lead {phone}"}
        if phone:
            body["phone"] = [{"value": phone, "primary": True}]
        return self._post("persons", body)["data"]["id"]

    def _post(self, path: str, body: dict) -> dict:
        return self._request("POST", path, body)

    def _request(self, method: str, path: str, body: dict) -> dict:
        url = f"https://{self.domain}.pipedrive.com/api/v1/{path}?api_token={self.api_token}"
        result = self.transport(method, url, body)
        if not result.get("success", False):
            raise RuntimeError(f"Pipedrive {method} {path} failed: {result.get('error')}")
        return result
