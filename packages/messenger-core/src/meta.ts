export class MessengerSendError extends Error {
  constructor(public readonly uncertain: boolean, public readonly code: string) { super(code); }
}
export interface MessengerTransport {
  send(pageId: string, token: string, psid: string, text: string, metadata: string): Promise<string>;
  subscribe(pageId: string, token: string): Promise<void>;
}

/** Fixed Meta origin outside tests. Sending is a single attempt; unknown outcome requires reconciliation. */
export class MetaMessenger implements MessengerTransport {
  private readonly base: string;
  constructor(options: { version?: string; testBaseUrl?: string; testMode?: boolean } = {}) {
    if (options.testBaseUrl && !options.testMode) throw new Error('Messenger mock endpoint is only allowed in test mode');
    this.base = `${(options.testBaseUrl ?? 'https://graph.facebook.com').replace(/\/$/, '')}/${options.version ?? 'v26.0'}`;
  }
  private async request(pageId: string, path: string, token: string, payload: unknown): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(`${this.base}/${encodeURIComponent(pageId)}/${path}`, { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new MessengerSendError(response.status >= 500, `META_HTTP_${response.status}`);
      return await response.json() as Record<string, unknown>;
    } catch (e) {
      if (e instanceof MessengerSendError) throw e;
      throw new MessengerSendError(true, 'META_OUTCOME_UNKNOWN');
    }
  }
  async send(pageId: string, token: string, psid: string, text: string, metadata: string): Promise<string> {
    const r = await this.request(pageId, 'messages', token, { recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text, metadata } });
    if (typeof r.message_id !== 'string' || !r.message_id) throw new MessengerSendError(true, 'META_MISSING_MESSAGE_ID');
    return r.message_id;
  }
  async subscribe(pageId: string, token: string): Promise<void> {
    // Keep the existing feed subscription for comment/post ingestion.
    const r = await this.request(pageId, 'subscribed_apps', token, { subscribed_fields: ['feed', 'messages', 'message_echoes'] });
    if (r.success !== true) throw new MessengerSendError(false, 'META_SUBSCRIPTION_FAILED');
  }
}
