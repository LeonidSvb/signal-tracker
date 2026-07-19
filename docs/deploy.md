# Deploy — Signal Tracker (philippe.pamelacoreypc.com)

## Real deploy path (Coolify auto-deploy — the ONLY path)

```
git push origin main
```

That's it. Coolify on the VPS (152.53.194.162) watches the GitHub repo
`LeonidSvb/signal-tracker` and on every push to `main`:

1. Builds the **root `Dockerfile`** (build context = repo root — it must be the
   root, because the image needs `pipeline/config/*.json` copied in as a sibling
   of `/app`; see the comment in the Dockerfile).
2. Replaces the container `jjqqckwic2ow6nyu3tok8xu8-*` (Coolify project
   `signal-tracker`, applicationId 4).
3. Traefik (the `coolify-proxy` container) routes
   `philippe.pamelacoreypc.com` → container port 3000, TLS via letsencrypt.

Env vars (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / CLIENT_SLUG as build ARGs,
SUPABASE_SERVICE_ROLE_KEY at runtime) live in Coolify's env store for this app —
not in the repo.

## How to verify which commit is live

The image tag IS the git commit SHA it was built from:

```
ssh -i ~/.ssh/id_ed25519_hostinger leonid@152.53.194.162 \
  "docker ps --filter name=jjqqckwic2ow6nyu3tok8xu8 --format '{{.Image}}\t{{.Status}}'"
# compare the tag against:  git log -1 --format=%H
```

If the tag lags your push by more than ~3-4 minutes, the Coolify build likely
failed — check the deployment log in the Coolify UI.

## History: the dead systemd path (removed 2026-07-19)

There USED to be a second deploy path: `scripts/deploy.ps1` → scp →
`/opt/apps/signal-tracker` → `systemctl restart signal-tracker` on port 3099.
**That service never served the public domain** (Traefik always routed to the
Coolify container), so deploying through it updated a server nobody was hitting
while the real container stayed on old code. Exactly this cost ~40 minutes of
confusion on 2026-07-19 (same incident class as outreach-cockpit's documented
"orphaned container", docs/deploy.md there, 2026-07-07).

Removed on 2026-07-19: the script, `nextjs/Dockerfile` (a dead duplicate whose
`nextjs/`-only build context physically couldn't copy `pipeline/config/` — the
ancestor of the /api/copy 500 bug), the systemd unit, and
`/opt/apps/signal-tracker` + `/opt/apps/pipeline` on the VPS.
`/opt/apps/projects/philippe-signals-pipeline/` (the live cron pipeline copy) is
unrelated and untouched.

If Coolify ever dies: build the root Dockerfile anywhere, run it with the env
vars above, point Traefik/any proxy at port 3000. No special script needed.

## Known debt

- The old `scripts/deploy.ps1` embedded the VPS sudo password and the Supabase
  service-role key in plaintext; both remain in git history even after deletion.
  Sudo password rotation: pending. Service-role key rotation (self-hosted
  Supabase, more involved): pending, tracked as debt.
