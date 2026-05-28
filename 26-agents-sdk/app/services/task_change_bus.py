from __future__ import annotations

from collections.abc import Generator
from queue import Empty, Queue
from threading import Lock


class TaskChangeBus:
    def __init__(self) -> None:
        self._subscribers: set[Queue[None]] = set()
        self._lock = Lock()

    def publish(self) -> None:
        with self._lock:
            subscribers = list(self._subscribers)
        for subscriber in subscribers:
            subscriber.put_nowait(None)

    def stream(self) -> Generator[str, None, None]:
        subscriber: Queue[None] = Queue()
        with self._lock:
            self._subscribers.add(subscriber)
        try:
            yield "event: ready\ndata: {}\n\n"
            while True:
                try:
                    subscriber.get(timeout=15)
                except Empty:
                    yield ": keep-alive\n\n"
                else:
                    yield "event: tasks_changed\ndata: {}\n\n"
        finally:
            with self._lock:
                self._subscribers.discard(subscriber)
