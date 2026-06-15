import asyncio
import aiohttp
import csv
import json
import sys
from pathlib import Path

API_KEY = "43a166fcf88e6ba2e512773ca8a738ff"
BASE = "https://changedetection.pamelacoreypc.com"
DATA_DIR = Path(__file__).parent.parent / "data"

CAREERS_CSV = DATA_DIR / "test_9999_careers_20260608_2334.csv"
ATS_CSV     = DATA_DIR / "test_9999_ats_20260608_2334.csv"

SKIP_DOMAINS = {
    "foodpartners-international.com", "flandersfoodproductions.be",
    "robovision.ai", "icscoolenergy.com", "delicia.nl", "nu3.de",
    "vegdog.de", "affeldt.com", "edmondderothschildheritage.com", "hochwald.de"
}

HEADERS = {"x-api-key": API_KEY, "Content-Type": "application/json"}
CONCURRENCY = 10


async def get_or_create_tag(session, name):
    async with session.get(f"{BASE}/api/v1/tags") as r:
        tags = await r.json()  # dict: {uuid: {title, uuid, ...}}
        for uuid, tag in tags.items():
            if tag.get("title") == name:
                return uuid
    async with session.post(f"{BASE}/api/v1/tag", json={"title": name}) as r:
        return (await r.json())["uuid"]


async def add_watch(session, sem, url, title, tag_uuid, country):
    async with sem:
        payload = {
            "url": url,
            "title": title,
            "tags": [tag_uuid],
            "filter_text_added": True,
            "filter_text_removed": False,
            "filter_text_replaced": False,
            "subtractive_selectors": ["nav", "footer", "header", "script", "style"],
            "time_between_check": {"hours": 24},
            "fetch_backend": "html_requests",
        }
        try:
            async with session.post(f"{BASE}/api/v1/watch", json=payload) as r:
                data = await r.json()
                uuid = data.get("uuid", "")
                return uuid, url, title
        except Exception as e:
            return None, url, str(e)


async def main():
    source = sys.argv[1] if len(sys.argv) > 1 else "careers"

    rows = []
    if source == "careers":
        with open(CAREERS_CSV, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row["domain"] not in SKIP_DOMAINS:
                    rows.append(("careers_pages", row["careers_url"],
                                 row["company"] or row["domain"], row["country"]))
    elif source == "ats":
        with open(ATS_CSV, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row["domain"] not in SKIP_DOMAINS:
                    rows.append(("ats_pages", row["ats_url"],
                                 row["company"] or row["domain"], row["country"]))

    print(f"Importing {len(rows)} URLs (source={source})...")

    sem = asyncio.Semaphore(CONCURRENCY)
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(headers=HEADERS, timeout=timeout) as session:
        careers_tag = await get_or_create_tag(session, "career_pages")
        ats_tag     = await get_or_create_tag(session, "ats_pages")

        tag_map = {"careers_pages": careers_tag, "ats_pages": ats_tag}

        tasks = [
            add_watch(session, sem, url, title, tag_map[tag], country)
            for tag, url, title, country in rows
        ]

        ok, fail = 0, 0
        for i, coro in enumerate(asyncio.as_completed(tasks), 1):
            uuid, url, info = await coro
            if uuid:
                ok += 1
            else:
                fail += 1
            if i % 50 == 0 or i == len(rows):
                print(f"  [{i}/{len(rows)}] ok={ok} fail={fail}")

    print(f"\nDone. Imported {ok}, failed {fail}")


if __name__ == "__main__":
    asyncio.run(main())
