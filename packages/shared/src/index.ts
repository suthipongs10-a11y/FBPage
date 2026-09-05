/**
 * @fbpm/shared — ค่าคงที่และกฎโดเมนล้วนๆ ที่ทุกส่วนของระบบใช้ร่วมกัน
 * ห้ามมี dependency กับ DB, framework หรือ AI provider (AGENTS.md §7, §28, §44, §58)
 */

// ---------- Workspace / RBAC (§9, §58) ----------
export const WORKSPACE_ROLES = ['owner', 'admin', 'manager', 'editor', 'reviewer', 'analyst', 'viewer'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PERMISSIONS = [
  'client.read', 'client.manage',
  'page.read', 'page.connect', 'page.manage',
  'content.read', 'content.create', 'content.edit', 'content.approve', 'content.publish',
  'analytics.read',
  'comments.read', 'comments.reply',
  'leads.read',
  'automation.read', 'automation.manage',
  'ai.use', 'ai.configure',
  'billing.manage', 'workspace.manage',
  // YouTube module (AGENTS_YOUTUBE.md §142)
  'youtube.read', 'youtube.connect', 'youtube.analytics.read', 'youtube.revenue.read',
  'youtube.content.create', 'youtube.content.edit', 'youtube.content.approve', 'youtube.upload', 'youtube.publish', 'youtube.metadata.edit',
  'youtube.comments.read', 'youtube.comments.reply', 'youtube.playlists.manage', 'youtube.live.manage', 'youtube.automation.manage', 'youtube.settings.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** สิทธิ์เริ่มต้นต่อบทบาท — ตรวจด้วย permission เสมอ ไม่ใช่ชื่อบทบาท (§58) */
export const ROLE_PERMISSIONS: Record<WorkspaceRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter(p => p !== 'billing.manage'),
  manager: ['client.read', 'client.manage', 'page.read', 'page.connect', 'page.manage', 'content.read', 'content.create', 'content.edit', 'content.approve', 'content.publish', 'analytics.read', 'comments.read', 'comments.reply', 'leads.read', 'automation.read', 'automation.manage', 'ai.use',
    'youtube.read', 'youtube.connect', 'youtube.analytics.read', 'youtube.content.create', 'youtube.content.edit', 'youtube.content.approve', 'youtube.upload', 'youtube.publish', 'youtube.metadata.edit', 'youtube.comments.read', 'youtube.comments.reply', 'youtube.playlists.manage', 'youtube.automation.manage', 'youtube.settings.manage'],
  editor: ['client.read', 'page.read', 'content.read', 'content.create', 'content.edit', 'analytics.read', 'comments.read', 'comments.reply', 'leads.read', 'automation.read', 'ai.use',
    'youtube.read', 'youtube.analytics.read', 'youtube.content.create', 'youtube.content.edit', 'youtube.comments.read', 'youtube.comments.reply'],
  reviewer: ['client.read', 'page.read', 'content.read', 'content.approve', 'analytics.read', 'comments.read', 'leads.read', 'automation.read', 'youtube.read', 'youtube.analytics.read', 'youtube.content.approve', 'youtube.comments.read'],
  analyst: ['client.read', 'page.read', 'content.read', 'analytics.read', 'comments.read', 'leads.read', 'automation.read', 'ai.use', 'youtube.read', 'youtube.analytics.read', 'youtube.comments.read'],
  viewer: ['client.read', 'page.read', 'content.read', 'analytics.read', 'comments.read', 'leads.read', 'automation.read', 'youtube.read', 'youtube.analytics.read', 'youtube.comments.read'],
};
export const hasPermission = (role: WorkspaceRole, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);

// ---------- Automation (§27) ----------
export const AUTOMATION_LEVELS = ['READ_ONLY', 'AUTO_DRAFT', 'APPROVAL_REQUIRED', 'FULL_AUTO'] as const;
export type AutomationLevel = (typeof AUTOMATION_LEVELS)[number];
export const DEFAULT_AUTOMATION_LEVEL: AutomationLevel = 'APPROVAL_REQUIRED';

// ---------- Tool risk (§44) ----------
export const TOOL_RISK_LEVELS = ['READ', 'WRITE', 'PUBLISH', 'MONEY'] as const;
export type ToolRiskLevel = (typeof TOOL_RISK_LEVELS)[number];

/**
 * เครื่องมือระดับนี้รันได้โดยไม่ต้องขออนุมัติภายใต้ระดับอัตโนมัตินี้หรือไม่
 * MONEY ต้องอนุมัติเสมอ (§26, §27 "Money Actions")
 */
export function toolAllowedWithoutApproval(risk: ToolRiskLevel, level: AutomationLevel): boolean {
  switch (risk) {
    case 'READ': return true;
    case 'WRITE': return level !== 'READ_ONLY';
    case 'PUBLISH': return level === 'FULL_AUTO';
    case 'MONEY': return false;
  }
}

// ---------- Content lifecycle (§28) ----------
export const CONTENT_STATUSES = [
  'IDEA', 'PLANNED', 'DRAFT', 'AI_REVIEW', 'NEEDS_REVISION', 'READY_FOR_APPROVAL',
  'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'ANALYZED',
  'REJECTED', 'PUBLISH_FAILED', 'CANCELLED',
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

const CONTENT_TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
  IDEA: ['PLANNED', 'DRAFT', 'CANCELLED'],
  PLANNED: ['DRAFT', 'CANCELLED'],
  DRAFT: ['AI_REVIEW', 'READY_FOR_APPROVAL', 'CANCELLED'],
  AI_REVIEW: ['NEEDS_REVISION', 'READY_FOR_APPROVAL', 'CANCELLED'],
  NEEDS_REVISION: ['DRAFT', 'CANCELLED'],
  READY_FOR_APPROVAL: ['APPROVED', 'REJECTED', 'NEEDS_REVISION', 'CANCELLED'],
  APPROVED: ['SCHEDULED', 'PUBLISHING', 'CANCELLED'],
  SCHEDULED: ['PUBLISHING', 'APPROVED', 'CANCELLED'],
  PUBLISHING: ['PUBLISHED', 'PUBLISH_FAILED'],
  PUBLISHED: ['ANALYZED'],
  ANALYZED: [],
  REJECTED: ['DRAFT'],
  PUBLISH_FAILED: ['SCHEDULED', 'APPROVED', 'CANCELLED'],
  CANCELLED: [],
};
export const canTransitionContent = (from: ContentStatus, to: ContentStatus): boolean =>
  CONTENT_TRANSITIONS[from].includes(to);
export const nextContentStatuses = (from: ContentStatus): readonly ContentStatus[] => CONTENT_TRANSITIONS[from];

// ---------- Approval (§29) ----------
export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'EXPIRED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

// ---------- Comments (§23) ----------
export const COMMENT_CLASSES = ['QUESTION', 'LEAD', 'COMPLAINT', 'PRAISE', 'SPAM', 'PRICE_QUERY', 'LOCATION_QUERY', 'SERVICE_QUERY', 'OTHER'] as const;
export type CommentClass = (typeof COMMENT_CLASSES)[number];

// ---------- Brand knowledge (§9) ----------
export const BRAND_KNOWLEDGE_TYPES = [
  'business_info', 'product', 'service', 'faq', 'price', 'location', 'policy',
  'brand_voice', 'prohibited_claim', 'customer_persona', 'past_campaign',
] as const;
export type BrandKnowledgeType = (typeof BRAND_KNOWLEDGE_TYPES)[number];

// ---------- AI roles (§5) ----------
export const AI_ROLES = ['strategy', 'content', 'analysis', 'community', 'research', 'vision', 'fast', 'fallback'] as const;
export type AiRole = (typeof AI_ROLES)[number];

// ---------- Normalized metrics (§60) ----------
/** ค่า null = อ่านไม่ได้ (สิทธิ์ไม่พอ / Meta ไม่ส่ง) — ห้ามแปลงเป็น 0 (ดู ADR-001) */
export interface NormalizedMetric {
  metric: string;
  value: number | null;
  period?: string;
  sourceMetric: string;
  capturedAt: string; // ISO 8601
}

// ---------- Tool context (§43) ----------
export interface ToolContext {
  userId: string;
  workspaceId: string;
  clientId?: string;
  brandId?: string;
  pageId?: string;
  requestId: string;
}

// ---------- Background job queues (§46) — ใช้ชื่อเดียวกันทั้ง API (ผู้ส่ง) และ worker (ผู้รับ) ----------
export const QUEUES = {
  facebookSync: 'facebook-sync', facebookPublish: 'facebook-publish', facebookWebhook: 'facebook-webhook',
  analytics: 'analytics', ai: 'ai', media: 'media', reports: 'reports', maintenance: 'maintenance',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
/** ชื่องานในคิว — jobId ต้องกำหนดจากทรัพยากรเพื่อกันงานซ้ำ (§48) */
export const JOBS = { publishContent: 'publish-content', syncPage: 'sync-page', syncAllPages: 'sync-all-pages', collectPostMetrics: 'collect-post-metrics', syncComments: 'sync-comments', webhookEvent: 'webhook-event',
  ytSyncChannel: 'yt-sync-channel', ytSyncAll: 'yt-sync-all', ytCollectVideoMetrics: 'yt-collect-video-metrics', ytSyncComments: 'yt-sync-comments', ytUpload: 'yt-upload', ytCheckProcessing: 'yt-check-processing' } as const;
export const YT_QUEUES = { sync: 'youtube-sync', analytics: 'youtube-analytics', reporting: 'youtube-reporting', upload: 'youtube-upload', comments: 'youtube-comments', live: 'youtube-live', maintenance: 'youtube-maintenance' } as const;
export const ytUploadJobId = (contentId: string) => `ytupload-${contentId}`;
/** BullMQ ห้ามมี ':' ใน jobId */
export const publishJobId = (contentId: string) => `publish-${contentId}`;

// ---------- Webhook events (§14) — รูปแบบกลางที่ worker ประมวลผล ----------
export type SocialEvent =
  | { type: 'COMMENT_CREATED'; facebookPageId: string; postId: string | null; commentId: string; message: string | null; fromId: string | null; fromName: string | null; createdTime: string }
  | { type: 'POST_UPDATED'; facebookPageId: string; postId: string; verb: string }
  | { type: 'MESSAGE_RECEIVED'; facebookPageId: string; senderId: string; text: string | null }
  | { type: 'TOKEN_ERROR'; facebookPageId: string; reason: string }
  | { type: 'UNKNOWN'; facebookPageId: string; field: string; raw: unknown };

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST', 'SPAM'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const REPLY_STATUSES = ['NONE', 'DRAFTED', 'APPROVED', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

// ---------- Platforms (AGENTS_YOUTUBE.md §24, §112) ----------
export const PLATFORMS = ['FACEBOOK', 'YOUTUBE'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const YT_VIDEO_TYPES = ['LONG_FORM', 'SHORT', 'LIVE', 'PREMIERE', 'UNKNOWN'] as const;
export type YtVideoType = (typeof YT_VIDEO_TYPES)[number];
/** YouTube content lifecycle (§26) — ใช้กับ ContentItem ที่ platform=YOUTUBE (สถานะร่วมกับ FB: DRAFT/AI_REVIEW/NEEDS_REVISION/READY_FOR_APPROVAL/APPROVED/SCHEDULED/PUBLISHED/ANALYZED/REJECTED/CANCELLED) */
export const YT_CONTENT_STATUSES = ['IDEA', 'RESEARCH', 'OUTLINE', 'SCRIPT', 'PRODUCTION', 'VIDEO_READY', 'METADATA_READY', 'THUMBNAIL_READY', 'AI_REVIEW', 'READY_FOR_APPROVAL', 'APPROVED', 'UPLOAD_PENDING', 'UPLOADING', 'PROCESSING', 'SCHEDULED', 'PUBLISHED', 'ANALYTICS_PENDING', 'ANALYZED', 'REJECTED', 'UPLOAD_FAILED', 'PROCESSING_FAILED', 'PUBLISH_FAILED', 'CANCELLED'] as const;
export type YtContentStatus = (typeof YT_CONTENT_STATUSES)[number];
const YT_TRANSITIONS: Record<YtContentStatus, readonly YtContentStatus[]> = {
  IDEA: ['RESEARCH', 'OUTLINE', 'SCRIPT', 'CANCELLED'], RESEARCH: ['OUTLINE', 'SCRIPT', 'CANCELLED'], OUTLINE: ['SCRIPT', 'CANCELLED'], SCRIPT: ['PRODUCTION', 'VIDEO_READY', 'OUTLINE', 'CANCELLED'],
  PRODUCTION: ['VIDEO_READY', 'CANCELLED'], VIDEO_READY: ['METADATA_READY', 'CANCELLED'], METADATA_READY: ['THUMBNAIL_READY', 'AI_REVIEW', 'READY_FOR_APPROVAL', 'CANCELLED'], THUMBNAIL_READY: ['AI_REVIEW', 'READY_FOR_APPROVAL', 'CANCELLED'],
  AI_REVIEW: ['READY_FOR_APPROVAL', 'SCRIPT', 'METADATA_READY', 'CANCELLED'], READY_FOR_APPROVAL: ['APPROVED', 'REJECTED', 'METADATA_READY', 'CANCELLED'], APPROVED: ['UPLOAD_PENDING', 'CANCELLED', 'METADATA_READY'],
  UPLOAD_PENDING: ['UPLOADING', 'UPLOAD_FAILED', 'CANCELLED', 'APPROVED'], UPLOADING: ['PROCESSING', 'UPLOAD_FAILED'], PROCESSING: ['SCHEDULED', 'PUBLISHED', 'PROCESSING_FAILED'],
  SCHEDULED: ['PUBLISHED', 'PUBLISH_FAILED', 'CANCELLED'], PUBLISHED: ['ANALYTICS_PENDING', 'ANALYZED'], ANALYTICS_PENDING: ['ANALYZED'], ANALYZED: [],
  REJECTED: ['SCRIPT', 'METADATA_READY'], UPLOAD_FAILED: ['UPLOAD_PENDING', 'APPROVED', 'CANCELLED'], PROCESSING_FAILED: ['UPLOAD_PENDING', 'CANCELLED'], PUBLISH_FAILED: ['SCHEDULED', 'CANCELLED'], CANCELLED: [],
};
export const canTransitionYt = (from: YtContentStatus, to: YtContentStatus): boolean => YT_TRANSITIONS[from].includes(to);
export const YT_COMMENT_CLASSES = ['QUESTION', 'CONTENT_REQUEST', 'PRAISE', 'CRITICISM', 'CORRECTION', 'EXPERIENCE_SHARE', 'SPAM', 'PRODUCT_INTEREST', 'SERVICE_INTEREST', 'FOLLOW_UP_QUESTION', 'MISUNDERSTANDING', 'FACT_CHALLENGE', 'OTHER'] as const;
export type YtCommentClass = (typeof YT_COMMENT_CLASSES)[number];
export const YT_RECOMMENDATION_ACTIONS = ['CREATE_FOLLOWUP', 'CREATE_SHORT', 'CREATE_FACEBOOK_POST', 'OPTIMIZE_TITLE', 'OPTIMIZE_THUMBNAIL', 'UPDATE_DESCRIPTION', 'ADD_TO_PLAYLIST', 'CREATE_PLAYLIST', 'REPLY_COMMENT', 'CREATE_SERIES', 'REVIVE_VIDEO'] as const;
export type YtRecommendationAction = (typeof YT_RECOMMENDATION_ACTIONS)[number];
export const PERFORMANCE_WINDOWS = ['FIRST_24H', 'FIRST_72H', 'FIRST_7D', 'FIRST_28D', 'LIFETIME'] as const;
export const CONTENT_RELATION_TYPES = ['REPURPOSED_FROM', 'CLIPPED_FROM', 'FOLLOWUP_TO', 'SERIES_MEMBER', 'INSPIRED_BY'] as const;
export const BRAND_INSIGHT_TYPES = ['STRONG_TOPIC', 'CONTENT_GAP', 'AUDIENCE_QUESTION', 'CROSS_PLATFORM_OPPORTUNITY', 'REVIVAL_OPPORTUNITY'] as const;
