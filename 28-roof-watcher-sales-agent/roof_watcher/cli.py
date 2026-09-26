"""Interactive REPL demo. Not a real integration — just a terminal chat
against the deterministic policy, so you can feel the script.

Run with: python -m roof_watcher.cli
"""

from __future__ import annotations

from roof_watcher.agent import RoofWatcherAgent
from roof_watcher.config import COMPANY_NAME

_COLOR = {"blue": "34", "gray": "90", "green": "32"}


def _c(text: str, name: str) -> str:
    code = _COLOR.get(name, "0")
    return f"\033[{code}m{text}\033[0m"


def main() -> None:
    agent = RoofWatcherAgent()
    print(_c(f"{COMPANY_NAME} — Roof Watcher Sales Agent (demo)", "gray"))
    print(_c("Type 'exit' to quit.\n", "gray"))
    while True:
        try:
            user_input = input("> ")
        except (EOFError, KeyboardInterrupt):
            print("\nExiting.")
            break
        if user_input.strip().lower() in {"exit", "quit"}:
            print("Exiting.")
            break
        if not user_input.strip():
            continue
        reply = agent.send(user_input)
        print(_c("Agent:", "blue"), reply)

    if agent.events:
        print(_c("\n[simulated events logged this session]", "gray"))
        for event in agent.events:
            print(_c(f"  {event}", "gray"))


if __name__ == "__main__":
    main()
