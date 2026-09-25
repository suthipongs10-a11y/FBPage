# TikTok module plan — 2026-09-08

## Decision
Extend the existing Nest / Next / Prisma / BullMQ architecture, shared AI Gateway, ContentItem, ApprovalRequest and tenant scoping. Local runtime repairs precede implementation. Live platform validation is BLOCKED_BY_CREDENTIALS; mock tests never claim real API verification.

## Vertical slices
1. Official Web Login Kit OAuth: least-privilege basic/video scopes, optional profile/stats/upload scopes, persisted single-use state bound to browser session, ten-minute expiry, permission revalidation at callback, encrypted access/refresh token storage, rotation, disconnect/revocation and reconnect status.
2. TikTokAccount → TikTokVideo → ContentMetricSnapshot. Only authorized profile fields and public videos. Pagination is bounded; missing metrics stay null; imported items upsert by account/video ID. No watch-time or demographic fabrication.
3. Account-baseline analytics using median views, engagement/share/comment rates, sample-size disclosure and descriptive (not causal) comparison. AI analysis references known video IDs and separates observations, interpretations and recommendations.
4. Thai TikTok page with connected profiles, video library, analytics and Content Studio. Shared AI provider generates ideas/hooks/scripts/captions/hashtags and repurposes content into saved platform drafts. Human reviews output before submission.
5. Shared drafts, approval records, calendar and a TikTok-specific Inbox upload worker. Upload remains disabled unless SOCIAL_PUBLISHING_ENABLED=true and the operator explicitly confirms a reviewed version. Use official PULL_FROM_URL from a configured, TikTok-verified HTTPS media prefix; localhost URLs cannot be pulled by TikTok. Never claim a video file was uploaded by merely saving a URL.
6. Persist publish_id and fetch status. Inbox delivery means awaiting creator action, not PUBLISHED. Ambiguous init errors require reconciliation; no blind retry after a possibly accepted write. Scheduled time is Inbox delivery time, not guaranteed public post time.

## Affected areas
New packages/tiktok-core, apps/api/src/tiktok, workers/scheduler/src/tiktok, apps/web/app/(app)/tiktok; additive Prisma models/relations/migration; existing permissions, tenant helper, safe shared content read selectors, calendar card, queue wiring and environment documentation. Existing Facebook-specific mutation routes must reject TikTok items.

## Official references (checked 2026-09-08)
- [Web Login Kit](https://developers.tiktok.com/docs/en/login-kit-web): HTTPS registered static redirect URI; localhost web app can use a separately configured HTTPS development callback.
- [User access tokens](https://developers.tiktok.com/docs/en/oauth-user-access-token-management): form-encoded exchange/refresh/revoke; retain rotated refresh token and both expiry times.
- [User information](https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info): fields gated by basic/profile/stats scopes.
- [Video list](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list): public videos, cursor pagination, max_count <=20.
- [Inbox upload](https://developers.tiktok.com/docs/en/content-posting-api-reference-upload-video): video.upload, verified media URL; creator completes posting in TikTok.
- [Post status](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status): distinguish SEND_TO_USER_INBOX, PUBLISH_COMPLETE and FAILED.

## Verification
Unit tests for HTTP adapter/error sanitization/scopes/null metrics/baselines/URL validation; database/API integration for OAuth state replay/session/tenant/permissions, token rotation, sync idempotency, approval and editing invalidation, disabled upload and duplicate prevention; browser test for navigation/empty states/draft flow. Existing build, typecheck, lint and test suite rerun. No real posts, OAuth grants or external AI calls without configured credentials.

## Follow-up authorized work before credentials

Allow brand-owned drafts without an OAuth account; support human review/approval and Thai TXT export; later bind to an active account of the same brand with approval reset. Reuse brand context for the shared Gemini studio when only an AI key is available. Filter repurposing sources by brand and ignore stale responses after changing account/brand. Extend integration and browser coverage to the no-account workflow, export and subsequent account assignment, including mobile layout. Live analytics/publishing remain credential-gated.
