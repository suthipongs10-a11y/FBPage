# Repository audit — 2026-09-08

Source: `../fbpagesource.zip`, extracted without overwriting existing work. The supplied status note reports commit `6a0d68e`; the archive has no Git history, so that commit and its historical test results cannot be independently verified. A local repository was initialized to keep subsequent changes separate from the unrelated parent repository.

## System overview

Existing pnpm 10.33 / Node 22 TypeScript monorepo: Next.js 16 frontend (3000), NestJS 12 REST API (4000), PostgreSQL / Prisma 6, Redis / BullMQ scheduler. Preserve this architecture. Local media lives in MEDIA_DIR; S3 variables are placeholders, not evidence of an implemented S3 service. Docker Compose also contains Caddy and production-facing services; none were deployed.

## Existing modules

| Module | Implemented in source | External APIs / persistence | Verification limits |
|---|---|---|---|
| Facebook | OAuth and manual token connection, page discovery, post/metric/comment sync, content generation, approval, publishing/scheduling, leads, reports, signed webhooks | Meta Graph configurable version; FacebookConnection/Page/Post, PostMetricSnapshot, shared ContentItem/ApprovalRequest/ExternalOperation | Live permissions, token expiry and Graph version compatibility require real account tests; no real publishing performed |
| YouTube | Google OAuth, public channel lookup, profile/video/analytics/comment/playlist sync, Content Lab, resumable upload, quota tracking, repurposing | Data API v3 and Analytics API; GoogleConnection, YouTubeChannel/Video and metric snapshots, metadata, upload operations | OAuth verification/upload audit and real credentials unavailable; Live is reserved, not implemented |
| Website | Uptime, SSL, homepage SEO, crawling, PageSpeed, Search Console, AI SEO analysis, article drafts and approved WordPress publishing | Site/Check/Incident, SearchSnapshot, WebContentMetadata, shared content/approvals | WordPress, Google and PageSpeed calls require credentials; Shopify/Wix publishing absent |
| Email | Consent lists, unsubscribe, campaigns, approved Brevo/Resend delivery and webhook metrics | EmailProviderAccount/List/Subscriber/Campaign/Send/Event | No actual delivery tested |

## Shared core

User/session authentication, workspace membership with additive permissions and seven roles, Client → Brand ownership, knowledge library, media storage, content revisions, approvals, calendar, notifications/audit, AI Gateway and scheduled jobs already exist. Shared content is platform-tagged but several mutation paths remain Facebook-specific. TikTok must use its own guarded mutation handlers while joining shared read views, rather than passing through Facebook publishing.

AI already has Gemini, OpenAI, Anthropic and compatible adapters. AiGatewayService resolves models by workspace role, retrieves encrypted BYOK or environment keys, checks budgets, logs usage, and validates/retries structured output. No replacement AI architecture is required. Real Gemini status is BLOCKED_BY_CREDENTIALS; provider protocol can be tested using mocks.

## Database and authentication

Prisma schema contains 59 existing models with explicit SQL migrations. Workspace → Client → Brand scopes platform resources; content references Page, YouTubeChannel or Site. Sessions use an HTTP-only cookie and server-side session lookup. TenantGuard checks membership, active workspace and permissions. Token encryption uses AUTH_SECRET; never rotate it casually because historical secrets need the same key. OAuth flows use signed states; TikTok will additionally persist a single-use state bound to the initiating browser/session and recheck permission on callback.

## Environment variables

All entries below existed in `env.example` at inspection (values deliberately omitted).

| Variables | Required | Module | In example |
|---|---|---|---|
| DATABASE_URL, REDIS_URL, AUTH_SECRET | Yes | Runtime | Yes |
| APP_ENV, APP_URL, API_URL, API_PORT, WEB_PORT, DEFAULT_TIMEZONE | Defaults | Runtime | Yes |
| META_APP_ID, META_APP_SECRET, META_OAUTH_REDIRECT_URI, META_WEBHOOK_VERIFY_TOKEN | OAuth/webhook only | Facebook | Yes |
| META_GRAPH_API_VERSION | Default | Facebook | Yes |
| GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, YOUTUBE_API_KEY | Connected features | YouTube/Google | Yes |
| YOUTUBE_UPLOAD_ENABLED, YOUTUBE_DEFAULT_SYNC_DAYS, YOUTUBE_QUOTA_SOFT_LIMIT | Defaults | YouTube | Yes |
| GOOGLE_AI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY, LITELLM_BASE_URL, LITELLM_API_KEY | One provider or BYOK | AI | Yes |
| MEDIA_DIR, CHROME_BIN | Storage/rendering | Media | Yes |
| PAGESPEED_API_KEY, WEB_PUBLISH_ENABLED, WEB_WP_ALLOW_INSECURE | Optional | Website | Yes |
| SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE, SMTP_ALLOW_INSECURE | Optional | Notifications | Yes |
| EMAIL_SEND_ENABLED | Default false | Email | Yes |
| *_MOCK_BASE_URL, META_GRAPH_BASE_URL, WEB_ALLOW_PRIVATE_TARGETS | Test only | Test infrastructure | Yes |
| S3_*, DOMAIN, APP_PUBLIC_API_URL, POSTGRES_PASSWORD | Deployment/examples | Infrastructure | Yes |

## Problems found and repair order

1. **HIGH / P0** Windows build returns success while building nothing: package scripts use single-quoted pnpm filters, which Windows cmd passes literally. Web dev/start also use unsupported POSIX parameter expansion. Replace with portable launchers/filter quoting.
2. **HIGH / P0** Root `.env` is not loaded by Nest/worker dev scripts. Document and implement a shared launcher. Blank optional mock URL variables in the supplied example fail Zod `.url()` validation; preprocess blank values.
3. **HIGH / P1 environment** No existing PostgreSQL/Redis/Docker service found on this machine. Use isolated local development services and a fresh database; never modify another project's DB. Existing Compose does not expose DB/Redis ports for host development; provide a localhost-only Compose file.
4. **MEDIUM** Baseline typecheck fails before generated Prisma client/package builds. Install → generate → build packages → validate is the required order.
5. **MEDIUM** Generic content mutations can see multiple platforms although their policies/publishers are Facebook-specific. Isolate mutations before adding TikTok to shared tenant scope.
6. **MEDIUM** `.gitignore` lacks `*.log`/`build` and excludes `.env.example`; fix the example exception and log protection.
7. **MEDIUM** The archive's prior success report is not current-machine evidence. Record fresh build/typecheck/lint/test/runtime results separately in TEST_REPORT.md.

## Audit execution / checkpoint

Source, modules, API guards, Prisma models, migrations, queues, AI adapter, tests, CI, frontend and environment inspected. Frozen-lockfile install attempted; baseline build/typecheck/lint/tests/start attempted. Initial build was a false positive (no matching projects) and initial typecheck failed without generated Prisma output. Remaining execution results and repairs are recorded in TEST_REPORT.md. No platform credentials were provided. No API success is claimed from static inspection.

Proceed with runtime repairs first. TikTok development may proceed after local/mock baseline validation; real Gemini/OAuth verification stays explicitly blocked by credentials rather than requiring a replacement provider or fabricated results.

## Follow-up findings and repairs

- Windows PDF/image rendering did not discover installed Chrome/Edge. Added Windows binary discovery, file-URL conversion and isolated temporary headless profiles; retained Linux lookup.
- SMTP integration test used a fixed 300 ms delay. Replaced it with bounded polling for actual message receipt.
- The YouTube worker stale-upload fixture used PostgreSQL `NOW()` against a timezone-less timestamp. This was wrong on a database configured in Asia/Bangkok. The fixture now binds a JavaScript UTC Date.
- Several test queue clients ignored the Redis logical DB in REDIS_URL. Corrected their connections. This exposed a real issue: Facebook's webhook queue also ignored logical DB/TLS settings, so events could land outside the worker's database. It now reuses QueueService's URL parser and closes the queue on shutdown.
- Root test execution is sequential across packages because existing integration suites operate on shared maintenance/queue resources. Individual workspace test runners retain their own configuration.
- Local PostgreSQL/Redis were prepared without installing global services. Original source ZIP remains unchanged; application and test databases are separate. Redis AOF persistence is enabled for the local runtime.

The TikTok module was added after initial local runtime and core validation. Final test evidence and remaining credentials/platform-review blockers are recorded in TEST_REPORT.md.

## Follow-up before credentials

The original TikTok draft creation required an ACTIVE OAuth account, preventing users without developer keys from preparing actual content. Added a real brand relation to shared ContentItem with a backfill migration; account selection is optional for preparation and mandatory for dispatch. Brand-level studio and source selection retain tenant checks, account assignment expires prior approvals, and TXT export does not make external calls. Four no-key integration cases, one shared-Gemini brand-studio case and one browser/mobile workflow extend the prior coverage. See TEST_REPORT.md for current evidence.
