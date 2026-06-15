import asyncio
import aiohttp
import json
import os

OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY", "")
MODEL = "openai/gpt-4o-mini"

SYSTEM_PROMPT = """You are a signal classifier for an executive recruiting firm (Philippe Bosquillon) specializing in food & beverage, agri-food, and industrial sectors in Europe (FR, DE, NL, BE, CH, AT).

Your job: analyze text that was NEWLY ADDED to a company careers page and decide if it contains a senior job posting worth acting on.

RELEVANT = all three conditions met:
1. Contains a specific job title (not just generic "join us" or "we are hiring" text)
2. Role is senior level: Director, Head of, VP, C-level, DRH, Responsable RH, Leiter, Geschaeftsfuehrer, Manager (in a senior context), CFO, CTO, COO, CEO, or equivalent
3. Estimated salary likely 80,000+ EUR/year based on seniority

NOT RELEVANT:
- Technician, Engineer (junior), Intern, Trainee, Apprentice, Stagiaire, Azubi, Praktikant
- Generic page text with no specific role mentioned
- Navigation / footer / cookie banner changes
- Mid-level or junior roles

Text can be in any language (FR, DE, NL, EN). Respond ONLY with valid JSON, no explanation outside JSON."""

USER_TEMPLATE = """Company: {company}
URL: {url}

Newly added text on their careers page:
---
{diff}
---

Respond with JSON:
{{
  "is_relevant": true or false,
  "role_title": "exact role title from text, or null if none found",
  "seniority": "C-level / Director / Head / Senior Manager / Mid / Junior / Unknown",
  "language": "fr / de / nl / en / unknown",
  "reason": "one sentence"
}}"""

TEST_CASES = [
    {
        "id": "affeldt_de_real",
        "company": "Affeldt Maschinenbau DE",
        "url": "affeldt.com/karriere",
        "diff": "Techniker Serviceinnendienst (m/w/d)\nStandort: Hamburg | Vollzeit\nBearbeitung von Serviceanfragen und technischer Support fuer unsere Kunden.",
        "expected": False
    },
    {
        "id": "vegdog_de_noise",
        "company": "Vegdog DE",
        "url": "vegdog.de/jobs",
        "diff": "AGB\nImpressum\nWiderruf\nDatenschutz\nHelp Center\nKontaktformular",
        "expected": False
    },
    {
        "id": "rothschild_fr_senior",
        "company": "Edmond de Rothschild FR",
        "url": "edmondderothschildheritage.com/fr/careers",
        "diff": "Directeur des Ressources Humaines\nCDI - Paris - Temps plein\nNous recherchons un DRH pour piloter la politique RH du groupe sur 6 domaines viticoles.",
        "expected": True
    },
    {
        "id": "robovision_be_senior",
        "company": "Robovision BE",
        "url": "robovision.ai/about-us/careers",
        "diff": "Head of Sales EMEA\nGhent, Belgium | Full-time\nLead our enterprise sales team and own the revenue target across 12 European markets.",
        "expected": True
    },
    {
        "id": "nu3_de_mid",
        "company": "Nu3 DE",
        "url": "nu3.de/jobs",
        "diff": "Marketing Manager (m/w/d)\nBerlin | Vollzeit\nDu verantwortest unsere Social Media Kampagnen und steuerst externe Agenturen.",
        "expected": False
    },
    {
        "id": "ics_nl_intern",
        "company": "ICS Cool Energy NL",
        "url": "icscoolenergy.com/vacatures",
        "diff": "Stagiaire Marketing\nRotterdam | Stage 6 maanden\nWij zoeken een enthousiaste stagiaire voor ons marketingteam.",
        "expected": False
    },
    {
        "id": "food_fr_vp",
        "company": "Groupe Routhiau FR",
        "url": "groupe-routhiau.fr/carrieres",
        "diff": "VP Supply Chain Europe\nPoste base a Lyon | CDI\nPilotez la strategie supply chain pour 8 pays. Package 110-130k EUR.",
        "expected": True
    },
    {
        "id": "hochwald_nl_cfo",
        "company": "Hochwald Foods NL",
        "url": "hochwald.de/jobs",
        "diff": "Chief Financial Officer (m/w/d)\nStandort: Trier | Vollzeit\nVerantwortung fuer Finance, Controlling und Treasury des gesamten Konzerns.",
        "expected": True
    },
]


async def classify(session, case):
    prompt = USER_TEMPLATE.format(
        company=case["company"],
        url=case["url"],
        diff=case["diff"]
    )
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0,
        "response_format": {"type": "json_object"}
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://mastr-leads.com",
    }
    async with session.post(
        "https://openrouter.ai/api/v1/chat/completions",
        json=payload, headers=headers
    ) as r:
        data = await r.json()
        content = data["choices"][0]["message"]["content"]
        return json.loads(content)


async def main():
    if not OPENROUTER_KEY:
        print("ERROR: set OPENROUTER_API_KEY env var")
        return

    print(f"Testing {len(TEST_CASES)} cases with {MODEL}\n")
    print(f"{'ID':<30} {'EXPECTED':<10} {'GOT':<10} {'ROLE':<35} {'REASON'}")
    print("-" * 120)

    async with aiohttp.ClientSession() as session:
        for case in TEST_CASES:
            try:
                result = await classify(session, case)
                got = result.get("is_relevant", False)
                match = "OK" if got == case["expected"] else "WRONG"
                role = result.get("role_title") or "-"
                reason = result.get("reason", "")[:60]
                seniority = result.get("seniority", "")
                print(f"{case['id']:<30} {'YES' if case['expected'] else 'NO':<10} {'YES' if got else 'NO':<10} {role[:35]:<35} [{seniority}] {match}")
                print(f"  -> {reason}")
            except Exception as e:
                print(f"{case['id']:<30} ERROR: {e}")

    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
