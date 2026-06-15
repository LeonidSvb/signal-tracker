import asyncio
import aiohttp
import csv
import random
import sys
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup

BASE_DIR = Path(__file__).parent.parent
SOURCE_CSV = BASE_DIR.parent.parent / "1_filtering" / "companies_pass.csv"
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

PATHS_BY_COUNTRY = {
    "FR": [
        "/carrieres", "/recrutement", "/nous-rejoindre", "/offres-emploi", "/emploi",
        "/offres", "/nos-offres", "/rejoignez-nous", "/travailler-avec-nous",
        "/postuler", "/candidature", "/jobs", "/careers",
        "/notre-equipe/recrutement", "/a-propos/recrutement",
    ],
    "DE": [
        "/karriere", "/jobs", "/stellenangebote", "/stellen", "/arbeiten-bei-uns",
        "/offene-stellen", "/freie-stellen", "/jobangebote", "/jobs-karriere",
        "/stellenmarkt", "/karriere/jobs", "/careers",
    ],
    "NL": [
        "/vacatures", "/werken-bij", "/carriere", "/jobs", "/careers",
        "/openstaande-vacatures", "/werkenbij", "/over-ons/vacatures",
        "/jobs-en-carriere", "/vacature",
    ],
    "BE": [
        "/vacatures", "/carrieres", "/recrutement", "/jobs", "/werken-bij",
        "/careers", "/offres-emploi", "/offene-stellen", "/vacature",
    ],
    "CH": [
        "/karriere", "/carrieres", "/jobs", "/stellenangebote", "/recrutement",
        "/offene-stellen", "/careers", "/arbeiten-bei-uns",
    ],
    "AT": [
        "/karriere", "/jobs", "/stellenangebote", "/stellen", "/careers",
        "/offene-stellen", "/freie-stellen", "/jobangebote",
    ],
    "default": [
        "/careers", "/jobs", "/join-us", "/work-with-us", "/opportunities",
        "/open-positions", "/hiring", "/job-offers", "/job-openings",
        "/about/careers", "/company/careers",
    ],
}

ATS_SUBDOMAINS = ["jobs", "careers", "recrutement", "karriere", "vacatures", "apply", "talent"]

ATS_PLATFORMS = [
    "greenhouse.io", "lever.co", "workday.com", "myworkdayjobs.com",
    "bamboohr.com", "teamtailor.com", "welcometothejungle.com",
    "recruitee.com", "jobvite.com", "smartrecruiters.com",
    "personio.de", "softgarden.de", "softgarden.io",
    "jobteaser.com", "talentsoft.com",
    "icims.com", "taleo.net", "successfactors.eu", "successfactors.com",
    "onlyfy.com", "prescreen.io", "join.com",
    "rexx-systems.com", "umantis.com",
    "hr4you.de", "erecruiter.net", "carerix.com",
]

CAREER_LINK_RE = re.compile(
    r"\bcareers?\b|\bjobs?\b|\brecruit|\bcarrieres?\b|\brecrutement\b"
    r"|\bemploi\b|\boffres?\b|\bkarriere\b|\bvacatur|\bwerken\b"
    r"|\brejoindre\b|\bstellen\b|\btalent\b|\bstellenangebote\b"
    r"|\boffene\b|\bjobangebote\b|\bwerkenbij\b",
    re.IGNORECASE
)

TIMEOUT = aiohttp.ClientTimeout(total=8)
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
CONCURRENCY = 40


def load_companies(n=None, domains=None):
    rows = []
    with open(SOURCE_CSV, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("domain"):
                rows.append(row)
    if domains:
        domain_set = set(d.strip().lower() for d in domains)
        return [r for r in rows if r["domain"].strip().lower() in domain_set]
    random.seed(42)
    return random.sample(rows, min(n, len(rows)))


def domain_to_url(domain):
    domain = domain.strip().lower().rstrip("/")
    if not domain.startswith("http"):
        domain = "https://" + domain
    return domain


async def check_url(session, url):
    try:
        async with session.head(url, allow_redirects=True, ssl=False) as r:
            if r.status == 405:
                async with session.get(url, allow_redirects=True, ssl=False) as r2:
                    return r2.status, str(r2.url)
            return r.status, str(r.url)
    except Exception:
        return None, None


async def fetch_homepage(session, base_url):
    try:
        async with session.get(base_url, allow_redirects=True, ssl=False) as r:
            if r.status == 200 and "text/html" in r.headers.get("content-type", ""):
                return await r.text(errors="ignore")
    except Exception:
        pass
    return None


async def probe_paths(session, base_url, country):
    paths = PATHS_BY_COUNTRY.get(country, PATHS_BY_COUNTRY["default"])
    if country not in PATHS_BY_COUNTRY:
        paths = PATHS_BY_COUNTRY["default"]

    for path in paths:
        url = base_url.rstrip("/") + path
        status, final_url = await check_url(session, url)
        if status and 200 <= status < 400:
            return url, final_url, "path_probe"
    return None, None, None


async def crawl_homepage(session, base_url, html):
    if not html:
        return None, None
    try:
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup.find_all("a", href=True):
            href = tag["href"].strip()
            text = tag.get_text(strip=True)
            if CAREER_LINK_RE.search(href) or CAREER_LINK_RE.search(text):
                full = urljoin(base_url, href)
                parsed = urlparse(full)
                base_parsed = urlparse(base_url)
                if parsed.netloc == base_parsed.netloc or parsed.netloc.endswith("." + base_parsed.netloc):
                    status, final_url = await check_url(session, full)
                    if status and 200 <= status < 400:
                        return full, final_url
    except Exception:
        pass
    return None, None


async def check_sitemap(session, base_url):
    for sitemap_url in [base_url.rstrip("/") + "/sitemap.xml", base_url.rstrip("/") + "/sitemap_index.xml"]:
        try:
            async with session.get(sitemap_url, allow_redirects=True, ssl=False) as r:
                if r.status == 200:
                    text = await r.text(errors="ignore")
                    urls = re.findall(r"<loc>(https?://[^<]+)</loc>", text)
                    for url in urls:
                        if CAREER_LINK_RE.search(url):
                            status, _ = await check_url(session, url)
                            if status and 200 <= status < 400:
                                return url
        except Exception:
            pass
    return None


async def check_ats(session, base_url, domain, html):
    results = []
    bare_domain = domain.lstrip("www.").strip()

    for sub in ATS_SUBDOMAINS:
        url = f"https://{sub}.{bare_domain}"
        status, final_url = await check_url(session, url)
        if status and 200 <= status < 400:
            results.append({"ats_url": url, "platform": f"subdomain:{sub}", "method": "ats_subdomain"})

    if html:
        try:
            soup = BeautifulSoup(html, "html.parser")
            for tag in soup.find_all("a", href=True):
                href = tag["href"].lower()
                for platform in ATS_PLATFORMS:
                    if platform in href:
                        results.append({"ats_url": tag["href"], "platform": platform, "method": "ats_platform_link"})
                        break
        except Exception:
            pass

    seen = set()
    deduped = []
    for r in results:
        if r["ats_url"] not in seen:
            seen.add(r["ats_url"])
            deduped.append(r)
    return deduped


async def process_company(session, company, sem):
    async with sem:
        domain = company["domain"].strip()
        country = company.get("hq_country_code", "").upper().strip()
        name = company.get("name", domain)
        base_url = domain_to_url(domain)

        homepage_html = await fetch_homepage(session, base_url)

        path_url, path_final, path_method = await probe_paths(session, base_url, country)
        crawl_url, crawl_final = None, None
        sitemap_url = None
        if not path_url and homepage_html:
            crawl_url, crawl_final = await crawl_homepage(session, base_url, homepage_html)
        if not path_url and not crawl_url:
            sitemap_url = await check_sitemap(session, base_url)

        careers_url = path_url or crawl_url or sitemap_url
        careers_method = (path_method if path_url else
                          "homepage_crawl" if crawl_url else
                          "sitemap" if sitemap_url else None)

        ats_results = await check_ats(session, base_url, domain, homepage_html)

        return {
            "company": name,
            "domain": domain,
            "country": country,
            "careers_url": careers_url,
            "method": careers_method,
            "ats": ats_results,
        }


async def main(n=100, retry_domains=None):
    label = "retry" if retry_domains else str(n)
    companies = load_companies(n=n, domains=retry_domains)
    total = len(companies)
    print(f"Loaded {total} companies — starting discovery...")

    sem = asyncio.Semaphore(CONCURRENCY)
    connector = aiohttp.TCPConnector(limit=CONCURRENCY, ssl=False)
    async with aiohttp.ClientSession(headers=HEADERS, timeout=TIMEOUT, connector=connector) as session:
        tasks = [process_company(session, c, sem) for c in companies]
        results = []
        for i, coro in enumerate(asyncio.as_completed(tasks), 1):
            r = await coro
            results.append(r)
            status = r["careers_url"] or ("ATS:" + r["ats"][0]["platform"] if r["ats"] else "not found")
            print(f"  [{i:3d}/{total}] {r['domain'][:40]:<40} {status}")

    ts = datetime.now().strftime("%Y%m%d_%H%M")
    careers_file = DATA_DIR / f"test_{label}_careers_{ts}.csv"
    ats_file = DATA_DIR / f"test_{label}_ats_{ts}.csv"

    with open(careers_file, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["company", "domain", "country", "careers_url", "method"])
        w.writeheader()
        for r in results:
            if r["careers_url"]:
                w.writerow({k: r[k] for k in ["company", "domain", "country", "careers_url", "method"]})

    with open(ats_file, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["company", "domain", "country", "ats_url", "platform", "method"])
        w.writeheader()
        for r in results:
            for ats in r["ats"]:
                w.writerow({"company": r["company"], "domain": r["domain"], "country": r["country"], **ats})

    found_careers = sum(1 for r in results if r["careers_url"])
    found_ats = sum(1 for r in results if r["ats"])
    found_any = sum(1 for r in results if r["careers_url"] or r["ats"])
    not_found = total - found_any

    print(f"\n--- RESULTS ({total} companies) ---")
    print(f"  own careers page found : {found_careers} ({found_careers/total*100:.0f}%)")
    print(f"  ATS platform found     : {found_ats} ({found_ats/total*100:.0f}%)")
    print(f"  any signal found       : {found_any} ({found_any/total*100:.0f}%)")
    print(f"  nothing found          : {not_found} ({not_found/total*100:.0f}%)")
    print(f"\n  careers saved -> {careers_file.name}")
    print(f"  ats saved     -> {ats_file.name}")


if __name__ == "__main__":
    if "--retry" in sys.argv:
        domains = sys.argv[sys.argv.index("--retry") + 1].split(",")
        asyncio.run(main(retry_domains=domains))
    else:
        n = int(sys.argv[1]) if len(sys.argv) > 1 else 100
        asyncio.run(main(n=n))
