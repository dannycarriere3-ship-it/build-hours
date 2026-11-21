"""Static business facts for Carriere Flat Roofing.

Everything the agent is allowed to say about the business, pricing, or
plans lives here. The dialogue policy (`policy.py`) only ever quotes these
values — it never invents numbers, promises, or claims. Keeping this in one
module also makes it trivial to audit "did the agent ever say something we
didn't approve?".

All prices are Canadian dollars. Maintenance plans are pitched monthly
(the recurring fee), plus GST; repairs are always quoted separately after
an inspection.
"""

from __future__ import annotations

from dataclasses import dataclass


COMPANY_NAME = "Carriere Flat Roofing"
COMPANY_CITY = "Edmonton, Alberta"
COMPANY_PHONE = "780-405-4440"
COMPANY_WEBSITE = "carriereflatroofing.com"
COMPANY_EXPERIENCE = "20 years in commercial flat roofing"
ROOF_SYSTEMS = "SBS, TPO, EPDM and BUR"

ESCALATION_CONTACT_NAME = "Danny"

CURRENCY = "CAD"

# Inspection pricing. No free inspection, ever.
INSPECTION_PRICE_CAD = 500
INFRARED_PRICE_RANGE_CAD = (700, 1000)


@dataclass(frozen=True)
class MaintenancePlan:
    key: str
    name: str
    annual_price_cad: int
    monthly_price_cad: int  # annual / 12, rounded — the number we lead with


PLANS: dict[str, MaintenancePlan] = {
    "essential": MaintenancePlan(
        key="essential",
        name="Essential",
        annual_price_cad=2000,
        monthly_price_cad=167,
    ),
    "professional": MaintenancePlan(
        key="professional",
        name="Professional",
        annual_price_cad=4000,
        monthly_price_cad=333,
    ),
    "premium_platinum": MaintenancePlan(
        key="premium_platinum",
        name="Premium Platinum",
        annual_price_cad=6500,
        monthly_price_cad=542,
    ),
}

# Backwards-compatible alias for older imports.
TIERS = PLANS

INSPECTION_LINE = (
    f"A roof inspection is ${INSPECTION_PRICE_CAD} per roof — dated photos "
    "and a written condition report, done to ARCA standards."
)

INFRARED_LINE = (
    f"An infrared inspection, which finds trapped moisture under the "
    f"membrane, is ${INFRARED_PRICE_RANGE_CAD[0]}–${INFRARED_PRICE_RANGE_CAD[1]:,}, "
    "charged separately."
)

INSPECTION_PRICE_ANSWER = f"{INSPECTION_LINE} {INFRARED_LINE}"

FREE_INSPECTION_ANSWER = (
    f"Our roof inspection is ${INSPECTION_PRICE_CAD} per roof — dated photos "
    "and a written condition report, done to ARCA standards."
)

PRICING_QNA_ANSWER = (
    "It depends on what you need. Maintenance plans are $167/month "
    "(Essential), $333/month (Professional) or $542/month (Premium "
    f"Platinum), plus GST. {INSPECTION_LINE} Repairs are quoted after "
    "inspection. How many properties are you managing?"
)

PRIMARY_CTA = "Let's get the inspection booked. What's the building address?"

REPAIR_COST_ANSWER = (
    "We need to inspect it first. Once we know exactly what's causing the "
    "problem, we can quote the repair."
)
REPAIR_COST_FOLLOWUP = "Would you like to book the inspection?"

EXPERIENCE_ANSWER = (
    f"{COMPANY_NAME} has {COMPANY_EXPERIENCE} — {ROOF_SYSTEMS} — based in "
    f"{COMPANY_CITY}."
)

ROOF_SYSTEMS_ANSWER = (
    f"Yes — we work on commercial flat roofs in all four systems: "
    f"{ROOF_SYSTEMS}."
)

ADDRESS_CLARIFICATION = (
    "I need the building's street address to book the inspection — "
    "what is the street address?"
)

# Asked right after an inspection request is logged. Deliberately avoids
# any time/date wording: nobody has a slot yet, a person calls to set one.
CONTACT_QUESTION = "Who should we call to confirm timing, and at what number?"

CONTACT_CLARIFICATION = (
    "I need a phone number so we can call to confirm timing — what's the "
    "best number to reach you?"
)

THINK_ABOUT_IT_PROMPT = "Absolutely. What part are you unsure about?"

CALL_BACK_PROMPT = (
    "No problem. Before you go, is there anything holding you back from "
    "booking the inspection?"
)
