'use client';

export interface ApiIssue { path: string; message: string }
export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly issues: ApiIssue[] = []) { super(message); }
}

/** เรียก API ผ่าน /api/* (same-origin) — cookie เซสชันติดไปเอง */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = typeof data?.message === 'string' ? data.message : Array.isArray(data?.message) ? data.message.join(', ') : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, data?.issues ?? []);
  }
  return data as T;
}

// ---------- types ที่หน้าเว็บใช้ (mirror ของ API response) ----------
export interface User { id: string; email: string; name: string }
export interface WorkspaceSummary { id: string; name: string; slug: string; timezone: string; automationPaused: boolean; role: string }
export interface Me { user: User; workspaces: WorkspaceSummary[] }
export interface Client { id: string; name: string; contactName: string | null; email: string | null; phone: string | null; notes: string | null; status: string; createdAt: string; _count: { brands: number } }
export interface BrandLite { id: string; name: string; industry: string | null; knowledgeBaseStatus: string; _count: { knowledge: number; pages: number } }
export interface ClientDetail extends Client { brands: BrandLite[] }
export interface Brand { id: string; clientId: string; name: string; description: string | null; industry: string | null; targetAudience: string | null; toneOfVoice: string | null; preferredLanguage: string; serviceArea: string | null; primaryCTA: string | null; website: string | null; knowledgeBaseStatus: string; client: { id: string; name: string }; _count: { knowledge: number; pages: number } }
export interface KnowledgeItem { id: string; type: string; title: string; content: string; source: string | null; active: boolean; createdAt: string }
export interface Member { role: string; permissions: string[]; createdAt: string; user: User }
export interface AuditRow { id: string; action: string; resourceType: string; resourceId: string | null; before: unknown; after: unknown; requestId: string; createdAt: string; user: User | null }
export interface WorkspaceDetail { id: string; name: string; slug: string; timezone: string; automationPaused: boolean; aiMonthlyBudgetUsd: string | number | null; aiMaxCostPerTaskUsd: string | number | null; role: string; permissions: string[]; _count: { clients: number; members: number } }

// ---------- Facebook (Phase 3–4) ----------
export interface FbConnection { id: string; providerUserId: string; providerUserName: string | null; scopes: string[]; status: string; tokenExpiresAt: string | null; lastValidatedAt: string | null; createdAt: string; user: { id: string; name: string } | null; _count: { pages: number } }
export interface AvailablePage { id: string; name: string; category: string | null; tasks: string[]; pictureUrl: string | null; connected: { pageId: string; brandId: string; brandName: string } | null }
export interface PageRow {
  id: string; brandId: string; connectionId: string; facebookPageId: string; name: string; username: string | null; category: string | null; pictureUrl: string | null; link: string | null; fanCount: number | null;
  tokenStatus: string; tasks: string[]; automationLevel: string; publishingPaused: boolean; timezone: string | null; connectedAt: string; lastSyncedAt: string | null; lastSyncError: string | null; lastValidatedAt: string | null; disconnectedAt: string | null; commentsStatus?: string; commentsSyncedAt?: string | null;
  brand: { id: string; name: string; client: { id: string; name: string } }; _count: { posts: number };
}
export interface PageDetail extends PageRow {
  profile: Record<string, unknown> | null;
  completeness: { score: number; missing: { key: string; label: string; hint: string | null }[] };
  stats: { posts30d: number; availability: Record<string, boolean> | null; lastCapturedAt: string | null };
}
export interface MetricCell { value: number | null; sourceMetric: string }
export interface PagePost { id: string; facebookPostId: string; message: string | null; mediaType: string | null; permalink: string | null; publishedAt: string | null; source: string; metrics: Record<string, MetricCell> | null; capturedAt: string | null }
export interface SyncResult { imported: number; updated: number; total: number; availability: { likes: boolean; comments: boolean; shares: boolean }; syncedAt: string }

// ---------- AI (Phase 5) ----------
export interface AiProviderRow { id: string; label: string; defaultModel: string; baseUrl: string; needsBaseUrl: boolean; keyHelp: string; configured: boolean; platformKey: boolean; keyHint: string | null; customBaseUrl: string | null; lastValidatedAt: string | null; lastError: string | null; updatedAt: string | null }
export interface AiRoleCfg { provider: string; model: string }
export interface AiRoles { roles: Record<string, AiRoleCfg | null> }
export interface AiUsage { monthlyBudgetUsd: number | null; maxCostPerTaskUsd: number | null; monthToDate: { costUsd: number; tasks: number; failed: number; since: string }; byModel: { provider: string; model: string; tasks: number; costUsd: number; inputTokens: number; outputTokens: number; avgLatencyMs: number }[] }
export interface AiTaskRow { id: string; taskType: string; role: string; provider: string; model: string; latencyMs: number; inputTokens: number | null; outputTokens: number | null; estimatedCost: string | number | null; success: boolean; retry: number; resourceType: string | null; resourceId: string | null; requestId: string; error: string | null; createdAt: string }
export interface AiToolRow { name: string; description: string; riskLevel: string; requiredPermission: string | null; allowed: boolean }
export type AiChatMessage = { role: 'user'; content: string } | { role: 'assistant'; content: string; toolCalls?: { id: string; name: string; args: Record<string, unknown> }[] } | { role: 'tool'; toolCallId: string; name: string; content: string };
export interface AiStep { type: 'tool' | 'result'; name: string; args?: Record<string, unknown>; preview?: string }
export interface AiCommandResult { text: string; messages: AiChatMessage[]; steps: AiStep[]; usage: { input: number | null; output: number | null }; costUsd: number | null; model: string; provider: string; taskId: string; latencyMs: number; stoppedByLimit: boolean }
export interface PageAnalysisResult { summary: string; dataLimitations: string[]; topPosts: { facebookPostId: string; why: string }[]; patterns: { finding: string; evidence: string; confidence: string }[]; recommendations: { title: string; why: string; action: string; confidence: string; expectedImpact: string }[]; contentPillars: string[] }
export interface PageAnalysisRow { id: string; days: number; result: PageAnalysisResult; provider: string; model: string; createdAt: string }

// ---------- Content (Phase 6) ----------
export interface ApprovalRow { id: string; status: string; requestedAt: string; reviewedAt: string | null; reviewerComment: string | null; requestedBy: { name: string }; reviewedBy: { name: string } | null }
export interface ContentItem {
  id: string; pageId: string | null; platform?: string; ytStatus?: string | null; youtubeChannel?: { id: string; title: string } | null; youtubeMeta?: { title: string | null; format: string; privacyStatus: string; scheduledPublishAt: string | null } | null; status: string; contentType: string; title: string | null; caption: string | null; cta: string | null; hashtags: string[]; mediaBrief: string | null; mediaPaths: string[]; objective: string | null; contentPillar: string | null;
  scheduledLocal: string | null; scheduledTz: string | null; scheduledAt: string | null; retryCount: number; createdById: string | null; aiProvider: string | null; aiModel: string | null; promptVersion: string | null; editedByHuman: boolean;
  publishedPostId: string | null; externalPostId: string | null; publishedAt: string | null; planId: string | null; aiNotes: { hook?: string; dayOffset?: number; missingInfo?: string[]; needsHumanInput?: boolean } | null;
  reviewResult: { result: string; summary?: string; issues: { type: string; detail: string; severity: string }[] } | null; lastError: string | null; createdAt: string; updatedAt: string;
  page: { id: string; name: string; pictureUrl: string | null; timezone: string | null; automationLevel: string; publishingPaused: boolean; tokenStatus: string; brand: { id: string; name: string; client: { id: string; name: string } } } | null;
  approvals: ApprovalRow[]; _count: { revisions: number };
}
export interface ContentRevisionRow { version: number; caption: string | null; editedBy: string | null; reason: string | null; createdAt: string }
export interface PublishOutcome { status: 'PUBLISHED' | 'SKIPPED' | 'FAILED'; externalId?: string; permalink?: string; reason?: string; error?: string; duplicateRecovered?: boolean }
export interface PlanResult { id: string; plan: { objective: string; contentPillars: string[]; recommendedMix: Record<string, number>; rationale: string; dataLimitations: string[] }; items: ContentItem[]; model: string; costUsd: number | null }

// ---------- Reports + Media (Phase 7) ----------
export interface ReportPost { facebookPostId: string; publishedAt: string | null; mediaType: string | null; message: string; source: string; permalink: string | null; shares: number | null; reactions: number | null; comments: number | null; pillar: string | null }
export interface ReportData {
  page: { id: string; name: string; category: string | null; followers: number | null; completeness: number; missing: string[] };
  period: { start: string; end: string; label: string; days: number };
  metricsAvailable: Record<string, boolean>; dataLimitations: string[];
  publishing: { posts: number; postsPrevPeriod: number; perWeek: number; activeDays: number; longestGapDays: number; bySystem: number; byType: Record<string, number> };
  engagement: { sharesTotal: number | null; sharesAvg: number | null };
  topPosts: ReportPost[]; bottomPosts: ReportPost[]; pillars: { pillar: string; posts: number; shares: number | null }[];
  content: { created: number; approved: number; rejected: number; published: number; scheduledNext: number; aiDrafted: number };
  ai: { tasks: number; costUsd: number };
  analysis: { createdAt: string; recommendations: { title?: string; action?: string; confidence?: string }[]; patterns: unknown[]; contentPillars: string[] } | null;
  summary: { executiveSummary: string; whatHappened: string[]; whyItHappened: string[]; repeat: string[]; stop: string[]; experiments: string[]; nextMonthFocus: string[] } | null;
  text: string;
}
export interface ReportRow { id: string; periodStart: string; periodEnd: string; label: string; posts: number; hasSummary: boolean; provider: string | null; model: string | null; createdAt: string }
export interface ReportDetail { id: string; pageId: string; periodStart: string; periodEnd: string; provider: string | null; model: string | null; createdAt: string; data: ReportData }
export interface MediaAsset { id: string; contentId: string | null; kind: string; template: string | null; theme: string | null; path: string; mimeType: string; width: number | null; height: number | null; bytes: number | null; createdAt: string }
export interface MediaCapabilities { templates: string[]; themes: string[]; size: number; chromium: boolean }

// ---------- Comments / Leads / Notifications / Invites (Phase 8) ----------
export interface CommentRow { id: string; pageId: string; postId: string | null; facebookCommentId: string; parentCommentId: string | null; fromName: string | null; message: string | null; createdTime: string; permalink: string | null; classification: string | null; sentiment: string | null; riskFlag: boolean; aiSummary: string | null; draftReply: string | null; replyStatus: string; replyExternalId: string | null; repliedAt: string | null; resolvedAt: string | null; isHidden: boolean; page: { id: string; name: string; automationLevel: string; commentsStatus: string }; post: { id: string; message: string | null; permalink: string | null } | null; lead: { id: string; leadScore: number; status: string } | null }
export interface CommentInsights { days: number; total: number; distribution: { classification: string; count: number; share: number }[]; recommendations: string[]; unresolved: number; drafted: number; leadsNew: number; unclassified: number }
export interface LeadRow { id: string; pageId: string; commentId: string | null; source: string; name: string | null; intent: string | null; product: string | null; service: string | null; quantity: string | null; requestedDate: string | null; location: string | null; budget: string | null; phone: string | null; urgency: string | null; leadScore: number; confidence: number; status: string; notes: string | null; createdAt: string; page: { id: string; name: string }; comment: { message: string | null; fromName: string | null; permalink: string | null } | null }
export interface NotificationRow { id: string; type: string; severity: string; title: string; body: string | null; href: string | null; readAt: string | null; createdAt: string }
export interface InviteRow { id: string; role: string; email: string | null; expiresAt: string; createdAt: string }

// ---------- YouTube (AGENTS_YOUTUBE.md) ----------
export interface YtHealth { oauthConfigured: boolean; apiKeyConfigured: boolean; uploadEnabled: boolean; quota: { level: string; used: number; calls: number; failed: number; dayStart: string; softLimit: number; percent?: number }; connections: Record<string, number> }
export interface YtQuota { level: string; used: number; dayStart: string; byMethod: { method: string; calls: number; units: number }[] }
export interface YtConnection { id: string; providerUserId: string; email: string | null; scopes: string[]; status: string; tokenExpiresAt: string | null; lastRefreshedAt: string | null; lastError: string | null; createdAt: string; user: { id: string; name: string } | null; _count: { channels: number } }
export interface YtChannel {
  id: string; brandId: string; googleConnectionId: string | null; youtubeChannelId: string; accessMode: string; title: string; customUrl: string | null; thumbnailUrl: string | null; subscriberCount: number | null; videoCount: number | null; viewCount: number | null; timezone: string | null;
  automationLevel: string; automationPaused: boolean; uploadsPaused: boolean; policy: Record<string, unknown> | null; connectedAt: string; lastSyncedAt: string | null; syncStatus: string; syncError: string | null; commentsStatus: string; analyticsStatus: string; status: string; disconnectedAt: string | null;
  brand: { id: string; name: string; client: { id: string; name: string } }; _count: { videos: number; comments: number };
}
export interface YtChannelDetail extends YtChannel { syncRuns: { id: string; type: string; status: string; startedAt: string; completedAt: string | null; processed: number; errors: number; message: string | null }[]; latestAnalytics: { metricsJson: Record<string, { value: number | null }>; rangeStart: string | null; rangeEnd: string | null; capturedAt: string } | null; connection: { email: string | null; status: string; features: string[] } | null; capabilities: { analytics: boolean; upload: boolean; uploadEnabledEnv: boolean; manage: boolean; publicRead: boolean } }
export interface YtVideoStats { views: number | null; likes: number | null; comments: number | null; watchMinutes: number | null; avgViewDuration: number | null; avgViewPct: number | null; shares: number | null; subscribersGained: number | null; subscriberConversion: number | null; analyticsAt: string | null }
export interface YtVideo { id: string; channelId: string; youtubeVideoId: string; title: string; description: string | null; publishedAt: string | null; privacyStatus: string | null; durationSeconds: number | null; tags: string[]; thumbnailUrl: string | null; videoType: string; contentPillar: string | null; pillarManual: boolean; source: string; availability: string; commentsDisabled: boolean; viewCount: number | null; likeCount: number | null; commentCount: number | null; lastSyncedAt: string | null; channel: { id: string; title: string; accessMode: string }; stats: YtVideoStats }
export interface YtVideoDetail extends YtVideo { timeline: { capturedAt: string; source: string; window: string; metricsJson: Record<string, { value: number | null }> }[]; recommendations: YtRecommendation[]; commentCount: number | null; packaging: { diagnosis: string; hypothesis: string; confidence: string } | null }
export interface YtRecommendation { id: string; channelId: string; videoId: string | null; actionType: string; title: string; why: string; evidence: unknown; confidence: string; priority: number; status: string; createdAt: string }
export interface YtMeta { title: string | null; description: string | null; tags: string[]; categoryId: string | null; playlistIds: string[]; privacyStatus: string; scheduledPublishAt: string | null; madeForKids: boolean | null; syntheticMedia: boolean | null; paidPlacement: boolean | null; thumbnailAssetId: string | null; videoAssetId: string | null; format: string; targetDurationSec: number | null; hook: string | null; outline: { section: string; points: string[]; visual?: string; durationSec?: number }[] | null; script: string | null; titleCandidates: { title: string; angle: string; reason: string; risk: string }[] | null; thumbnailBrief: Record<string, unknown> | null; objective: string | null; youtubeVideoId: string | null }
export interface YtContent { id: string; platform: string; youtubeChannelId: string; status: string; ytStatus: string; title: string | null; caption: string | null; objective: string | null; contentPillar: string | null; scheduledAt: string | null; scheduledTz: string | null; publishedAt: string | null; externalPostId: string | null; lastError: string | null; aiProvider: string | null; aiModel: string | null; aiNotes: Record<string, unknown> | null; reviewResult: { result: string; summary: string; issues: { type: string; detail: string; severity: string }[] } | null; createdAt: string; updatedAt: string; youtubeMeta: YtMeta | null; youtubeChannel: { id: string; title: string; uploadsPaused: boolean; accessMode: string; timezone: string | null; automationLevel: string; brand: { id: string; name: string } }; approvals: { id: string; status: string; requestedAt: string; reviewedAt: string | null; reviewerComment: string | null; requestedBy: { name: string } | null; reviewedBy: { name: string } | null }[]; uploadOps: { status: string; youtubeVideoId: string | null; bytesSent: number; totalBytes: number | null; error: string | null; retryCount: number }[]; relationsFrom: { relationType: string; child: { id: string; platform: string; title: string | null; status: string } }[]; relationsTo: { relationType: string; parent: { id: string; platform: string; title: string | null; status: string } }[] }
export interface YtComment { id: string; channelId: string; videoId: string | null; youtubeCommentId: string; authorDisplayName: string | null; text: string; likeCount: number; publishedAt: string; isReply: boolean; classification: string | null; sentiment: string | null; riskFlag: boolean; aiSummary: string | null; draftReply: string | null; replyStatus: string; repliedAt: string | null; resolvedAt: string | null; clusterId: string | null; video: { id: string; title: string; youtubeVideoId: string } | null; lead: { id: string; leadScore: number; status: string } | null }
export interface YtCluster { id: string; channelId: string; label: string; description: string | null; count: number; kind: string; confidence: number | null; lastSeen: string; channel: { id: string; title: string } }
export interface YtCommentInsights { days: number; total: number; distribution: { classification: string; count: number; share: number }[]; unresolved: number; drafted: number; unclassified: number; topRequests: YtCluster[]; recommendations?: string[] }
export interface BrandInsight { id: string; brandId: string; type: string; platforms: string[]; title: string; observation: string; inference: string | null; recommendation: string | null; confidence: string; status: string; createdAt: string; brand: { id: string; name: string } }
export interface YtReportRow { id: string; channelId: string; channelTitle: string; periodStart: string; periodEnd: string; label: string; videos: number; hasSummary: boolean; provider: string | null; model: string | null; createdAt: string }
export interface YtReportDetail { id: string; channelId: string; periodStart: string; periodEnd: string; provider: string | null; model: string | null; createdAt: string; data: { channel: { title: string; accessMode: string; subscribers: number | null }; period: { label: string; days: number }; metricsAvailable: Record<string, boolean>; dataLimitations: string[]; publishing: { videos: number; videosPrevPeriod: number; longForm: number; shorts: number; live: number; perWeek: number; bySystem: number }; channelMetrics: { views: number | null; watchMinutes: number | null; subscribersGained: number | null; subscribersLost: number | null; revenueUsd: number | null }; topVideos: { youtubeVideoId: string; title: string; views: number | null; avgViewDuration: number | null; subscribersGained: number | null }[]; formats: { format: string; videos: number; medianViews: number | null; medianAvd: number | null }[]; comments: { total: number; questions: number; requests: number; complaints: number; leads: number; unresolved: number; clusters: { label: string; size: number }[] }; content: { created: number; approved: number; uploaded: number; published: number; scheduledNext: number; aiDrafted: number }; recommendations: { open: number; top: { title: string; actionType: string; confidence: string }[] }; summary: { executiveSummary: string; whatHappened: string[]; whyItHappened: string[]; repeat: string[]; stop: string[]; experiments: string[]; nextMonthFocus: string[] } | null; text: string } }
export interface YtOverview { configured: boolean; channels: number; needReconnect: number; videosMonth: number; pendingApproval: number; uploadFailed: number; processing: number; scheduled: number; unresolvedComments: number; openRecommendations: number; quota: { level: string; used: number; softLimit: number; percent?: number } }
export interface YtPlaylist { id: string; youtubePlaylistId: string; title: string; description: string | null; privacyStatus: string | null; itemCount: number | null; lastSyncedAt: string; items: { position: number; video: { id: string; youtubeVideoId: string; title: string; videoType: string; viewCount: number | null } }[] }
export interface YtPlaylistsView { playlists: YtPlaylist[]; unlisted: { id: string; youtubeVideoId: string; title: string; videoType: string; contentPillar: string | null; viewCount: number | null }[] }

// ---------- Website Care (AGENTS_WEB.md) ----------
export interface SiteRow { id: string; brandId: string; url: string; name: string; platform: string; monitorEnabled: boolean; checkIntervalMin: number; expectedText: string | null; lastStatus: string; lastHttpStatus: number | null; lastLatencyMs: number | null; lastCheckedAt: string | null; sslExpiresAt: string | null; sslIssuer: string | null; googleConnectionId: string | null; searchConsoleProperty: string | null; gscStatus: string; gscSyncedAt: string | null; wpUsername: string | null; wpStatus: string; wpUserName: string | null; wpCheckedAt: string | null; wpLastError: string | null; publishingPaused: boolean; disconnectedAt: string | null; createdAt: string; brand: { id: string; name: string; client: { id: string; name: string } }; _count: { incidents: number; contents: number } }
export interface SeoIssue { code: string; severity: 'high' | 'medium' | 'low'; message: string; detail?: string }
export interface SiteSummary { uptime: { checks: number; availabilityPct: number | null; medianLatencyMs: number | null }; latest: Record<string, { status: string; details: Record<string, unknown> | null; error: string | null; checkedAt: string }>; search: { days: number; clicks: number | null; impressions: number | null; avgPosition: number | null; series: { date: string; clicks: number | null; impressions: number | null }[]; topQueries: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[]; topPages: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }; incidents: { id: string; kind: string; startedAt: string; resolvedAt: string | null; summary: string }[] }
export interface SiteDetail extends SiteRow { summary: SiteSummary; checks: { id: string; kind: string; status: string; httpStatus: number | null; latencyMs: number | null; error: string | null; checkedAt: string }[]; analysis: { id: string; result: SeoAnalysisResult; provider: string; model: string; createdAt: string } | null }
export interface SeoAnalysisResult { summary: string; observations?: { text: string; evidence?: string[] }[]; inferences?: { text: string; confidence: string }[]; recommendations: { actionType: string; title: string; why: string; evidence?: string[]; confidence?: string; priority?: number; effort?: string }[]; contentIdeas?: { topic: string; targetQuery: string | null; why: string }[]; dataLimitations?: string[] }
export interface WebOverview { sites: number; down: number; degraded: number; sslExpiring: number; gscNoAccess: number; openIncidents: number; search: { days: number; clicks: number | null; impressions: number | null } }
export interface SiteTrends { weeks: { start: string; availabilityPct: number | null; medianLatencyMs: number | null; clicks: number | null; impressions: number | null }[]; limitations: string[] }

// ---------- W-3 Web content ----------
export interface WebMeta { contentItemId: string; title: string | null; slug: string | null; excerpt: string | null; bodyHtml: string | null; metaTitle: string | null; metaDescription: string | null; targetQuery: string | null; tags: string[]; categories: string[]; featuredImageUrl: string | null; outline: { heading: string; points: string[] }[] | null; sources: { youtubeContentIds?: string[]; facebookPostIds?: string[]; topic?: string | null } | null; wpStatus: string | null; wpPostId: number | null; wpLink: string | null; updatedAt: string }
export interface WebContent { id: string; platform: string; siteId: string | null; status: string; contentType: string; title: string | null; objective: string | null; contentPillar: string | null; scheduledLocal: string | null; scheduledTz: string | null; scheduledAt: string | null; externalPostId: string | null; publishedAt: string | null; aiProvider: string | null; aiModel: string | null; editedByHuman: boolean; aiNotes: { topic?: string; missingInfo?: string[]; aiInterpretation?: string[]; internalLinkIdeas?: string[]; needsHumanInput?: boolean } | null; reviewResult: { result: string; summary: string; issues: { type: string; detail: string; severity: string }[] } | null; lastError: string | null; createdAt: string; updatedAt: string; webMeta: WebMeta | null; site: { id: string; name: string; url: string; platform: string; wpStatus: string; wpUserName: string | null; publishingPaused: boolean; disconnectedAt: string | null; brand: { id: string; name: string; client: { id: string; name: string } } } | null; approvals: ApprovalRow[]; relationsTo: { relationType: string; parent: { id: string; platform: string; title: string | null; status: string } }[]; _count: { revisions: number } }
export interface WebContentSummary { total: number; drafts: number; pendingApproval: number; approved: number; published: number; failed: number; wordpressConnected: number }
export interface WebContentSources { youtube: { id: string; title: string | null; status: string; videoId: string | null }[]; facebook: { id: string; message: string; publishedAt: string | null; permalink: string | null }[] }
export interface WebPublishOutcome { status: 'PUBLISHED' | 'SKIPPED' | 'FAILED'; wpPostId?: number; link?: string; wpStatus?: string; duplicateRecovered?: boolean; reason?: string; error?: string }

// ---------- W-4 Email marketing ----------
export interface EmailProviderView { account: { id: string; provider: string; keyHint: string | null; status: string; accountEmail: string | null; lastError: string | null; verifiedAt: string | null; sendingPaused: boolean; webhookConfigured: boolean; updatedAt: string } | null; sendEnabled: boolean; webhookPath: string | null }
export interface EmailListRow { id: string; brandId: string; name: string; description: string | null; fromEmail: string; fromName: string; replyTo: string | null; consentText: string | null; archivedAt: string | null; createdAt: string; brand: { id: string; name: string; client: { id: string; name: string } }; _count: { campaigns: number }; counts: { subscribed: number; unsubscribed: number; bounced: number; complained: number } }
export interface EmailSubscriberRow { id: string; email: string; name: string | null; status: string; source: string; consentAt: string; consentSource: string | null; unsubscribedAt: string | null; bouncedAt: string | null; createdAt: string }
export interface EmailCampaignRow { id: string; listId: string; name: string; subject: string | null; preheader: string | null; bodyHtml: string | null; bodyText: string | null; status: string; scheduledLocal: string | null; scheduledTz: string | null; scheduledAt: string | null; sentAt: string | null; recipientCount: number | null; sentCount: number; failedCount: number; deliveredCount: number | null; openedCount: number | null; clickedCount: number | null; bouncedCount: number | null; complainedCount: number | null; unsubscribedCount: number | null; sourceContentId: string | null; aiProvider: string | null; aiModel: string | null; editedByHuman: boolean; reviewResult: { result: string; summary: string; issues: { type: string; detail: string; severity: string }[] } | null; aiNotes: { subjectAlternatives?: string[]; missingInfo?: string[]; notes?: string[] } | null; lastError: string | null; createdAt: string; updatedAt: string; list: { id: string; name: string; fromEmail: string; fromName: string; brand: { id: string; name: string } } }
export interface EmailSummary { lists: number; subscribers: number; drafts: number; pendingApproval: number; scheduled: number; sent: number; failed: number; totals: { sent: number | null; opened: number | null; clicked: number | null } }
export interface EmailStats { campaign: EmailCampaignRow; sends: Record<string, number>; events: { type: string; email: string | null; occurredAt: string; provider: string }[]; limitations: string[] }
export interface EmailSendOutcome { status: 'SENT' | 'PARTIAL' | 'FAILED' | 'SKIPPED'; reason?: string; sent: number; failed: number; skipped: number; total: number; retryable: boolean }
