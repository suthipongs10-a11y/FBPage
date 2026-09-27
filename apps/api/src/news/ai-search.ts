/**
 * ให้ AI ค้นเว็บเองแบบที่ได้ผลจริง — แยกเป็นสองขั้น:
 *   ขั้น 1 (ตรงนี้): ขอ "ข้อค้นพบเป็นข้อความ" พร้อมเครื่องมือค้นเว็บ ไม่บังคับ JSON
 *     (บังคับ JSON พร้อมกัน โมเดลอย่าง Gemini 2.5 Pro มักตอบจากความจำโดยไม่เรียกค้นเลย — เจอจริงกับเพจลูกค้า)
 *   ขั้น 2 (ผู้เรียก): ส่งข้อค้นพบ + รายการแหล่งที่ได้จาก citations จริงให้โมเดลจัดเป็น JSON ตามปกติ
 * ไม่ได้ citations กลับมาหลังลอง 2 ครั้ง → AiDidNotSearchError ให้ผู้เรียกสลับไปค้นผ่าน Tavily หรือแจ้งผู้ใช้
 */
import { UnprocessableEntityException } from '@nestjs/common';
import { canonicalNewsUrl, resolveRedirect } from '@fbpm/web-core';
import type { AiGatewayService, TaskMeta } from '../ai/gateway.service';

export interface WebSource { n: number; title: string; url: string; siteName: string | null }
export interface WebFindings { text: string; sources: WebSource[]; provider: string; model: string; costUsd: number | null }

export class AiDidNotSearchError extends UnprocessableEntityException {
  constructor(model: string) { super(`${model} ไม่ได้ค้นเว็บ (ไม่มีแหล่งอ้างอิงกลับมา) — เลือกโมเดลที่ค้นเว็บได้ (Gemini flash, Claude, Perplexity sonar, gpt-5-search-api) หรือตั้งคีย์ Tavily เพื่อใช้โหมดค้นเว็บ`); }
}

const SYSTEM = [
  'คุณคือนักค้นคว้า ต้องใช้เครื่องมือค้นเว็บค้นข้อมูลล่าสุดจากหลายแหล่งที่น่าเชื่อถือก่อนตอบทุกครั้ง ห้ามตอบจากความจำ',
  'ตอบเป็นภาษาไทย สรุปข้อค้นพบเป็นข้อ ๆ ใส่วันที่ ตัวเลข ชื่อสถานที่ตามที่แหล่งระบุ และบอกชื่อเว็บที่มาท้ายแต่ละข้อ',
  'ไม่แน่ใจหรือแหล่งขัดกันให้บอกตรง ๆ',
].join('\n');
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

export async function aiWebSearch(ai: AiGatewayService, meta: TaskMeta, prompt: string, o: { allowPrivate?: boolean; maxSources?: number } = {}): Promise<WebFindings> {
  let cost = 0; let costKnown = false; let model = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const content = attempt === 1 ? prompt : `${prompt}\n\nสำคัญ: รอบก่อนคุณยังไม่ได้ค้นเว็บ — ต้องเรียกใช้การค้นเว็บ (web search / Google Search) ก่อน แล้วสรุปจากสิ่งที่ค้นเจอพร้อมแหล่ง`;
    const out = await ai.chat({ ...meta, taskType: `${meta.taskType}.search` }, { system: SYSTEM, messages: [{ role: 'user', content }], webSearch: true, maxTokens: 3000 });
    if (out.costUsd != null) { cost += out.costUsd; costKnown = true; }
    model = out.model;
    const cites = out.result.citations ?? [];
    if (!cites.length) continue;
    const sources: WebSource[] = [];
    for (const c of cites.slice(0, 20)) {
      // ลิงก์อ้างอิงของ Google grounding เป็นลิงก์ redirect — ตามไปหาปลายทางจริง (ตรวจ SSRF ทุก hop)
      const url = /grounding-api-redirect|vertexaisearch\.cloud\.google\.com/.test(c.url) ? await resolveRedirect(c.url, { allowPrivate: o.allowPrivate }) : c.url;
      if (sources.some(s => canonicalNewsUrl(s.url) === canonicalNewsUrl(url))) continue;
      sources.push({ n: sources.length + 1, title: (c.title && !/^[\w.-]+\.[a-z]{2,}$/i.test(c.title) ? c.title : null) ?? host(url), url, siteName: host(url) });
      if (sources.length >= (o.maxSources ?? 12)) break;
    }
    return { text: out.result.text.slice(0, 12000), sources, provider: out.provider, model: out.model, costUsd: costKnown ? cost : null };
  }
  throw new AiDidNotSearchError(model || 'โมเดลนี้');
}
