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
export interface WorkspaceDetail { id: string; name: string; slug: string; timezone: string; automationPaused: boolean; role: string; permissions: string[]; _count: { clients: number; members: number } }

// ---------- Facebook (Phase 3–4) ----------
export interface FbConnection { id: string; providerUserId: string; providerUserName: string | null; scopes: string[]; status: string; tokenExpiresAt: string | null; lastValidatedAt: string | null; createdAt: string; user: { id: string; name: string } | null; _count: { pages: number } }
export interface AvailablePage { id: string; name: string; category: string | null; tasks: string[]; pictureUrl: string | null; connected: { pageId: string; brandId: string; brandName: string } | null }
export interface PageRow {
  id: string; brandId: string; connectionId: string; facebookPageId: string; name: string; username: string | null; category: string | null; pictureUrl: string | null; link: string | null; fanCount: number | null;
  tokenStatus: string; tasks: string[]; automationLevel: string; publishingPaused: boolean; timezone: string | null; connectedAt: string; lastSyncedAt: string | null; lastSyncError: string | null; lastValidatedAt: string | null; disconnectedAt: string | null;
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
