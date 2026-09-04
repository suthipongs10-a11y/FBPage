// Mock AI แบบ OpenAI-compatible: รอบแรกขอเรียก list_pages + audit_page, รอบสองสร้างภาพ, รอบสาม prepare_post, รอบสี่ตอบข้อความ
import { createServer } from 'node:http';
let round = 0;
createServer((req, res) => {
  let s = ''; req.on('data', c => s += c); req.on('end', () => {
    const body = JSON.parse(s);
    const hasTools = Array.isArray(body.tools);
    const lastRole = body.messages.at(-1)?.role;
    round++;
    let message;
    if (round === 1 && hasTools) message = { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_pages', arguments: '{}' } }] };
    else if (round === 2) message = { role: 'assistant', content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 'create_card', arguments: JSON.stringify({ template: 'tips', theme: 'phuketmaids', data: { kicker: 'mock', title: 'ทดสอบ *AI*', items: [{ title: 'ข้อ 1', text: 'จาก mock' }], brand: 'Mock' } }) } }] };
    else if (round === 3) {
      // หา page id จาก tool result รอบแรก
      const tr = body.messages.find(m => m.role === 'tool' && m.tool_call_id === 'c1');
      const pages = JSON.parse(tr.content); const card = JSON.parse(body.messages.find(m => m.role === 'tool' && m.tool_call_id === 'c2').content);
      message = { role: 'assistant', content: null, tool_calls: [{ id: 'c3', type: 'function', function: { name: 'prepare_post', arguments: JSON.stringify({ page_id: pages[0].id, message: 'โพสต์จาก mock AI', photos: [card.path] }) } }] };
    } else message = { role: 'assistant', content: `ร่างเสร็จแล้ว รอกดยืนยัน (lastRole=${lastRole}, rounds=${round})` };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  });
}).listen(8790, '127.0.0.1', () => console.log('mock ai on 8790'));
