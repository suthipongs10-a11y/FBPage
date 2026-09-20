# AGENTS_YOUTUBE.md — YouTube AI Channel Manager Module

> **Purpose:** Primary implementation specification for the YouTube module of the existing Facebook AI Page Manager / AI Social Content OS.
>
> This file must be used **together with the root `AGENTS.md`** from the Facebook project. The root file remains the source of truth for repository-wide architecture, auth, Workspace/Client/Brand, multi-tenancy, RBAC, AI Gateway, Orchestrator, Tool Registry, Approval, Audit, Billing, Notifications, Security, Infrastructure, and Deployment.
>
> This document defines YouTube-specific entities, API adapters, analytics, quota handling, upload/scheduling, comments, SEO, titles/thumbnails, scripts, playlists, live, optimization loops, and Facebook + YouTube cross-platform workflows.

---

# 1. Product Vision

Extend the existing Facebook AI Page Manager into a broader **AI Social Content OS**. The YouTube module is the **AI YouTube Channel Manager**. It must not be a separate disconnected SaaS.

```text
Workspace
└── Client
    └── Brand
        ├── Facebook Page
        └── YouTube Channel
```

Shared Core: Users / Workspace / Client / Brand · Brand Knowledge · AI Gateway · AI Provider Adapters · Agent Orchestrator · Tool Registry · Approval System · Audit Logs · Notification Service · Billing foundations · Storage / Queue / Database. Platform-specific services remain separate.

# 2. YouTube Mission

```text
YouTube Channel Data → Video Analytics → Audience / Comment Insights → AI Analysis → Content Opportunity
→ Title / Thumbnail / Script / Metadata → Approval → Upload / Schedule / Publish → Measure → Learn → Improve Next Video
```

Not only an uploader / SEO keyword tool / script generator / thumbnail generator / comment bot. It behaves like a **channel strategist + producer + analyst + SEO assistant + community manager** using real channel data.

# 3. Shared Architecture With Facebook

Do not duplicate the Facebook stack. Navigation: Dashboard (Overview, Clients, AI Command, Calendar, Approvals, Reports) · Facebook (Overview, Content, Analytics, Comments, Leads) · YouTube (Overview, Videos, Content Lab, Calendar, Analytics, SEO, Comments, Playlists, Reports).

Execution path: Dashboard / AI Command / Automation → Agent Orchestrator → Tool Registry → YouTubeService / YouTubeAnalyticsService → Google / YouTube APIs. AI must never call raw YouTube SDKs from arbitrary business code.

# 4. YouTube API Surfaces

- **Data API v3**: channel metadata, video metadata/statistics, upload, update/delete, playlists, playlist items, comments/replies, live resources.
- **Analytics API**: owner-authorized analytics (views, engaged views, average view duration, estimated minutes watched, likes, comments, shares, subscribers gained/lost, estimated revenue when authorized).
- **Reporting API**: bulk/scheduled reports.
- **Live Streaming API**: later.

# 5. API Change Awareness

Maintain `docs/youtube/API_CHANGELOG.md`. Before significant production changes verify official docs for OAuth scopes, upload restrictions, quota behavior, Shorts metrics, view-count definition changes, analytics metrics, reporting schemas, live API behavior. Never hardcode historical assumptions as permanent facts.

# 6. Google OAuth

Connect YouTube → Google OAuth → Consent → Callback validation → Store encrypted tokens → Discover authorized channel → Connect Channel to Brand. Do not use API keys for owner-level write operations or private analytics.

# 7. OAuth Security

Store encrypted access token, encrypted refresh token, expiry, granted scopes, provider user ID, last refresh, last validation, connection status. Never expose refresh token to frontend, log tokens, include secrets in error telemetry, or store plaintext provider secrets.

# 8. Least Privilege Scope Strategy

Feature → scope matrix (Read Channel → read-only; Upload → upload; Manage metadata/comments → management scope; Analytics → analytics read-only; Revenue → monetary analytics read-only). Verify exact scopes against current Google documentation.

# 9. Google Verification Readiness

Prepare early: OAuth consent screen, verified domain, privacy policy, terms, scope explanations, data deletion/revocation, test accounts, verification screencasts.

# 10. Upload Restriction Handling

Expose upload readiness status; support prepare-only workflow if production upload is not yet verified; never promise public auto-publishing before compliance readiness; document restriction in admin health screen.

# 11–14. Core Entities

GoogleConnection · YouTubeChannel · YouTubeVideo (internal type LONG_FORM | SHORT | LIVE | PREMIERE | UNKNOWN, classifier replaceable) · YouTubeVideoMetricSnapshot · YouTubeChannelMetricSnapshot. Missing data must remain missing, never invented.

# 15–16. Metric Adapter

`YouTubeMetricAdapter` normalizes source metrics, handles missing values, preserves original metric names, normalizes units, records data source, versions transformations.

```ts
type NormalizedYouTubeMetric = { key: string; value: number | null; unit: "COUNT" | "SECONDS" | "MINUTES" | "PERCENT" | "CURRENCY" | "RATIO"; sourceMetric: string; source: "DATA_API" | "ANALYTICS_API" | "REPORTING_API"; capturedAt: Date };
```

Always retain capturedAt, source API, metric version, format. Avoid silently comparing incompatible periods.

# 17. Progressive Channel Sync

Connected → Quick Channel Snapshot → Recent 30 Videos → Historical Video Import → Analytics Backfill → Comment Backfill. Show progress in UI.

# 18–20. Service Interfaces

`YouTubeService` (getChannel, listVideos, getVideo, updateVideo, uploadVideo, deleteVideo, listPlaylists, createPlaylist, addVideoToPlaylist, listCommentThreads, listReplies, replyToComment) · `YouTubeAnalyticsService` (getChannelSummary, getVideoAnalytics, getVideoComparison, getTrafficAnalytics?, getRevenueAnalytics?) · Reporting Service (job → download → parse → normalize → snapshots).

# 21–22. Quota Manager

`YouTubeQuotaManager` + `YouTubeApiUsage` (workspaceId, channelId, api, method, quotaUnitsEstimated, calledAt, success, requestId). Dashboard shows today's usage %. Prefer known-resource traversal (uploads playlist → playlistItems → videos.list); avoid search; incremental sync, caching, throttling, backoff, soft limits.

# 23. Queues

youtube-sync, youtube-analytics, youtube-reporting, youtube-upload, youtube-comments, youtube-live, youtube-maintenance. Every job tenant scoped, retry safe, idempotent, observable, quota aware.

# 24–26. Shared Content Model

Extend root ContentItem: platform FACEBOOK | YOUTUBE; contentType FB_POST, FB_REEL, YT_LONG_FORM, YT_SHORT, YT_LIVE. YouTube-specific data in `YouTubeContentMetadata` (title, description, tags, categoryId, playlistIds, privacyStatus, scheduledPublishAt, madeForKids, thumbnailAssetId, videoAssetId).

Lifecycle: IDEA → RESEARCH → OUTLINE → SCRIPT → PRODUCTION → VIDEO_READY → METADATA_READY → THUMBNAIL_READY → AI_REVIEW → READY_FOR_APPROVAL → APPROVED → UPLOAD_PENDING → UPLOADING → PROCESSING → SCHEDULED → PUBLISHED → ANALYTICS_PENDING → ANALYZED. Failures: REJECTED, UPLOAD_FAILED, PROCESSING_FAILED, PUBLISH_FAILED, CANCELLED.

# 27–54. Agents

Logical roles (no microservices): YouTube Analyst (OBSERVED / INFERENCE / RECOMMENDATION separated), Content Pillar Classification (human override wins), Topic Opportunity Agent (structured: topic, whyNow, evidence, contentPillar, format, priority, confidence), Content Gap Finder, Topic Saturation, Title Optimizer (multiple angles, never promise CTR), Packaging Diagnosis (heuristics labeled as hypothesis), Thumbnail Strategist (brief + prompt via MediaService), Thumbnail Experiments (manual controlled), Script Agent (hook/outline/body/CTA/visual cues; Verified Research vs Brand Knowledge vs AI Creative Interpretation separated for factual niches), SEO/Metadata Agent (do not overstate tags), Metadata Update Workflow (current vs proposed → human review → approval → updateVideo → audit; no silent bulk edits), Old Video Revival Agent + versioned Revival Score, Subscriber Conversion (subscribersGained/views, zero-safe), Watch Time Intelligence, Shorts Analysis (separate), Revenue Intelligence (permission youtube.revenue.read; estimated ≠ accounting), Comment entity/threads (replies via comments.list), Comment Intelligence classes (QUESTION, CONTENT_REQUEST, PRAISE, CRITICISM, CORRECTION, EXPERIENCE_SHARE, SPAM, PRODUCT_INTEREST, SERVICE_INTEREST, FOLLOW_UP_QUESTION, MISUNDERSTANDING, FACT_CHALLENGE, OTHER), Comment → Video Idea Engine (clusters), Comment Reply Agent (draft → human approval; auto-reply only safe categories), Creator Feedback Dashboard, Playlists + Playlist Architect.

# 55–64. Series, Upload, Assets, Policy

ContentSeries · Upload Workflow (asset ready → metadata → thumbnail → policy fields → AI reviewer → human approval → upload job → processing → verify → schedule/publish → audit) · VideoAsset / ThumbnailAsset validated before queue · `YouTubeUploadOperation` idempotency (never blindly retry) · resumable upload in background worker · processing state verified before success · scheduling stores channel timezone, local time, normalized timestamp, publishAt, privacy · policy fields (madeForKids, privacy, synthetic media disclosure, paid placement) never decided silently by AI · `YouTubeChannelPolicy` (defaultPrivacy, defaultMadeForKids, requireSyntheticMediaReview, requirePaidPlacementReview, allowAutoUpload, allowAutoMetadataUpdate, allowAutoReply).

# 65–69. UI

Shared calendar with platform filters · YouTube Overview action cards (Views, Watch Time, Subscribers Gained, Videos Published, Pending Approvals, Content Opportunities, Videos Needing Attention, Comment Topic Clusters) · Video Library (thumbnail, title, format, publish date, views, watch time, AVD, subscribers gained, CTR if available, pillar, recommendation) · Video Detail tabs (Overview, Analytics, Packaging, SEO, Comments, Recommendations, History) · Content Lab (Ideas, Research, Outlines, Scripts, Production, Ready to Upload; actions Find Ideas, Research Topic, Generate Outline, Write Script, Create Titles, Create Thumbnail Brief, Create Description, Generate Short Version, Repurpose to Facebook).

# 70–77. AI Command + Cross-Platform

Shared Command Center with explicit context (Client, Brand, Platform: YouTube, Channel, Date Range) — never silently switch context · Cross-platform commands · `BrandInsight` (STRONG_TOPIC, CONTENT_GAP, AUDIENCE_QUESTION, CROSS_PLATFORM_OPPORTUNITY, REVIVAL_OPPORTUNITY) · shared `Topic` model · Content Repurposing Agent (adapt hook/length/CTA/format/visual brief, never copy unchanged) · `ContentRelation` (REPURPOSED_FROM, CLIPPED_FROM, FOLLOWUP_TO, SERIES_MEMBER, INSPIRED_BY) · never compare unlike metrics across platforms; compare topic strength, audience interest, repeated questions, lead intent, content demand.

# 78–81. Monthly Report + Recommendations

Report answers: what happened, growth/decline, subscriber drivers, best topics, packaging problems, content/watch problems, viewer requests, revival candidates, what to produce next, experiments. Recommendations must be actionable with evidence and action buttons; action types CREATE_FOLLOWUP, CREATE_SHORT, CREATE_FACEBOOK_POST, OPTIMIZE_TITLE, OPTIMIZE_THUMBNAIL, UPDATE_DESCRIPTION, ADD_TO_PLAYLIST, CREATE_PLAYLIST, REPLY_COMMENT, CREATE_SERIES, REVIVE_VIDEO; track accepted/ignored/completed; never claim improvement without measurement.

# 82–101. AI Quality Rules

Prompt versions (youtube-channel-analysis-v1, youtube-video-analysis-v1, youtube-topic-opportunity-v1, youtube-title-generator-v1, youtube-thumbnail-brief-v1, youtube-script-v1, youtube-seo-v1, youtube-comment-classifier-v1, youtube-revival-v1, youtube-monthly-report-v1) · model routing by task · never send thousands of items into one prompt (ETL → metrics → clusters → summaries → representative evidence) · CommentCluster · hallucination rules (never invent views, revenue, subscribers, CTR, watch time, comments, rankings, search volume, competitor private analytics, demographics → "Metric unavailable") · no SEO promises · competitor analysis limited to public data · Live module later · notifications (OAuth refresh failed, upload/processing/schedule/analytics failed, quota threshold, cluster attention, opportunity, report ready) · quota thresholds (>80% warn, >95% pause nonessential) · analytics checkpoints +1h +24h +72h +7d +28d · performance windows FIRST_24H/72H/7D/28D/LIFETIME · fair same-age comparisons · median baselines · outliers flagged · internal performance score labeled internal · confidence LOW/MEDIUM/HIGH · explainability with evidence.

# 102–107. Tools

Namespaced `youtube.*` MCP/registry tools calling internal services (READ: get_channel, list_videos, get_analytics, list_comments; WRITE: create_content_idea, create_script, create_metadata; PUBLISH: upload_video, update_video, reply_comment, create_playlist). Upload tool verifies tenant scope, permission, connection, automation level, approved ContentItem, asset exists, metadata validation, policy fields, kill switch, idempotency. Agent context includes channelId, dateRange, automationLevel, locale, timezone.

# 108–133. Structured outputs, objectives, leads, repurposing, retention, sync, quality

Structured schemas for all operational objects · Content objectives (VIEW_GROWTH … FAQ) · YouTube lead signals → shared Lead with sourcePlatform YOUTUBE · transcripts only via supported access · chapters only with real timing · Shorts/Facebook repurposing with ContentRelation · unified calendar/overview/plan · research source labeling · disconnect policy (revoke tokens, stop jobs, mark disconnected, retain analytics per policy) · sync strategy (fast/daily/weekly/monthly) · freshness display · YouTubeSyncRun · pagination everywhere · deleted/private videos marked not deleted · comments disabled state · data-quality warnings passed to AI · minimum sample rules · AI cost attribution · production cost (future) · ContentExperiment.

# 134–160. Governance

Client approval view · Automation levels (1 Analyze Only, 2 Content Draft, 3 Approval Publishing — default, 4 Full Auto opt-in with frequency/format/window/topic/privacy/compliance limits) · kill switches (Pause YouTube Automation, Pause Uploads) · YouTubeChannelSettings · style profiles (Thumbnail/Title/Script) · error normalization (quotaExceeded → "YouTube API quota is exhausted…", invalidGrant → "Google authorization is no longer valid. Reconnect…") · retry policy (retry transient; never loop on revoked OAuth, insufficient scope, invalid metadata, policy rejection) · audit events (YOUTUBE_CONNECTED … YOUTUBE_AUTOMATION_CHANGED) · RBAC permissions youtube.read, youtube.connect, youtube.analytics.read, youtube.revenue.read, youtube.content.create, youtube.content.edit, youtube.content.approve, youtube.upload, youtube.publish, youtube.metadata.edit, youtube.comments.read, youtube.comments.reply, youtube.playlists.manage, youtube.live.manage, youtube.automation.manage, youtube.settings.manage · tenant isolation via Channel → Brand → Client → Workspace · env placeholders (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, YOUTUBE_API_KEY, YOUTUBE_UPLOAD_ENABLED=false, YOUTUBE_DEFAULT_SYNC_DAYS=90, YOUTUBE_ANALYTICS_SYNC_CRON, YOUTUBE_QUOTA_SOFT_LIMIT) · reuse deployment stack · observability · admin YouTube Health · runbooks under docs/youtube/runbooks · media retention policy · privacy minimization · official API first · packaging ethics flags (TITLE_CONTENT_MISMATCH, THUMBNAIL_CONTENT_MISMATCH) · factual channel research requirement · business facts from Brand Knowledge only (NEEDS_HUMAN_INPUT) · duplicate detection · publishing frequency controls · schedule optimization only with evidence · no unsupported forecasts · exact report dates · explicit timezone/currency.

# 161–163. Differentiator & Loops

> Use real channel performance and viewer questions to decide what to create, optimize, revive, and repurpose next.

Performance Loop · Packaging Loop · Comment Loop · Library Loop · Cross-Platform Loop.

# 164. Implementation Phases

- **YT-1 Connection**: Google OAuth, encrypted tokens, channel discovery, Brand connection, health, disconnect, recent video import.
- **YT-2 Analytics**: Analytics API, snapshots, adapter, fair windows, dashboard, Analyst Agent.
- **YT-3 Content Lab**: Ideas, Topic Opportunity, Gap Finder, Script, Titles, Thumbnail brief, Metadata.
- **YT-4 Publishing**: assets, approval, resumable upload, idempotency, metadata, processing state, scheduling, audit.
- **YT-5 Comments**: sync, replies, clustering, FAQ/content-request extraction, comment → idea.
- **YT-6 Optimization**: packaging diagnosis, revival, SEO, playlists, experiments.
- **YT-7 Cross Platform**: Topic, BrandInsight, ContentRelation, unified Calendar/Approval, cross-platform recommendations, repurposing.
- **YT-8 Advanced**: revenue, live, production cost, content ROI.

# 165–166. MVP

Operator can: connect Google → connect one Channel → import videos → read channel/video analytics → see top videos → ask AI to analyze → receive opportunities → generate idea/script/titles/thumbnail brief/metadata → approve upload package → upload/schedule safely when verified → collect later metrics → post-publication analysis → audit trail. First cross-platform milestone: one Brand with 1 Page + 1 Channel analyzed independently, unified Calendar/Approval, repurposing, cross-platform recommendations.

# 167–170. Testing & Definition of Done

Unit (adapters, quota, windows, rules, lifecycle, policy, schemas) · Integration (OAuth, refresh, import, pagination, analytics, upload idempotency, comments, reply, playlists) · E2E · CI must never publish to real client channels · mock fixtures for channels.list, playlistItems.list, videos.list/insert/update, commentThreads.list, comments.list/insert, analytics.query, reporting, liveBroadcasts · dedicated test channel. DoD: tenant scope, RBAC, adapter, scope impact documented, quota considered, errors normalized, retries safe, audit, UI states, tests, structured AI output, limitations documented, no secrets, docs updated.

# 171–186. Coding Agent Rules

Read root AGENTS.md then this file; inspect shared modules; reuse; avoid duplicated core; identify OAuth/quota/risk impact; smallest coherent vertical slice; lint/test/typecheck/build. Avoid Facebook assumptions (channels, videos, watch time, subscribers, playlists, processing). Avoid premature generic abstraction — safe shared entities: SocialAccount, ContentItem, ContentAsset, Approval, Recommendation, Topic, BrandInsight, AI Task, Audit Event, Lead; keep analytics platform-specific. Tool namespaces facebook.*, youtube.*, content.*, research.*, media.*, approval.*, analytics.*.

> **One Brand. Multiple channels. One AI operating system. Platform-specific analytics. Shared strategy. Controlled execution.** When choosing between clever autonomy and reliable controlled behavior, choose reliable controlled behavior first.

# END OF AGENTS_YOUTUBE.md
