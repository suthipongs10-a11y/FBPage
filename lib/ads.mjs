/**
 * lib/ads.mjs — อ่านข้อมูลโฆษณาจาก Meta Marketing API (อ่านอย่างเดียว)
 *
 * ต้องใช้ token ที่มีสิทธิ์ ads_read (token เพจปกติไม่มี) — ตั้งในหน้าตั้งค่าของแดชบอร์ด
 * ห้ามส่ง token ออกไปหน้าเว็บ และห้าม log
 */
import { graph } from './graph.mjs';

const num = v => (v == null ? null : Number(v));

/** บัญชีโฆษณาที่ token มองเห็น */
export async function listAdAccounts(token) {
  const j = await graph('me/adaccounts', {
    token, params: { fields: 'id,account_id,name,account_status,currency,amount_spent,balance', limit: 50 },
  });
  const STATUS = { 1: 'ACTIVE', 2: 'DISABLED', 3: 'UNSETTLED', 7: 'PENDING_RISK_REVIEW', 8: 'PENDING_SETTLEMENT', 9: 'IN_GRACE_PERIOD', 100: 'PENDING_CLOSURE', 101: 'CLOSED' };
  return (j.data || []).map(a => ({
    id: a.account_id, name: a.name, currency: a.currency,
    status: STATUS[a.account_status] || String(a.account_status),
    amount_spent: num(a.amount_spent) != null ? num(a.amount_spent) / 100 : null,
  }));
}

/** เพจที่ผูกกับบัญชีโฆษณา — ใช้จับคู่แคมเปญ→เพจผ่าน object_story_id ของครีเอทีฟ */
async function creativePageMap(token, accountId) {
  const map = {};
  try {
    const j = await graph(`act_${accountId}/adcreatives`, {
      token, params: { fields: 'id,object_story_id,effective_object_story_id', limit: 200 },
    });
    for (const c of j.data || []) {
      const sid = c.effective_object_story_id || c.object_story_id;
      if (sid) map[c.id] = sid.split('_')[0];
    }
  } catch { /* ไม่มีสิทธิ์ก็ข้าม */ }
  return map;
}

/**
 * แคมเปญทั้งหมด + ตัวเลขในช่วงเวลา
 * datePreset: today | yesterday | last_7d | last_14d | last_30d | this_month | last_month | maximum
 */
export async function campaignReport(token, accountId, datePreset = 'last_30d') {
  const [camps, ins, pageMap] = await Promise.all([
    graph(`act_${accountId}/campaigns`, {
      token, params: { fields: 'id,name,effective_status,objective,daily_budget,lifetime_budget', limit: 200 },
    }),
    graph(`act_${accountId}/insights`, {
      token, params: {
        level: 'campaign', date_preset: datePreset, limit: 200,
        fields: 'campaign_id,campaign_name,spend,impressions,reach,clicks,cpm,ctr,actions,cost_per_action_type',
      },
    }),
    creativePageMap(token, accountId),
  ]);

  // แคมเปญ→เพจ: ดึง ad แรกของแต่ละแคมเปญแล้วดูครีเอทีฟ (พยายามแบบเบาๆ ถ้าไม่ได้ก็เว้นไว้)
  let adMap = {};
  try {
    const ads = await graph(`act_${accountId}/ads`, { token, params: { fields: 'campaign_id,creative{id}', limit: 200 } });
    for (const a of ads.data || []) {
      const pid = pageMap[a.creative?.id];
      if (pid && !adMap[a.campaign_id]) adMap[a.campaign_id] = pid;
    }
  } catch { /* ข้าม */ }

  const byId = {};
  for (const c of camps.data || []) {
    byId[c.id] = {
      id: c.id, name: c.name, status: c.effective_status, objective: c.objective,
      daily_budget: num(c.daily_budget) != null ? num(c.daily_budget) / 100 : null,
      lifetime_budget: num(c.lifetime_budget) != null ? num(c.lifetime_budget) / 100 : null,
      page_id: adMap[c.id] || null,
      spend: 0, impressions: 0, reach: 0, clicks: 0, cpm: null, ctr: null, results: null, result_type: null, cost_per_result: null,
    };
  }
  const RESULT_KEYS = ['onsite_conversion.messaging_conversation_started_7d', 'lead', 'purchase', 'link_click', 'post_engagement', 'page_engagement'];
  for (const r of ins.data || []) {
    const c = byId[r.campaign_id] || (byId[r.campaign_id] = { id: r.campaign_id, name: r.campaign_name, status: null, page_id: null });
    c.spend = num(r.spend) || 0; c.impressions = num(r.impressions) || 0; c.reach = num(r.reach) || 0;
    c.clicks = num(r.clicks) || 0; c.cpm = num(r.cpm); c.ctr = num(r.ctr);
    const act = (r.actions || []);
    const key = RESULT_KEYS.find(k => act.some(a => a.action_type === k));
    if (key) {
      c.results = num(act.find(a => a.action_type === key).value);
      c.result_type = key;
      const cpa = (r.cost_per_action_type || []).find(a => a.action_type === key);
      c.cost_per_result = cpa ? num(cpa.value) : (c.results ? +(c.spend / c.results).toFixed(2) : null);
    }
  }
  const campaigns = Object.values(byId).sort((a, b) => b.spend - a.spend);
  const total = campaigns.reduce((t, c) => ({ spend: t.spend + c.spend, impressions: t.impressions + c.impressions, results: t.results + (c.results || 0) }), { spend: 0, impressions: 0, results: 0 });
  return { account_id: accountId, date_preset: datePreset, campaigns, total };
}

/** ค่าใช้จ่ายรายวัน (ทั้งบัญชี) ไว้วาดกราฟ */
export async function dailySpend(token, accountId, days = 30) {
  const until = new Date(); const since = new Date(Date.now() - (days - 1) * 86400000);
  const fmt = d => d.toISOString().slice(0, 10);
  const j = await graph(`act_${accountId}/insights`, {
    token, params: {
      level: 'account', time_increment: 1, limit: 400,
      time_range: { since: fmt(since), until: fmt(until) },
      fields: 'spend,impressions,clicks,actions',
    },
  });
  return (j.data || []).map(r => ({
    date: r.date_start, spend: num(r.spend) || 0, impressions: num(r.impressions) || 0, clicks: num(r.clicks) || 0,
    messages: num((r.actions || []).find(a => a.action_type === 'onsite_conversion.messaging_conversation_started_7d')?.value) || 0,
  }));
}
