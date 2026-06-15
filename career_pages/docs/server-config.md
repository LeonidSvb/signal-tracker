CAREER PAGE MONITORING — SERVER CONFIG
======================================

CHANGEDETECTION.IO
------------------
URL:        https://changedetection.pamelacoreypc.com
API key:    43a166fcf88e6ba2e512773ca8a738ff
VPS path:   /opt/compose/changedetection/docker-compose.yml
SSH:        ssh -i ~/.ssh/id_ed25519_hostinger leonid@<VPS_IP>

Docker:     2 containers — changedetection + sockpuppet-chrome
Traefik:    /data/coolify/proxy/dynamic/changedetection.yml
Workers:    FETCH_WORKERS=10

CURRENT STATE (session 2026-06-08/09):
  Tags created: career_pages, ats_pages
  Watches imported: ~1,344 careers + 1,173 ATS = 2,517 total
  Source CSVs: data/test_9999_careers_20260608_2334.csv (1479 rows)
               data/test_9999_ats_20260608_2334.csv (369 rows)
  Webhooks:   CONFIGURED -- jsons://n8n.pamelacoreypc.com/webhook/career-diffs on all 2496 watches
  Snapshots:  initial fetch still running (FETCH_WORKERS=10, ~2500 URLs)

Skip domains (test set, already in Changedetection):
  foodpartners-international.com, flandersfoodproductions.be, robovision.ai,
  icscoolenergy.com, delicia.nl, nu3.de, vegdog.de, affeldt.com,
  edmondderothschildheritage.com, hochwald.de


N8N WORKFLOW
------------
Name:     Philippe -- Career Page Signal Receiver
ID:       zI6bmINiOKy0DtOe
Status:   INACTIVE -- needs OpenRouter key before activating
Webhook:  https://n8n.pamelacoreypc.com/webhook/career-signals

Nodes:
  Webhook (career-signals) -> Extract Diff -> Build Request
  -> Call OpenRouter (gpt-4o-mini) -> Parse LLM Response
  -> Is Relevant? [IF] -> Google Sheets Append -> Telegram Alert

Google Sheet:  1JrC-Ub6bW2LUJMAW3xIaOU3mhDSLROffmdurb2fGqXU
Sheet tab:     Career Signals (needs to be created manually first)
Sheet columns: date_received | company | url | role_title | seniority |
               language | reason | diff_preview | status | notes | date_contacted

Telegram:  chat -1003720173759 / thread 3 (same as Exa signals)
Bot cred:  mnPO8CuRhgQGoDlm (Philippe Signals bot)

TODO before activating (LLM pipeline):
  1. Replace OPENROUTER_KEY_HERE in "Call OpenRouter" node with real key
  2. Create "Career Signals" tab in Google Sheet with header row
  3. Activate workflow in n8n


BULK WEBHOOK -- DONE 2026-06-09
---------------------------------
Script: scripts/update_changedetection_webhooks.py
Result: 2496/2498 watches updated (2 timeout, negligible)
Active webhook: jsons://n8n.pamelacoreypc.com/webhook/career-diffs
Notification template:
  title:   [CD] {{watch_title}}
  message: url={{watch_url}}\nuuid={{watch_uuid}}\ndiff_start\n{{diff_added_clean}}


POSTGRESQL (shared-postgres)
-----------------------------
Network:    n8n_default (connected 2026-06-09 so n8n-app can reach it directly)
Host:       shared-postgres
Port:       5432
Database:   platform
User:       app_admin
Password:   DfTwx2rVgzb53mcQcSsxbusf
Table:      public.career_diffs
Columns:    id, received_at, company, url, uuid, diff_length, diff_added
n8n cred:   w9XBNGYCwyabjWmT (shared-postgres (VPS))

WARNING: DO NOT connect n8n-app to app_net network.
Supabase has a container aliased "postgres" on app_net which hijacks
n8n's own DB host resolution and breaks n8n entirely on restart.
