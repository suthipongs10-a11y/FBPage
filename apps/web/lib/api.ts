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
