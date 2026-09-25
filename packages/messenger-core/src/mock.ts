/** Local fixtures only; never enabled by runtime configuration outside APP_ENV=test. */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
export async function startMockMessenger(port = 0) {
  const state = {
    aiCalls: [] as { key: string; model: string; prompt: string; system: string }[],
    sends: [] as { pageId: string; psid: string; text: string; metadata: string; mid: string }[], subscriptions: [] as string[],
    aiError: 0, sendError: 0, invalidEvidence: false, beforeAi: null as (() => Promise<void>) | null,
  };
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/chat/completions') {
      const prompt = body.messages.find((m: { role: string }) => m.role === 'user')?.content ?? '{}';
      state.aiCalls.push({ key: req.headers.authorization ?? '', model: body.model, prompt, system: body.messages[0]?.content ?? '' });
      await state.beforeAi?.();
      if (state.aiError) { res.statusCode = state.aiError; res.end(JSON.stringify({ error: { message: 'fixture error' } })); return; }
      const data = JSON.parse(prompt); const text = data.conversation?.at(-1)?.text ?? '';
      const fact = data.knowledge?.[0]; const handoff = /แอดมิน|human/.test(text); const clarify = /ไม่ทราบ|unknown/.test(text);
      const reply = { action: handoff ? 'handoff' : clarify ? 'clarify' : 'reply', text: handoff ? 'ได้รับเรื่องแล้วค่ะ จะให้แอดมินดูแลต่อนะคะ' : clarify ? 'สนใจสินค้าหรือบริการประเภทไหนคะ' : `${fact?.content ?? 'สวัสดีค่ะ มีอะไรให้ช่วยคะ'}`, intent: handoff ? 'human_request' : 'product_question', evidenceIds: state.invalidEvidence ? ['OTHER_BRAND_FACT'] : fact ? [fact.id] : [] };
      res.end(JSON.stringify({ model: body.model, choices: [{ message: { content: JSON.stringify(reply) } }], usage: { prompt_tokens: 100, completion_tokens: 40 } })); return;
    }
    const match = req.url?.match(/^\/v[^/]+\/([^/]+)\/(messages|subscribed_apps)$/);
    if (match?.[2] === 'subscribed_apps') { state.subscriptions.push(match[1]!); res.end('{"success":true}'); return; }
    if (match?.[2] === 'messages') {
      const mid = `out-${state.sends.length + 1}`;
      state.sends.push({ pageId: match[1]!, psid: body.recipient.id, text: body.message.text, metadata: body.message.metadata, mid });
      if (state.sendError) { res.statusCode = state.sendError; res.end('{"error":{"message":"fixture send failure"}}'); return; }
      res.end(JSON.stringify({ recipient_id: body.recipient.id, message_id: mid })); return;
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, state, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
