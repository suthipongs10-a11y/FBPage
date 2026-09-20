import { MESSENGER_QUEUE, MetaMessenger, processMessenger, recoverMessenger, type MessengerDeps } from '@fbpm/messenger-core';
import type { AiTaskContext } from '@fbpm/ai-core';
import type { PrismaClient } from '@fbpm/database';
import type { Job, Queue } from 'bullmq';
export { MESSENGER_QUEUE };
/** ทางเดิน AI เดียวกับฝั่ง API — โมเดล/คีย์/งบมาจากการตั้งค่าของพื้นที่ทำงาน ไม่ใช่ env ของ worker */
export function buildAiContext(prisma: PrismaClient, secret: string, env = process.env): AiTaskContext {
  return { prisma, env: { AUTH_SECRET: secret, OPENAI_API_KEY: env.OPENAI_API_KEY, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY: env.GOOGLE_AI_API_KEY, GOOGLE_AI_MODEL: env.GOOGLE_AI_MODEL, OPENROUTER_API_KEY: env.OPENROUTER_API_KEY, LITELLM_API_KEY: env.LITELLM_API_KEY, LITELLM_BASE_URL: env.LITELLM_BASE_URL } };
}
export function buildMessengerDeps(prisma: PrismaClient, secret: string, env = process.env): MessengerDeps {
  const testMode = env.APP_ENV === 'test';
  return { prisma, secret, appId: env.META_APP_ID, testMode, allowAutomaticSend: testMode || env.MESSENGER_AUTO_SEND_ENABLED === 'true', ai: buildAiContext(prisma, secret, env), transport: new MetaMessenger({ version: env.META_GRAPH_API_VERSION, ...(testMode && { testMode, testBaseUrl: env.META_GRAPH_BASE_URL }) }) };
}
export async function handleMessenger(d: MessengerDeps, queue: Queue, job: Pick<Job, 'name' | 'data'>) {
  if (job.name === 'recover') {
    const ids = await recoverMessenger(d);
    for (const id of ids) await queue.add('reply', { conversationId: id }, { jobId: `recover-${id}-${Math.floor(Date.now() / 60000)}`, attempts: 3, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: 200, removeOnFail: 200 });
    return { queued: ids.length };
  }
  if (job.name === 'reply' && typeof job.data.conversationId === 'string') {
    const result = await processMessenger(d, job.data.conversationId);
    // A second question should not wait for the minute-based recovery sweep while the first reply is being generated.
    if (result.status === 'BUSY') await queue.add('reply', { conversationId: job.data.conversationId }, { jobId: `busy-${job.data.conversationId}-${Math.floor((Date.now() + 2000) / 2000)}`, delay: 2000, removeOnComplete: 200, removeOnFail: 200 });
    return result;
  }
  return { skipped: true };
}
