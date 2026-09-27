import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommentsPermissionError, FacebookService, MessagingPermissionError } from './index';
import { startMockGraph, type MockState } from './mock-graph';

let url = ''; let state: MockState; let close: () => void;
beforeAll(async () => { const m = await startMockGraph(); url = m.url; state = m.state; close = () => m.server.close(); });
afterAll(() => close());
const svc = () => new FacebookService({ baseUrl: url, version: 'v26.0', maxRetries: 0, sleep: async () => undefined });

describe('ไลค์คอมเมนต์ + ส่งข้อความเข้าอินบ็อกซ์จากคอมเมนต์ (private reply)', () => {
  it('ไลค์คอมเมนต์ในนามเพจ · ไม่มีสิทธิ์ = CommentsPermissionError', async () => {
    await svc().likeComment('c1', 'PAGE_111');
    expect(state.likes).toEqual(['c1']);
    state.denyComments = true;
    await expect(svc().likeComment('c2', 'PAGE_111')).rejects.toBeInstanceOf(CommentsPermissionError);
    state.denyComments = false;
  });
  it('private reply ส่ง recipient.comment_id · ส่งซ้ำคอมเมนต์เดิม/ไม่มีสิทธิ์ = MessagingPermissionError พร้อมเหตุผล', async () => {
    const r = await svc().privateReply('111', 'c1', 'PAGE_111', 'ราคาแพ็กเกจ 30 คน เริ่มต้น 15,000 บาทค่ะ');
    expect(r).toEqual({ messageId: 'm_1', recipientId: 'psid_c1' });
    expect(state.privateReplies).toEqual([{ pageId: '111', commentId: 'c1', text: 'ราคาแพ็กเกจ 30 คน เริ่มต้น 15,000 บาทค่ะ' }]);
    await expect(svc().privateReply('111', 'c1', 'PAGE_111', 'ซ้ำ')).rejects.toThrow('ครั้งเดียว');
    state.denyMessaging = true;
    const e = await svc().privateReply('111', 'c2', 'PAGE_111', 'x').catch(x => x);
    expect(e).toBeInstanceOf(MessagingPermissionError); expect((e as Error).message).toContain('pages_messaging');
    state.denyMessaging = false;
  });
});
