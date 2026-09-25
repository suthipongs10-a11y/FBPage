# Architecture after TikTok MVP

The original pnpm monorepo is retained. No replacement app, separate TikTok authentication system or duplicate Gemini adapter was introduced.

```text
Next.js web (apps/web, port 3000)
  /api rewrite → NestJS API (apps/api, port 4000)
    AuthGuard → TenantGuard + permissions → platform services
      Prisma / PostgreSQL: tenants, encrypted credentials, content, approvals, metrics
      Shared AiGatewayService → ai-core adapters → configured AI provider
      QueueService → Redis / BullMQ → workers/scheduler
        platform-specific adapters → official platform APIs
```

## Existing domains

Workspace → Client → Brand is the common tenant/business hierarchy. Facebook pages, YouTube channels, websites and TikTok accounts belong to brands. Website monitoring, WordPress content, email campaigns, Facebook reporting and YouTube analytics keep their existing domain services. Sessions use HttpOnly cookies; permissions are resolved on the server. AI credentials and platform tokens use the existing database encryption utilities and AUTH_SECRET.

## TikTok boundaries

- `packages/tiktok-core`: official HTTP adapter, token rotation, sync, deterministic analytics, verified media URL rules, upload idempotency and status reconciliation. HTTP mocks are test fixtures only.
- `apps/api/src/tiktok`: guarded endpoints, single-use session-bound OAuth state, safe response projections, tenant checks, AI tasks, draft lifecycle, approval and scheduling.
- `apps/web/app/(app)/tiktok`: accounts, video library, observed metrics, AI interpretation, saved drafts and human actions. Shared content/calendar show TikTok items and link to the TikTok workflow.
- `workers/scheduler/src/tiktok`: due Inbox delivery, periodic sync every six hours and post-status polling every five minutes. API and worker share the adapter and guards on dispatch.

## Data and isolation

Additive migration `20260908050000_tiktok` adds TikTokAccount, TikTokOAuthState, TikTokVideo, ContentMetricSnapshot and TikTokContentMetadata. TikTok drafts remain ContentItem rows with `platform=TIKTOK`, linked to the account and shared ApprovalRequest, ContentRevision, ContentRelation, AiTaskLog, AuditLog and ExternalOperation structures.

Follow-up migration `20260908110000_tiktok_offline_drafts` adds ContentItem.tiktokBrandId and backfills it from existing TikTok accounts. Drafts may now have no account, while remaining owned by a real Brand → Client → Workspace. The shared content scope permits an unassigned TikTok draft only through that brand's workspace. No synthetic TikTok account/token is created. Assigning an active same-brand account uses a transaction and version check, clears confirmation and schedule, and expires earlier approvals. An unassigned draft can be reviewed/exported but cannot be dispatched.

Brand-level studio requests reuse the same Gemini gateway, prompts and output validation. Source selection is scoped to the brand on the API, and the web page discards stale library/source responses when the selection changes. Draft exports are UTF-8 text through a tenant-guarded endpoint; browser download preserves Thai characters.

Every TikTok account query verifies both workspaceId and Brand → Client → workspaceId. Shared `contentInWorkspace` includes this same tenant condition. Generic Facebook content mutations reject TikTok records so approval and publishing cannot bypass TikTok rules. Cross-platform repurposing accepts only content from the same workspace and brand.

OAuth state is hashed, expires after ten minutes, and binds user, session, workspace and brand. Permission is rechecked when the callback arrives. Token refresh uses a PostgreSQL transaction advisory lock; both rotated tokens and expirations commit together. Safe selectors exclude encrypted credentials, open_id and publish_id from normal UI responses.

## Lifecycle and side effects

Draft → human-reviewed → approval pending → approved → explicit confirmation → optional scheduled Inbox delivery → processing → Inbox delivered → published only after API confirmation. Editing before dispatch expires approvals and clears confirmation/schedule. Cancelled, edited or future-due jobs cannot dispatch through the worker. The workspace switch, account pause, account state and video.upload scope are checked before upload.

An atomic ContentItem claim plus a unique ExternalOperation key permits one initialization per item. The HTTP adapter retries reads with bounded backoff, never upload initialization. A lost response remains RECONCILIATION_REQUIRED; a worker retry cannot create a second upload. Once publish_id is known, only status reads resume. Local schedules cannot guarantee the time a creator finishes posting in TikTok.

## Measurement / AI

Video IDs upsert by account. Snapshots retain null for unavailable metrics. The MVP imports at most 100 recent public videos manually and 40 per scheduled sync; `hasMore` explicitly indicates additional remote pages. It is not a full historical backfill or analytics API substitute.

A median view baseline and rates are computed without AI. A high-performing marker requires at least five known-view videos and at least twice the median. These are comparisons of cumulative metrics with mixed video ages, not causal findings or equal-age experiments. AI interpretations reference IDs in the observed dataset; unknown references fail validation. No retention, demographics or watch-time values are invented.

## Runtime boundaries

`.env` and local state are ignored. Windows launchers load the root environment consistently. Local databases and test databases are separate. External platform success still requires operator-provided credentials, permissions and platform review. No production deployment was performed.
