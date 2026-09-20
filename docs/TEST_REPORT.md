# Test report — latest verification 14 September 2026

## 14 September 2026 — Facebook safety and VPS preparation phase

- Full build, typecheck and lint: PASS (`phase1-build.log`, `phase1-typecheck.log`, `phase1-lint.log`; local ignored logs).
- Full unit/integration run: **253 passed**, using local PostgreSQL/Redis and external-service mocks. Breakdown: shared 11, AI 12, email 4, Facebook 13, TikTok 10, YouTube 11, Messenger 7, website 9, API 160, worker 16. Evidence: `phase1-tests.log`.
- Full browser run: **11 passed** with mock external endpoints. Evidence: `phase1-e2e.log`.
- Focused changed workflow suite: **35 passed** (content 13 + Messenger 22). New cases cover concurrent publish requests, no repeated write after a lost response, title edits requiring approval, and default Messenger DRAFT/HUMAN handoff with zero sends/recovery replay.
- The older caption-match duplicate recovery test was replaced: matching text is insufficient evidence to claim a Facebook post. Legacy ambiguous attempts now stop for reconciliation.
- Deployment preflight Bash syntax: PASS. Static Dockerfile direct workspace dependency inclusion check: PASS. **Docker image builds, container startup, VPS host inspection and backup restore rehearsal: NOT RUN.** Docker is not installed locally; approved SSH username/profile and host facts are not yet known.
- First focused test attempt failed because local PostgreSQL/Redis were stopped. PostgreSQL recovery succeeded, but the launcher incorrectly treated a null detached-process ExitCode as a failure. Readiness check corrected; services started; focused and full reruns passed. The modified cold-start branch has not been retested by stopping the recovered database.
- No real platform API tests, customer messages, posts, paid AI calls or deployment performed. No MCP implementation/ChatGPT connection test yet. Meta official documentation retrieval was rate-limited; current permission review remains pending.

See [SOCIALMANAGE_HANDOFF.md](SOCIALMANAGE_HANDOFF.md) for the current scope and remaining gates. Historical reports below describe their original dates and behavior.

## Update — 11 September 2026: Messenger AI

Added automatic Page-scoped Messenger replies with a separate encrypted OpenAI key/model, brand-grounded conversation context, explicit Page enablement, human takeover, durable webhook deduplication, bounded response windows, daily AI call reservations and recovery without resending unknown external operations. See [MESSENGER.md](MESSENGER.md).

Current full regression: **249 unit/integration passed** (shared 11, AI core 12, email 4, Facebook 13, TikTok 10, YouTube 11, web 9, Messenger 7, API 156, worker 16). **11 browser tests passed in one full run**, including the new Messenger UI → signed webhook → actual BullMQ worker → local Meta fixture flow and a visually inspected 390 px mobile screenshot. Build, typecheck and lint passed. Additive migration `20260911060000_messenger` applied to local and test DBs.

The first full regression run encountered the existing YouTube PDF case's 5-second timeout while other checks were running; its subsequent isolated 20-test run and the complete 249-test rerun passed without changing YouTube code. New Messenger integration tests first exposed an unsupported PostgreSQL `void` result from advisory-lock SQL; casting the result to text fixed this before the passing runs. Fixed the local Windows launcher to read historical nested process manifests so managed apps stop correctly for Prisma client generation. The shared AI HTTP deadline now covers the response body as well as headers, with a stalled-body regression test.

Evidence: `messenger-final-tests.log`, `messenger-e2e.log`, `messenger-build.log`, `messenger-typecheck.log`, `messenger-lint.log`. External API calls were local fixtures only. Live Messenger/OpenAI validation remains **BLOCKED_BY_CREDENTIALS** and Meta permission verification. The following sections preserve the September 8 audit history.

## Environment and scope

Windows local execution from `C:\Work\SocialManage\fbpage`, Node 22.19.0, pnpm 10.33.0, PostgreSQL 16.14 and Redis 7.4.9. The original `fbpagesource.zip` was retained. Migrations were applied to fresh `fbpm_local` and isolated `fbpm_test` databases. Test queue clients use Redis DB 1; the running local app uses DB 2.

All external platform calls in automated tests target local HTTP fixtures. There were no real TikTok/Facebook/YouTube posts, real email deliveries to customers, WordPress writes to real sites or paid AI calls.

## Results

| Check | Result |
|---|---|
| pnpm install / lockfile | PASS; TikTok workspace links and lockfile updated |
| Additive Prisma migration | PASS on local and test DB; no table/column drops |
| pnpm build | PASS: packages, Nest API, worker and Next production routes including `/tiktok` |
| pnpm typecheck | PASS |
| pnpm lint | PASS |
| Shared unit tests | 11 passed |
| AI core | 11 passed |
| Email core | 4 passed |
| Facebook core | 13 passed |
| TikTok core | 10 passed |
| YouTube core | 11 passed |
| Web core | 9 passed |
| API unit/integration | 135 passed, including 15 TikTok integration cases |
| Worker integration/unit | 16 passed |
| Total unit/integration | **220 passed** |
| Playwright browser tests | **10 passed**: 8 existing flows + 2 TikTok flows |
| Local API health / login page | HTTP 200 / HTTP 200 |
| Local worker | Started successfully with `tiktok` and existing queues |

Database package has no standalone unit cases; its schema is exercised through integration tests. Web package's placeholder test command contributes no cases; browser coverage is counted separately.

## TikTok evidence

Core adapter tests cover official authorization URLs, requested scopes, sanitized failures, read retries, no retry on uncertain initialization, nullable metrics, median/rate calculations and verified media-prefix boundaries.

API tests use real Nest routing, PostgreSQL and Redis with a mock TikTok server. They cover:

1. Tenant isolation, tampered state, another session, state replay and encrypted token storage without credential exposure.
2. Permission revocation between connect and callback, missing permission and expired state.
3. Concurrent refresh only once, refresh-token rotation, multi-page imports and idempotent video upserts with null metrics.
4. Saved studio output through the shared Gemini adapter and rejection of invented evidence video IDs.
5. Required human review, platform-specific approval, disabled uploads with zero external writes, and editing invalidating approval.
6. Account pause, workspace kill switch, concurrent upload claim, Inbox delivery distinct from publication, and inability to edit during dispatch.
7. Date/timezone validation, actual delayed Redis job, future delivery rejection, stale job rejection after edit, and cross-tenant resource checks.
8. Expired refresh credentials requiring reconnect, then restoration through another OAuth grant.
9. Recovery after worker interruption into RECONCILIATION_REQUIRED without repeating the external write.
10. Unknown upload outcome preventing retries, disconnect/revoke and removal of stored secrets.

The browser test exercises registration, TikTok navigation/empty state, session-bound callback, connected profile, sync, video library with missing metrics, manual draft, human review, approval, disabled send button and absence of credential text. No browser runtime errors were observed. Visual screenshot inspected at `test-results/tiktok-studio.png` (generated artifact, excluded from source ZIP).

## Existing-module regressions fixed during verification

- Windows package filters and environment loading; empty optional URL variables.
- Installed Chrome/Edge discovery and isolated headless rendering for PDF/media. Existing PDF integration tests pass on this machine.
- SMTP test waiting for actual receipt rather than a fixed 300 ms sleep.
- UTC Date handling in the old YouTube stale-upload fixture on a Thai-timezone PostgreSQL server.
- Redis logical-DB selection in test fixtures and the production Facebook webhook queue; webhook uses the existing connection parser including TLS and closes on shutdown.

Earlier failures were investigated and repaired; final results above supersede both the archive's historical report and intermediate logs. Logs remain local and ignored: `final-build.log`, `final-typecheck.log`, `final-lint.log`, `final-tests.log`, `worker-final-tests.log`, `final-e2e.log`.

## Follow-up: brand drafts before credentials

Added four integration cases without TikTok or Gemini credentials: brand-owned draft creation with no synthetic account, tenant/brand-scoped TXT export and source list, human approval with dispatch blocked, and same-brand account assignment with role checks and approval expiry. One additional shared-Gemini fixture case validates brand-level studio generation without selecting a TikTok account and a persisted source relation. These bring API coverage to 135 tests and overall unit/integration coverage to 220.

The additional browser flow prepares and approves an unconnected brand draft, downloads and verifies Thai UTF-8 text, checks a 390-pixel viewport without horizontal overflow, then connects through the mock OAuth server and assigns the account, requiring review/approval again. The generated mobile screenshot was inspected. Eight existing flows passed in the full browser run; both TikTok flows passed in the targeted rerun after correcting a test selector to use the accessible combobox role. No production change was needed for that selector correction.

Migration `20260908110000_tiktok_offline_drafts` was applied successfully to both local and test databases and backfilled existing account-owned drafts. Build, typecheck and lint passed. Local PostgreSQL/Redis had stopped since the prior session; services were restored and database recovery completed before final verification. Added `scripts/local.ps1 services` for opening infrastructure separately from the app, and redirected the PostgreSQL launcher to prevent inherited console streams from holding the launcher open.

Latest evidence: `offline-migrations.log`, `offline-build.log`, `offline-all-tests.log`, `offline-api-tests.log`, `offline-e2e.log`, `offline-tiktok-e2e.log`, `offline-typecheck.log`, `offline-lint.log`. Intermediate attempts while infrastructure was stopped are superseded by the successful runs described above.

## Remaining verification / MVP limitations

| Area | State / reason |
|---|---|
| Real TikTok OAuth/profile/video sync | **BLOCKED_BY_CREDENTIALS**: developer client key/secret, registered HTTPS callback and granted scopes needed |
| Real TikTok Inbox upload | **BLOCKED_BY_CREDENTIALS / PLATFORM_APPROVAL**: video.upload access, creator grant and verified public media domain needed; sending remains disabled |
| Real Gemini generation/analysis | **BLOCKED_BY_CREDENTIALS**: Google AI Studio API key and accessible model needed |
| Real existing-platform integrations | Not revalidated against real accounts; local mock regressions passed |
| Direct Post, desktop file upload, signed media URLs | Outside this MVP; only verified public HTTPS MP4 pull-to-Inbox is implemented |
| Public posting schedule | Not guaranteed by Inbox API; creator posts manually in TikTok |
| Historical/advanced analytics | Recent public video snapshots only; unavailable metrics remain null, mixed-age limitations disclosed |
| Ambiguous upload recovery | Visible uncertain state, no blind retry; operator must inspect TikTok before creating another draft |

The code and local workflow are implemented and tested. This report does not claim that the app has passed TikTok review, has live credentials, or has been deployed to production.
