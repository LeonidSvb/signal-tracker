import asyncio
import aiohttp
import sys

API_KEY = "43a166fcf88e6ba2e512773ca8a738ff"
BASE = "https://changedetection.pamelacoreypc.com"
WEBHOOK_URLS = [
    "jsons://n8n.pamelacoreypc.com/webhook/career-diffs",    # raw -> postgres
    "jsons://n8n.pamelacoreypc.com/webhook/career-signals",  # llm -> sheets + telegram
]

NOTIFICATION_TITLE = "[CD] {{watch_title}}"
NOTIFICATION_BODY = "url={{watch_url}}\nuuid={{watch_uuid}}\ndiff_start\n{{diff_added_clean}}"

HEADERS = {"x-api-key": API_KEY, "Content-Type": "application/json"}
CONCURRENCY = 20


async def update_watch(session, sem, uuid):
    async with sem:
        payload = {
            "notification_urls": WEBHOOK_URLS,
            "notification_title": NOTIFICATION_TITLE,
            "notification_body": NOTIFICATION_BODY,
        }
        try:
            async with session.put(
                f"{BASE}/api/v1/watch/{uuid}",
                json=payload
            ) as r:
                if r.status in (200, 204):
                    return uuid, True, None
                text = await r.text()
                return uuid, False, f"HTTP {r.status}: {text[:100]}"
        except Exception as e:
            return uuid, False, str(e)


async def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"

    timeout = aiohttp.ClientTimeout(total=20)
    async with aiohttp.ClientSession(headers=HEADERS, timeout=timeout) as session:
        async with session.get(f"{BASE}/api/v1/watch") as r:
            watches = await r.json()

        uuids = list(watches.keys())
        print(f"Found {len(uuids)} watches. Updating notification config...")

        sem = asyncio.Semaphore(CONCURRENCY)
        tasks = [update_watch(session, sem, uuid) for uuid in uuids]

        ok = fail = 0
        for i, coro in enumerate(asyncio.as_completed(tasks), 1):
            uuid, success, err = await coro
            if success:
                ok += 1
            else:
                fail += 1
                if err:
                    print(f"  FAIL {uuid}: {err}")
            if i % 100 == 0 or i == len(uuids):
                print(f"  [{i}/{len(uuids)}] ok={ok} fail={fail}")

    print(f"\nDone. Updated {ok}, failed {fail}")
    print(f"Webhook: https://n8n.pamelacoreypc.com/webhook/career-diffs")


if __name__ == "__main__":
    asyncio.run(main())
