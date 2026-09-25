# VPS migration preparation — NOT approved for execution

2026-09-14. Host: 43.228.86.7. This plan supersedes the old automatic-install runbook. Docker has not been built/tested on this workstation (Docker unavailable). Do not run a production migration yet.

## Preflight result — 2026-09-25 (owner ran `deploy/preflight.sh` as root)

Ubuntu 24.04.5, x86_64, 4 CPU, 5.9 GB RAM (~4.8 GB available), **no swap**, 45 GB free disk. Docker 29.8.1 + Compose v5.5.1 already installed. **Host nginx owns 80/443** and fronts other services: `ai-reels-factory` containers on 127.0.0.1:8080/8081, something on 127.0.0.1:5000, `rorebuild` (Ragnarok game server), fail2ban. Pending "System restart required" — not needed for this install; schedule separately since other services run here.

Decision: integrate with host nginx, not Caddy — `deploy/docker-compose.host-nginx.yml` (Caddy off, api/web on loopback 4100/3100, per-container memory caps) + `deploy/nginx-fbpm.conf` + certbot. Add 4 GB swap and build images one at a time before first start. Fresh install (no data migration) unless the owner reports real data on the Windows instance.

## Required preflight

Execute `bash deploy/preflight.sh` on the VPS through an approved SSH profile. It only reports OS/architecture, CPU count, memory/swap, disk/inodes, listening ports, running service names and Docker resource inventory. It does not install, restart, prune, inspect environment variables or print service arguments. Verify SSH host fingerprint out of band if not already trusted. Never paste the private key/password into chat.

Record actual available resources and existing reverse proxy/services. Choose a dedicated installation directory and Compose project name. Decide whether to integrate with the existing proxy or use Caddy; do not take ports 80/443 from another service. Confirm DNS, HTTPS and exact OAuth callbacks before deployment. Do not finalize container memory limits until headroom is measured. Prefer building images outside a busy 6 GB production host and importing/pulling pinned artifacts.

## Backup and migration sequence for final approval

1. Inventory existing workspaces, clients, account IDs, content state counts, scheduled/in-flight jobs, schema migration versions and media size without exporting secret values into reports.
2. Announce a maintenance window; stop only this application's writes/workers for a consistent database+media backup. Do not stop unrelated VPS services. Reconcile existing IN_FLIGHT/UNKNOWN operations and scheduled jobs before enabling a restored worker.
3. Take a PostgreSQL custom-format dump and copy media preserving paths. Save an encrypted off-host copy; retain checksum manifest and timestamp. Back up AUTH_SECRET and provider configuration separately through a secure secret store. A database backup without the original encryption secret cannot decrypt stored tokens.
4. Restore into a new isolated test database/volume, with no live worker, webhook or outbound credentials. Check row counts, account/brand ownership, media references, decryptability without printing tokens, approval history and pending/ambiguous operation states. Do not restore a raw Redis queue into active production; reconcile durable scheduled jobs deliberately.
5. Build and test the migration image. Run only its pinned Prisma `migrate deploy` against the restored test DB. Preserve the original backup. No destructive/down migration is planned.
6. Test API/web authentication and one Facebook fixture workflow. Confirm server-side secrets, no mock data shown as live account performance, no sending/replayed jobs and encrypted backups recover correctly.
7. Present actual preflight evidence, domain, resource limits, image identifiers, volumes, migration results, backup recovery results and a cutover/rollback schedule to the owner for **final deployment approval**.
8. Only after approval: restore/migrate the dedicated production database, start API/web/proxy, verify health and HTTPS. Enable the automation profile only after reviewing queued jobs and authorization for their effects. A real Facebook publish requires separate owner approval.

## Prepared Compose behavior

`docker-compose.yml` now fails when database password, encryption secret or domain is absent. Use a URL-safe strong database password or correctly URL-encode it in a separately configured connection URI; current interpolation expects URL-safe characters. Never run `docker compose config` with real secrets into shared logs.

- `migrate` is a one-shot service under the `maintenance` profile, using the API Dockerfile's migrate target. Migration is no longer implicit in API startup.
- `worker` is under the `automation` profile and is not started by a default up command. This is not a blanket block on interactive API writes or paid AI calls.
- Postgres/Redis have no host port mappings. Media, database, Redis and Caddy state have separate volumes.
- No final RAM/CPU policy has been set: await host preflight. No deployment command has been executed.

## Rollback

Keep the pre-cutover source/image version and database/media backups. Stop only SocialManage traffic/writes and worker, then restore into new volumes and switch the dedicated project to the known-good set after review. Do not delete or overwrite the failed volumes; retain them for investigation. Do not run `docker compose down -v`, database drops or Docker prune. Never roll back the encryption secret independently of its encrypted data.

Outstanding: executable backup/restore tooling, image build/run verification, full restore rehearsal, monitoring/log rotation and finalized resource limits. This document is a reviewable preparation plan, not a claim of deployment readiness.
