# eat — Deployment

## Live URL
https://eat.sethgholson.com

## Infrastructure

### Coolify
- **Instance**: http://100.123.69.76:8000 (arbor on Tailscale)
- **API Token**: 1Password → Wilson vault → "Coolify API Key"
- **Project**: Eat (uuid: `v0kw4gog4kokck4088ok8s0g`)
- **Application**: eat (uuid: `ms80csck0cw0wwsokwk48w0w`)
- **Server**: kind-koala (Grove @ PVE2, 192.168.0.8)
- **Build pack**: **docker-compose** (`/docker-compose.yml`) — NOT Dockerfile. See volume notes.

### GitHub
- **Repo**: https://github.com/heidihowilson/eat (public)
- **Branch**: main — Coolify clones it as a public repo (no GitHub App)

### DNS / TLS
- `eat.sethgholson.com` rides the existing Cloudflare wildcard → Grove; Traefik
  routes by the fqdn set via `docker_compose_domains`. No DNS work was needed.

## Data persistence

SQLite lives in a **Coolify-managed named volume** declared in `docker-compose.yml`:
- Volume: `eat-data` mounted at `/data`; DB at `/data/eat.db` (`DB_PATH` env)
- **Proven**: smoke data survived a force-redeploy (container recreation) on 2026-06-03.

Gotchas learned the hard way (Coolify 4.0.0-beta.463):
- The `/api/v1/applications/{uuid}/storages` endpoint **does not exist** on this
  version (404). That's why this app uses the compose build pack — compose-declared
  volumes are honored.
- The compose volume must **NOT** be `external: true` — Coolify won't auto-provision
  an external volume and the deploy fails. It's a plain named volume.
- `custom_docker_run_options: -v ...` silently does NOT mount volumes here. Never rely on it.
- Compose-pack apps reject the `domains` field on create; set the domain via
  `docker_compose_domains` (array, per-service) instead.
- The envs API field is `is_buildtime` (no underscore between build and time).

## Environment variables (set in Coolify)
| Key | Value |
|-----|-------|
| DB_PATH | /data/eat.db |
| PORT | 8000 |
| SESSION_SECRET | random 32-byte hex (in Coolify env vars) |

## Deploying

Push to `main`, then trigger:
```bash
COOLIFY_TOKEN=$(op item get 'Coolify API Key' --vault Wilson --format json --reveal | jq -r '.fields[] | select(.id=="notesPlain") | .value')
curl -s "http://100.123.69.76:8000/api/v1/deploy?uuid=ms80csck0cw0wwsokwk48w0w&force=true" \
  -H "Authorization: Bearer $COOLIFY_TOKEN"
# poll:
curl -s "http://100.123.69.76:8000/api/v1/applications/ms80csck0cw0wwsokwk48w0w" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" | jq '{status, fqdn}'
```

## Health check
- `GET /health` → `OK` (no auth)

## PoC deviations from spec (workarounds log)

1. **Auth: email+password instead of Google SSO** (REQUIREMENTS R1.1).
   A Google OAuth client can't be created non-interactively (needs Google Cloud
   Console consent). The PoC ships scrypt password auth with HMAC session cookies;
   `users.google_id` is a nullable unique column and `createUser` accepts it, so
   SSO is an additive change. To restore the spec: create an OAuth client in
   Google Cloud Console, add `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` env vars,
   and wire the OAuth routes in `app/controllers/auth-controller.tsx`.
2. **All POSTs require a same-origin `Origin` header** (CSRF guard). Fine for
   browsers; API/scripted access must send `Origin: https://eat.sethgholson.com`.

## Database access (break glass)

Via jump host (PVE1 → grove), exec into the container:
```bash
ssh root@192.168.0.94 "ssh grove@192.168.0.8 'sudo docker ps --filter name=eat-ms80csck'"
# better-sqlite3 scripts must use .cjs (app is type:module) and run from /app
```

## Verified 2026-06-03 (production smoke test)
Signup → create household → idea → plan slot → one-tap unplanned takeout
(counter 1/2) → grocery add/check → kid invite → kid join via link → kid 403 on
/settings and on mutating POSTs → force-redeploy → all data survived → fresh
login OK. Smoke data was removed from the prod DB afterward.
