# Roof Watcher Sales Agent — Carriere Roofing

A production-oriented commercial-roofing sales agent for **Carriere
Roofing** (Edmonton, AB — 20 years SBS / torch-on experience,
587-557-7138). The agent's job, in order, is:

**ANSWER → QUALIFY → BOOK INSPECTION.**

It answers the customer's question, gathers the five qualification facts
one at a time, and gets a building address so an inspection can be
requested — escalating to Danny only under four narrowly-defined rules.

## Why this is built as a deterministic policy, not an LLM prompt

The other Build Hours examples in this repo (`12-agentic-tool-calling`,
`26-agents-sdk`, `18-responses-api`, `14-voice-agents`,
`21-agentic-memory`) all wrap an LLM (OpenAI Agents SDK / Responses API /
Realtime API) and let the model decide what to say next. That's the right
call when the assistant's job is open-ended. This agent's job is the
opposite: it must say a small set of *exact, pre-approved sentences*
(the pricing line, the tier lines, the objection scripts) and must
**never** invent a fact, diagnose a roof, quote a repair price before
inspection, or escalate outside four named triggers. Those are hard
compliance requirements a sales team would actually hold a vendor to, and
they're only reliably testable if the system produces the same output for
the same input, every time — no sampling, no prompt drift, no "usually."

So the core (`roof_watcher/policy.py`) is a deterministic dialogue policy
over an explicit conversation-state machine, and:

- **Reused from `12-agentic-tool-calling` / `26-agents-sdk`**: the idea of
  small, single-purpose "tools" the orchestrator calls for side effects
  (`roof_watcher/tools.py: book_inspection`, `escalate_to_danny`), kept
  separate from the decision logic — same shape as `function_tool`, just
  invoked directly instead of via an LLM tool-call loop.
- **Reused from `26-agents-sdk`'s `needs_approval` pattern**
  (`app/agents/tools.py`): the idea of a narrow, explicit gate before a
  consequential action fires — here, the four escalation rules gate
  `escalate_to_danny` the same way `requires_completion_approval` gates
  moving a task to Done.
- **Reused from `14-voice-agents`' `guardrails.ts` / agent-config split**:
  keeping the exact-wording "script" (`roof_watcher/config.py`) as data,
  separate from the control flow that decides when to use it.
- **Not adopted**: `21-agentic-memory`'s summarization/trimming layer
  (this agent's state fits in a few structured fields, no long-running
  context to compact) and the realtime voice transport in
  `14-voice-agents` / `18-responses-api` (out of scope — this is a text
  sales conversation).
- **Not adopted, deliberately**: calling an LLM at all for the core loop.
  See `roof_watcher/nlu.py`'s docstring for the reasoning, and below for
  how to swap one in if you need broader free-text coverage.

## Install & run

```bash
cd 28-roof-watcher-sales-agent
python3 -m pip install -e ".[dev]"   # or just run with stdlib, no deps needed
python3 -m roof_watcher.cli          # interactive demo chat
```

No API keys, no network calls, no external services required to run or
test this. Everything is pure Python 3.10+ standard library.

```python
from roof_watcher.agent import RoofWatcherAgent

agent = RoofWatcherAgent()
print(agent.send("What do you charge?"))
print(agent.send("We manage 3 buildings"))
```

## Architecture

```
roof_watcher/
  config.py    Business facts + the exact scripted lines (pricing Q&A,
               tier Q&A, objection prompts, primary CTA). Nothing outside
               this file is a source of truth for what the agent claims.
  models.py    ConversationState: QualificationState, EscalationState,
               BookingState, Stage. Explicit, testable state — no hidden
               context.
  nlu.py       Deterministic intent classification (regex/keyword rules)
               + small extraction helpers (yes/no parsing, property-count
               parsing, address heuristics). Swap this module for an LLM
               classifier if you need to understand messier free text —
               everything downstream only depends on the `Classification`
               dataclass it returns.
  policy.py    The ANSWER -> QUALIFY -> BOOK state machine + the four
               escalation rules. Single entry point: handle_message(...).
  tools.py     SIMULATED side effects only — see below.
  agent.py     RoofWatcherAgent: owns one conversation's state + event
               sink. This is the object you actually use.
  cli.py       Interactive terminal demo (python -m roof_watcher.cli).
tests/         One file per conversation path (see below).
```

### Conversation state, explicitly

- **`QualificationState`** — the five primary qualification answers
  (what's happening, is it leaking, one property or multiple, owner or
  manager, address), plus `awaiting_*` flags that pin each question to
  its answer so a bare "yes"/"no"/short reply is never misattributed.
  Active-leak reports use an abbreviated path (`next_missing_field`
  jumps straight to address) per the business rule: an active leak is
  urgent, so we don't make the customer answer property-count/role
  before booking.
- **`EscalationState`** — tracks exactly the state needed for the four
  rules (unexplained "let me think about it", a custom-pricing ask,
  repeated "I'll call you back", a slipping-away streak) and nothing
  else. `escalated` is a one-way door: once set, the agent stops
  qualifying/booking and hands off.
- **`BookingState`** — `requested` (bool), `address`, `request_reference`.
  That's it — no fake time slot.

## Simulated vs. real — read this before using in production

**Nothing here talks to a real calendar, CRM, or paging system.**
`roof_watcher/tools.py` defines an `EventSink` protocol and an
`InMemorySink` default implementation that just appends dicts to a list.

- `book_inspection(sink, address)` logs a request with a locally-generated
  reference (`RW-XXXXXXXX`) and `status: "pending_human_confirmation"`. It
  never invents a date/time or claims a confirmed appointment — the agent's
  reply is always "someone will call to confirm timing," because that's
  the only thing that's actually true. `tests/test_booking_simulated.py`
  asserts no time/day words ever appear in a booking confirmation.
- `escalate_to_danny(sink, reason, rule)` logs an escalation record and
  returns a receipt describing what a real integration would need to do
  (e.g. post to a Slack channel, fire an SMS via Twilio). It does not
  page, text, or call anyone. The agent's reply only ever promises "he'll
  follow up" or gives the real phone number (587-557-7138) — never "Danny
  says" or "Danny confirmed."

To wire this to a real system: implement `EventSink` (or replace the tool
bodies) to call your scheduling API / paging system, and pass that
implementation to `RoofWatcherAgent(sink=...)`. The policy layer doesn't
change.

## Escalation — only these four rules, nothing else

1. Customer says "let me think about it" **and** won't explain why when
   asked ("What part are you unsure about?").
2. Customer asks for custom pricing or a payment plan.
3. Customer repeatedly says "I'll call you back" (or keeps delaying after
   being asked what's holding them back).
4. Customer gives three or more non-committal, disengaged replies in a
   row (clearly slipping away).

Every other objection, question, or vague reply is answered and the
conversation keeps moving toward booking. `tests/test_escalation_rules.py`
asserts both directions: each rule fires when it should, and ordinary
pricing/leak/repair-cost conversations never escalate.

## Tests

```bash
python3 -m pip install -e ".[dev]"
pytest -q
```

54 tests, one file per major conversation path:

| File | Covers |
|---|---|
| `test_pricing_qna.py` | Exact scripted pricing answer; experience Q&A |
| `test_tier_qna.py` | Roof Watcher / Watcher / Platinum — real prices, one question per turn |
| `test_qualification_flow.py` | Full 5-question qualification order, pricing-answer short-circuit |
| `test_leak_flow.py` | Active-leak urgent path, no diagnosis/price language |
| `test_objections.py` | "Think about it" (explain vs. refuse), "call you back" (once vs. repeated), repair-cost-then-yes |
| `test_escalation_rules.py` | All 4 rules fire correctly; normal Q&A never escalates |
| `test_booking_simulated.py` | No fake confirmed time, real reference format, no re-booking, no fake "Danny reached" claim |
| `test_full_conversations.py` | End-to-end: leak / pricing / maintenance question / general inquiry, each reaching BOOKED |
| `test_review_round2_fixes.py` | "yes" no longer hijacks pending qualification questions, garbage addresses get re-asked not booked, custom-pricing escalates even mid-objection, address is correctable after booking |
| `test_review_round3_fixes.py` | Booking-confirm flag can't go stale across turns, post-booking address-shaped chatter needs an explicit correction cue |

### Run results

```
54 passed in 0.09s
```

All tests pass. Nothing is currently failing or skipped.

### Known limitations (by design, not oversights)

- **Unscripted questions get no invented answer.** If a customer asks
  something outside the approved script (e.g. "do you offer maintenance
  contracts?"), the agent doesn't fabricate a claim — it has no fact to
  state, so it moves the conversation forward via qualification instead of
  making something up. `test_maintenance_question_reaches_booking_without_inventing_facts`
  covers this path.
- **NLU is regex/keyword-based**, not a full language model. It handles
  the phrasings exercised in the test suite robustly (including yes/no,
  numbers, common address suffixes) but will occasionally need a new
  pattern for a genuinely novel phrasing — that's a one-line addition to
  `nlu.py`, not a redesign. If you need robustness against arbitrary free
  text, swap `nlu.classify` for an LLM-backed classifier that returns the
  same `Classification` shape; `policy.py` doesn't need to change.
- **Role/is-leaking ambiguous answers get one honest re-ask**, not an
  infinite loop or a guessed default — except `role`, which files an
  unrecognized-but-present answer under `Role.OTHER` after one try so the
  conversation can still reach booking.
