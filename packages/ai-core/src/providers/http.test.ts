import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { postJson } from './http';
it('times out when a provider sends headers but never completes the response body', async () => {
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders(); res.write('{'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try { await expect(postJson(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, {}, {}, 'openai', 150)).rejects.toMatchObject({ name: 'AiProviderError', status: null }); }
  finally { server.closeAllConnections(); server.close(); }
});
