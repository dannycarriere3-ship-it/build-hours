"""Top-level agent object: ANSWER -> QUALIFY -> BOOK.

Usage:

    from roof_watcher.agent import RoofWatcherAgent

    agent = RoofWatcherAgent()
    reply = agent.send("My roof is leaking")

Each `RoofWatcherAgent` owns one conversation's `ConversationState` and an
`EventSink` for the (simulated) booking/escalation records it produces.
"""

from __future__ import annotations

from roof_watcher.models import ConversationState
from roof_watcher.policy import handle_message
from roof_watcher.tools import EventSink, InMemorySink


class RoofWatcherAgent:
    def __init__(self, sink: EventSink | None = None) -> None:
        self.state = ConversationState()
        self.sink: EventSink = sink if sink is not None else InMemorySink()

    def send(self, message: str) -> str:
        return handle_message(self.state, self.sink, message)

    @property
    def events(self) -> list[dict]:
        """Simulated side effects recorded so far (bookings, escalations)."""
        return getattr(self.sink, "events", [])
