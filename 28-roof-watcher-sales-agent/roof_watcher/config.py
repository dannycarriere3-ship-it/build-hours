"""Static business facts for Carriere Roofing.

Everything the agent is allowed to say about the business, pricing, or
tiers lives here. The dialogue policy (`policy.py`) only ever quotes these
values — it never invents numbers, promises, or claims. Keeping this in one
module also makes it trivial to audit "did the agent ever say something we
didn't approve?".
"""

from __future__ import annotations

from dataclasses import dataclass


COMPANY_NAME = "Carriere Roofing"
COMPANY_CITY = "Edmonton, Alberta"
COMPANY_PHONE = "587-557-7138"
COMPANY_EXPERIENCE = "20 years SBS / torch-on experience"

ESCALATION_CONTACT_NAME = "Danny"


@dataclass(frozen=True)
class PricingTier:
    key: str
    name: str
    monthly_price_usd: int
    description: str


TIERS: dict[str, PricingTier] = {
    "roof_watcher": PricingTier(
        key="roof_watcher",
        name="Roof Watcher",
        monthly_price_usd=99,
        description="Ongoing monitoring.",
    ),
    "watcher": PricingTier(
        key="watcher",
        name="Watcher",
        monthly_price_usd=249,
        description="Monitoring + insurance documentation + storm response.",
    ),
    "platinum": PricingTier(
        key="platinum",
        name="Platinum",
        monthly_price_usd=599,
        description="Designed for multiple properties.",
    ),
}

PRICING_QNA_ANSWER = (
    "It depends on what you need. Monitoring starts at $99/month. "
    "Insurance documentation and storm response is $249/month. "
    "Platinum for multiple properties is $599/month. "
    "Repairs are quoted after inspection. How many properties are you managing?"
)

PRIMARY_CTA = "Let's get the inspection booked. What's the building address?"

REPAIR_COST_ANSWER = (
    "We need to inspect it first. Once we know exactly what's causing the "
    "problem, we can quote the repair."
)
REPAIR_COST_FOLLOWUP = "Would you like to book the inspection?"

EXPERIENCE_ANSWER = (
    f"{COMPANY_NAME} has {COMPANY_EXPERIENCE}, based in {COMPANY_CITY}."
)

ADDRESS_CLARIFICATION = (
    "I need the building's street address to book the inspection — "
    "what is the street address?"
)

THINK_ABOUT_IT_PROMPT = "Absolutely. What part are you unsure about?"

CALL_BACK_PROMPT = (
    "No problem. Before you go, is there anything holding you back from "
    "booking the inspection?"
)
