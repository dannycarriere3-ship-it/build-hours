"""The dialogue policy: ANSWER -> QUALIFY -> BOOK, with a narrow escalation
gate.

`handle_message` is the single entry point. It mutates a `ConversationState`
in place and returns the agent's reply. All side effects (booking, paging
Danny) go through `roof_watcher/tools.py` and are recorded on the `sink` so
tests and callers can assert exactly what "happened" without hitting a real
system.
"""

from __future__ import annotations

from roof_watcher import tools
from roof_watcher.config import (
    ADDRESS_CLARIFICATION,
    CALL_BACK_PROMPT,
    COMPANY_PHONE,
    ESCALATION_CONTACT_NAME,
    EXPERIENCE_ANSWER,
    PRICING_QNA_ANSWER,
    PRIMARY_CTA,
    REPAIR_COST_ANSWER,
    REPAIR_COST_FOLLOWUP,
    THINK_ABOUT_IT_PROMPT,
    TIERS,
)
from roof_watcher.models import ConversationState, Role, Stage
from roof_watcher.nlu import Classification, classify, is_negative_leak_status, parse_yesno
from roof_watcher.tools import EventSink

_LEAK_DETAILS_QUESTION = (
    "Where is the leak showing up, and is it actively leaking right now?"
)

# Intents whose canned answer already ends in its own single question, so
# we don't stack a second qualification question in the same reply.
_SELF_CONTAINED_INTENTS = {"pricing_question", "repair_cost_question"}


def handle_message(state: ConversationState, sink: EventSink, text: str) -> str:
    state.record("customer", text)
    reply = _handle(state, sink, text)
    state.record("agent", reply)
    return reply


def _handle(state: ConversationState, sink: EventSink, text: str) -> str:
    cls = classify(text)

    if state.escalation.escalated:
        return _escalated_reply()

    if state.booking.requested:
        # A new address volunteered post-booking is a correction, not an
        # answer to a pending question -- handle it before falling back to
        # the generic "you're already booked" reply.
        if cls.address_like is not None:
            return _handle_address_correction(state, sink, cls.address_like)
        return _booked_reply(state)

    # ---- Escalation rule 2: custom pricing / payment plan request. Checked
    # before the objection/callback follow-up branches below so a
    # custom-pricing ask always escalates, even mid-objection (e.g. while
    # answering "What part are you unsure about?").
    if cls.intent == "custom_pricing_request":
        return _escalate(
            state,
            sink,
            rule=2,
            reason="Customer asked for custom pricing or a payment plan.",
        )

    if state.escalation.awaiting_objection_explanation:
        return _handle_objection_followup(state, sink, text, cls)

    if state.escalation.awaiting_callback_reason:
        return _handle_callback_followup(state, sink, text, cls)

    # ---- Escalation rule 3, step 1: "I'll call you back."
    if cls.intent == "call_back":
        state.escalation.call_back_count += 1
        state.escalation.awaiting_callback_reason = True
        state.stage = Stage.OBJECTION
        return CALL_BACK_PROMPT

    # ---- Escalation rule 1, step 1: "let me think about it."
    if cls.intent == "think_about_it":
        state.escalation.awaiting_objection_explanation = True
        state.stage = Stage.OBJECTION
        return THINK_ABOUT_IT_PROMPT

    # "ok"/"sure"/"fine" etc. are ambiguous: they match both the
    # low-engagement wordlist and the booking-affirmation wordlist, AND a
    # bare "yes"/"sure" is also the natural answer to other pending
    # yes/no qualification questions (e.g. "Is it leaking right now?",
    # "...is it actively leaking right now?"). Only treat it as "yes, book
    # it" when we actually just asked "Would you like to book the
    # inspection?" (awaiting_booking_confirm) -- otherwise fall through so
    # it's consumed as the answer to whatever question IS pending. This
    # must still be checked BEFORE counting toward the rule-4
    # slipping-away streak — genuinely agreeing to book is the opposite of
    # disengagement.
    if cls.intent == "booking_affirm" and state.qualification.awaiting_booking_confirm:
        state.qualification.awaiting_booking_confirm = False
        state.escalation.low_engagement_streak = 0
        if state.qualification.address is None:
            state.qualification.awaiting_address = True
            return PRIMARY_CTA
        return _pipeline(state, sink, text, cls)

    # ---- Escalation rule 4: customer is clearly slipping away — three or
    # more non-committal, disengaged replies in a row with no forward
    # progress on qualification or booking. Only counted when no question
    # is pending that the reply could instead be answering.
    if cls.low_engagement:
        state.escalation.low_engagement_streak += 1
    else:
        state.escalation.low_engagement_streak = 0

    if cls.low_engagement and state.escalation.low_engagement_streak >= 3:
        return _escalate(
            state,
            sink,
            rule=4,
            reason=(
                "Customer has given several non-committal replies in a row "
                "and is clearly slipping away."
            ),
        )

    return _pipeline(state, sink, text, cls)


def _handle_objection_followup(
    state: ConversationState, sink: EventSink, text: str, cls: Classification
) -> str:
    state.escalation.awaiting_objection_explanation = False

    if cls.refuses_to_explain or cls.low_engagement:
        state.escalation.think_it_over_unexplained_count += 1
        return _escalate(
            state,
            sink,
            rule=1,
            reason=(
                "Customer said they needed to think it over and would not "
                "explain what's holding them back."
            ),
        )

    # Customer explained -> answer normally and continue toward booking.
    return _pipeline(state, sink, text, cls)


def _handle_callback_followup(
    state: ConversationState, sink: EventSink, text: str, cls: Classification
) -> str:
    state.escalation.awaiting_callback_reason = False

    still_delaying = (
        cls.intent in ("call_back", "think_about_it", "low_engagement")
        or cls.refuses_to_explain
    )
    if still_delaying:
        return _escalate(
            state,
            sink,
            rule=3,
            reason="Customer kept delaying instead of booking the inspection.",
        )

    # Customer named a real concern -> answer it and keep moving.
    return _pipeline(state, sink, text, cls)


def _pipeline(
    state: ConversationState, sink: EventSink, text: str, cls: Classification
) -> str:
    was_awaiting_address = state.qualification.awaiting_address
    is_directed_answer = cls.intent not in _DEFLECTING_INTENTS

    _extract_qualification(state, cls, text)
    state.stage = Stage.QUALIFYING if state.stage == Stage.GREETING else state.stage

    # This is the turn the agent asks "Would you like to book the
    # inspection?" -- remember it so a later bare "yes" is unambiguously
    # a booking confirmation and not an answer to some other question.
    if cls.intent == "repair_cost_question":
        state.qualification.awaiting_booking_confirm = True

    # We asked for the address, got a real (non-deflecting) answer, and it
    # still didn't parse as an address -- never book against garbage;
    # re-ask instead of silently falling through to a generic follow-up.
    # awaiting_address is untouched by a failed extraction, so it's still
    # True here and stays True for the next reply.
    if (
        was_awaiting_address
        and state.qualification.address is None
        and is_directed_answer
        and text.strip()
    ):
        return ADDRESS_CLARIFICATION

    answer = _answer_for_intent(cls)

    if state.qualification.address and not state.booking.requested:
        confirmation = _do_booking(state, sink)
        return " ".join(part for part in (answer, confirmation) if part)

    if cls.intent in _SELF_CONTAINED_INTENTS:
        return answer

    followup = _qualification_followup(state)
    combined = " ".join(part for part in (answer, followup) if part)
    return combined or "Got it — what else can I answer?"


def _answer_for_intent(cls: Classification) -> str:
    if cls.intent == "pricing_question":
        return PRICING_QNA_ANSWER
    if cls.intent == "repair_cost_question":
        return f"{REPAIR_COST_ANSWER} {REPAIR_COST_FOLLOWUP}"
    if cls.intent == "tier_question" and cls.tier_key:
        tier = TIERS[cls.tier_key]
        return f"{tier.name} is ${tier.monthly_price_usd}/month. {tier.description}"
    if cls.intent == "experience_question":
        return EXPERIENCE_ANSWER
    return ""


def _qualification_followup(state: ConversationState) -> str:
    q = state.qualification
    missing = q.next_missing_field()

    if missing == "leak_location":
        q.awaiting_leak_details = True
        return _LEAK_DETAILS_QUESTION
    if missing == "issue_description":
        q.awaiting_issue_description = True
        return "What's happening with the roof?"
    if missing == "is_leaking":
        q.awaiting_is_leaking = True
        return "Is it leaking right now?"
    if missing == "is_multiple_properties":
        q.awaiting_is_multiple = True
        return "Is this one property, or multiple?"
    if missing == "role":
        q.awaiting_role = True
        return "Are you the owner or the property manager?"
    if missing == "address":
        q.awaiting_address = True
        return PRIMARY_CTA
    return ""


# Intents that mean "the customer asked something else instead of
# answering" — a directed qualification answer should NOT be captured from
# these, so the question gets re-asked after the new thing is answered.
_DEFLECTING_INTENTS = {
    "pricing_question",
    "repair_cost_question",
    "tier_question",
    "experience_question",
}


def _extract_qualification(
    state: ConversationState, cls: Classification, text: str
) -> None:
    q = state.qualification
    is_directed_answer = cls.intent not in _DEFLECTING_INTENTS

    if q.awaiting_issue_description and is_directed_answer:
        q.issue_description = text
        q.awaiting_issue_description = False

    if q.awaiting_leak_details and is_directed_answer:
        q.leak_location = text
        q.leak_active = not is_negative_leak_status(text)
        q.awaiting_leak_details = False

    if q.awaiting_is_leaking and is_directed_answer:
        parsed = parse_yesno(text)
        if parsed is None:
            parsed = cls.is_leaking
        if parsed is not None:
            q.is_leaking = parsed
            q.awaiting_is_leaking = False

    if q.awaiting_is_multiple and is_directed_answer and cls.is_multiple is not None:
        q.is_multiple_properties = cls.is_multiple
        q.awaiting_is_multiple = False

    if q.awaiting_role and is_directed_answer:
        if cls.role is not None:
            q.role = cls.role
            q.awaiting_role = False
        elif not cls.low_engagement and not cls.is_greeting and text.strip():
            # They answered *something* that isn't "owner"/"manager" — file
            # it as OTHER rather than looping on this question forever.
            q.role = Role.OTHER
            q.awaiting_role = False

    if q.awaiting_address and is_directed_answer and q.address is None:
        # Only a regex-validated address is accepted here -- a "contains a
        # digit" fallback would book against garbage like "call me at
        # 780-555-0100" or "I don't know, maybe unit 4?". If this doesn't
        # match, awaiting_address stays True and _pipeline re-asks instead
        # of booking.
        if cls.address_like is not None:
            q.address = cls.address_like
            q.awaiting_address = False

    # Opportunistic capture: a customer can volunteer these facts before
    # we've asked, e.g. "I've got 3 buildings" unprompted.
    #
    # Address is deliberately NOT captured opportunistically: the address
    # heuristic is a loose "number + word + common-word street suffix"
    # match (e.g. "close", "park", "way") that also matches ordinary prose
    # like "water is pooling close to the drain". An address is only ever
    # accepted once we've actually asked for it (awaiting_address, above),
    # so a customer describing their problem can never get accidentally
    # booked against a sentence fragment mistaken for a street address.
    if cls.is_leaking is not None and q.is_leaking is None:
        q.is_leaking = cls.is_leaking
    if cls.is_multiple is not None and q.is_multiple_properties is None:
        q.is_multiple_properties = cls.is_multiple
    if cls.role is not None and q.role is None:
        q.role = cls.role


def _do_booking(state: ConversationState, sink: EventSink) -> str:
    address = state.qualification.address
    receipt = tools.book_inspection(sink, address)
    state.booking.requested = True
    state.booking.address = address
    state.booking.request_reference = receipt["reference"]
    state.stage = Stage.BOOKED
    return (
        f"Got it — inspection request logged for {address} "
        f"(ref: {receipt['reference']}). Someone from Carriere Roofing will "
        "call to confirm timing. Anything else?"
    )


def _handle_address_correction(
    state: ConversationState, sink: EventSink, new_address: str
) -> str:
    old_address = state.booking.address
    reference = state.booking.request_reference
    tools.correct_booking_address(sink, reference, old_address, new_address)
    state.booking.address = new_address
    state.qualification.address = new_address
    return (
        f"Updated — inspection {reference} is now logged for {new_address}. "
        "Anything else?"
    )


def _booked_reply(state: ConversationState) -> str:
    ref = state.booking.request_reference
    return (
        f"You're already booked (ref: {ref}) — our team will call to confirm "
        f"timing. Need anything else, or want to reach us directly at "
        f"{COMPANY_PHONE}?"
    )


def _escalate(state: ConversationState, sink: EventSink, rule: int, reason: str) -> str:
    state.escalation.escalated = True
    state.escalation.reason = reason
    state.escalation.triggered_rule = rule
    state.stage = Stage.ESCALATED
    tools.escalate_to_danny(sink, reason=reason, rule=rule)
    return (
        f"Understood — let me bring {ESCALATION_CONTACT_NAME} in personally "
        f"so he can help directly. He'll follow up, or you can reach him "
        f"now at {COMPANY_PHONE}."
    )


def _escalated_reply() -> str:
    return (
        f"{ESCALATION_CONTACT_NAME} has this one — he'll be in touch, or "
        f"call {COMPANY_PHONE} anytime."
    )
