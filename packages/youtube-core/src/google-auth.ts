/** Google OAuth (§6–8) — least privilege: ขอ scope ตามฟีเจอร์ที่เปิดใช้จริง */
import { YouTubeApiError } from './types';

export const GOOGLE_SCOPES = {
  readonly: 'https://www.googleapis.com/auth/youtube.readonly',
  upload: 'https://www.googleapis.com/auth/youtube.upload',
  manage: 'https://www.googleapis.com/auth/youtube.force-ssl',   // metadata + comments + playlists
  analytics: 'https://www.googleapis.com/auth/yt-analytics.readonly',
  revenue: 'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
  email: 'https://www.googleapis.com/auth/userinfo.email',
} as const;
export type ScopeFeature = 'read' | 'analytics' | 'upload' | 'manage' | 'revenue';
/** feature → scope matrix (§8) */
export function scopesForFeatures(features: ScopeFeature[]): string[] {
  const s = new Set<string>([GOOGLE_SCOPES.email, GOOGLE_SCOPES.readonly]);
  if (features.includes('analytics')) s.add(GOOGLE_SCOPES.analytics);
  if (features.includes('upload')) s.add(GOOGLE_SCOPES.upload);
  if (features.includes('manage')) s.add(GOOGLE_SCOPES.manage);
  if (features.includes('revenue')) s.add(GOOGLE_SCOPES.revenue);
  return [...s];
}
export const featuresFromScopes = (scopes: string[]): ScopeFeature[] => {
  const f: ScopeFeature[] = ['read'];
  if (scopes.includes(GOOGLE_SCOPES.analytics)) f.push('analytics');
  if (scopes.includes(GOOGLE_SCOPES.upload)) f.push('upload');
  if (scopes.includes(GOOGLE_SCOPES.manage)) f.push('manage');
  if (scopes.includes(GOOGLE_SCOPES.revenue)) f.push('revenue');
  return f;
};

export interface GoogleAuthOptions { clientId: string; clientSecret: string; redirectUri: string; authBaseUrl?: string; tokenUrl?: string; tokenInfoUrl?: string; revokeUrl?: string; fetchImpl?: typeof fetch }
export interface TokenSet { accessToken: string; refreshToken: string | null; expiresAt: Date; scopes: string[]; idToken?: string }

export class GoogleAuth {
  constructor(private readonly o: GoogleAuthOptions) {}
  private get fetch() { return this.o.fetchImpl ?? fetch; }
  get configured(): boolean { return !!(this.o.clientId && this.o.clientSecret && this.o.redirectUri); }

  authUrl(state: string, scopes: string[], loginHint?: string): string {
    const u = new URL(this.o.authBaseUrl ?? 'https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', this.o.clientId); u.searchParams.set('redirect_uri', this.o.redirectUri); u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', scopes.join(' ')); u.searchParams.set('access_type', 'offline'); u.searchParams.set('prompt', 'consent'); u.searchParams.set('include_granted_scopes', 'true'); u.searchParams.set('state', state);
    if (loginHint) u.searchParams.set('login_hint', loginHint);
    return u.toString();
  }
  private async tokenRequest(body: Record<string, string>): Promise<TokenSet> {
    let res: Response;
    try { res = await this.fetch(this.o.tokenUrl ?? 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.o.clientId, client_secret: this.o.clientSecret, ...body }) }); }
    catch (e) { throw new YouTubeApiError(`ต่อ Google ไม่ได้: ${(e as Error).message}`, 'network', 0); }
    const j = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) {
      const err = String(j.error ?? ''); const code = err === 'invalid_grant' ? 'invalidGrant' : err === 'invalid_client' || err === 'unauthorized_client' ? 'forbidden' : 'invalidRequest';
      throw new YouTubeApiError(`Google OAuth: ${err} ${String(j.error_description ?? '')}`.trim(), code, res.status, j);
    }
    return { accessToken: String(j.access_token), refreshToken: (j.refresh_token as string) ?? null, expiresAt: new Date(Date.now() + Number(j.expires_in ?? 3600) * 1000), scopes: String(j.scope ?? '').split(' ').filter(Boolean), idToken: j.id_token as string | undefined };
  }
  exchangeCode(code: string): Promise<TokenSet> { return this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.o.redirectUri }); }
  refresh(refreshToken: string): Promise<TokenSet> { return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }).then(t => ({ ...t, refreshToken: t.refreshToken ?? refreshToken })); }
  /** ตัวตนของ token: sub + email + scope */
  async tokenInfo(accessToken: string): Promise<{ sub: string | null; email: string | null; scopes: string[]; expiresInSec: number | null }> {
    const u = new URL(this.o.tokenInfoUrl ?? 'https://oauth2.googleapis.com/tokeninfo'); u.searchParams.set('access_token', accessToken);
    const res = await this.fetch(u); const j = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) throw new YouTubeApiError('token ไม่ถูกต้อง', 'invalidGrant', res.status, j);
    return { sub: (j.sub as string) ?? null, email: (j.email as string) ?? null, scopes: String(j.scope ?? '').split(' ').filter(Boolean), expiresInSec: j.expires_in ? Number(j.expires_in) : null };
  }
  async revoke(token: string): Promise<void> {
    try { await this.fetch(this.o.revokeUrl ?? 'https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }); } catch { /* best effort */ }
  }
}
