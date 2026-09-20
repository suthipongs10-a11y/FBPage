export interface MessengerConfig { enabled: boolean; instructions: string; fallbackMessage: string; subscribedAt: string | null; updatedAt: string }
export interface MessengerPage { id: string; facebookPageId: string; name: string; tokenStatus: string; disconnectedAt: string | null; brand: { id: string; name: string }; messengerConfig: MessengerConfig | null; _count: { conversations: number } }
export interface MessengerSettingsView { automaticSendEnabled: boolean; settings: { dailyLimit: number; validatedAt: string | null } | null; ai: { provider: string; model: string; source: string } | null; requestsToday: number; automationPaused: boolean; webhookConfigured: boolean; webhookPath: string }
export interface Conversation { id: string; psid: string; mode: string; needsAttention: boolean; lastError: string | null; lastCustomerAt: string | null; updatedAt: string }
export interface Message { id: string; text: string; direction: string; occurredAt: string; status: string; replyText: string | null; replyAction: string | null; error: string | null }
export interface ConversationDetail extends Conversation { pageId: string; messages: Message[] }
export const messengerText = {
  title: 'แชทอัตโนมัติ', subtitle: 'AI ช่วยวิเคราะห์คำถามและเตรียมคำตอบ ด้วยข้อมูลและประวัติของแบรนด์ที่เลือก',
  ai: 'AI ที่ใช้ตอบแชท', model: 'โมเดลที่ระบบจะใช้', dailyLimit: 'จำนวนเรียก AI สูงสุดต่อวัน',
  dedicated: 'แชทใช้คีย์และโมเดลเดียวกับทั้งระบบ ตั้งที่หน้า "โมเดล AI" ในบทบาท "ตอบคอมเมนต์/แชท" — งบรายเดือนของพื้นที่ทำงานคุมค่าใช้จ่ายส่วนนี้ด้วย',
  aiLink: 'ตั้งค่าโมเดล AI', noAi: 'ยังไม่ได้ตั้งค่า AI', aiAuto: 'เลือกอัตโนมัติจากคีย์ที่มี', aiFallback: 'ใช้บทบาทสำรอง',
  limitHint: 'นับรวมทุกเพจและการทดลอง รีเซ็ต 07:00 น. เวลาไทย เพดานนี้เป็นจำนวนครั้ง ไม่ใช่วงเงินค่าใช้จ่าย (วงเงินอยู่ที่หน้าโมเดล AI)',
  save: 'บันทึก', saved: 'บันทึกแล้ว', noKey: 'ยังไม่ได้ตั้งค่า AI', validated: 'ทดลอง AI ผ่านแล้ว', notValidated: 'ยังต้องทดลองคำตอบ',
  used: 'เรียก AI วันนี้', enabledPages: 'เพจที่เปิดผู้ช่วย AI', page: 'เลือกเพจเป้าหมาย', choosePage: 'เลือกเพจ', noPages: 'ยังไม่มีเพจ เชื่อม Facebook และเลือกเพจในเมนูเพจก่อน',
  pageSetup: 'การตอบลูกค้าของเพจนี้', on: 'เปิดตอบอัตโนมัติ', off: 'ปิดตอบอัตโนมัติ', enabledHint: 'การเปิดเพจให้ AI วิเคราะห์ข้อความใหม่มีการใช้ API กรุณาตรวจโหมดการส่งที่แสดงด้านบน',
  instructions: 'แนวทางตอบลูกค้าเพิ่มเติม', instructionsHint: 'เช่น น้ำเสียง คำถามที่ควรถามเพิ่ม และกรณีที่ต้องให้แอดมินดูแล',
  knowledge: 'ใช้ข้อมูลสินค้า ราคา FAQ และนโยบายที่บันทึกในแบรนด์', knowledgeLink: 'จัดการข้อมูลแบรนด์',
  fallback: 'ข้อความรับเรื่องเมื่อ AI ใช้งานไม่ได้', fallbackDefault: 'ได้รับข้อความแล้วค่ะ ขณะนี้ยังตรวจสอบคำตอบให้ไม่ได้ กรุณาฝากรายละเอียดเพิ่มเติม ทีมงานจะเข้ามาดูแลต่อค่ะ',
  subscribe: 'เชื่อมรับข้อความจากเพจ', subscribed: 'เชื่อมรับข้อความแล้ว', missingMeta: 'ยังต้องตั้งค่า Meta App และ webhook สาธารณะ ดูคู่มือ Messenger ในโปรเจ็กต์',
  connectPermission: 'เชื่อม Facebook พร้อมสิทธิ์แชท',
  paused: 'พื้นที่ทำงานนี้หยุดระบบอัตโนมัติอยู่ เปิดต่อได้ในตั้งค่า', pageUnavailable: 'เพจนี้ต้องเชื่อมต่อ Facebook ใหม่',
  preview: 'ทดลองถาม AI', previewHint: 'ใช้คีย์จริงและนับการใช้งาน แต่ไม่ส่งข้อความไปยังลูกค้า บันทึกแนวทางด้านบนก่อนทดลอง',
  question: 'คำถามตัวอย่างจากลูกค้า', questionPlaceholder: 'เช่น มีบริการอะไรบ้าง ราคาเท่าไหร่คะ', test: 'วิเคราะห์และทดลองตอบ', answer: 'คำตอบที่ลูกค้าจะได้รับ',
  inbox: 'บทสนทนาลูกค้า', emptyInbox: 'ยังไม่มีข้อความที่ระบบได้รับสำหรับเพจนี้', pickConversation: 'เลือกบทสนทนาเพื่อดูข้อความและคำตอบ AI',
  customer: 'ลูกค้า', human: 'แอดมินดูแล', auto: 'AI ดูแล', attention: 'ต้องดูแลต่อ', takeOver: 'หยุด AI และรับช่วง', resume: 'ให้ AI ตอบข้อความใหม่ต่อ',
  takeoverHint: 'ตอบลูกค้าต่อใน Facebook Inbox ได้เลย เมื่อเปิด AI ต่อ ระบบจะรอข้อความใหม่ ไม่ส่งคำตอบเก่าย้อนหลัง ข้อความที่เริ่มส่งแล้วอาจยกเลิกไม่ทัน',
  facebookInbox: 'เปิด Meta Business Suite', attachment: 'ข้อความมีไฟล์แนบ', refresh: 'รีเฟรช', noAccess: 'คุณไม่มีสิทธิ์อ่านแชทในพื้นที่ทำงานนี้',
  textOnly: 'รุ่นนี้วิเคราะห์ข้อความ หากมีรูปหรือไฟล์ AI จะขอรายละเอียดเป็นข้อความเพิ่ม',
  statuses: { DRAFT: 'ร่างรอตรวจ — ยังไม่ได้ส่ง', PENDING: 'รอประมวลผล', GENERATING: 'AI กำลังวิเคราะห์', SENDING: 'กำลังส่ง', SENT: 'ส่งแล้ว', FAILED: 'ส่งไม่สำเร็จ', UNKNOWN: 'ยังยืนยันผลส่งไม่ได้ — ตรวจใน Facebook ก่อน', SKIPPED: 'ไม่ได้ตอบอัตโนมัติ', SUPERSEDED: 'มีข้อความหรือการตั้งค่าใหม่แทนแล้ว' } as Record<string, string>,
  actions: { reply: 'ตอบคำถาม', clarify: 'ถามรายละเอียดเพิ่ม', handoff: 'รับเรื่องและส่งต่อแอดมิน' } as Record<string, string>,
  errors: { AI_FAILED: 'AI ใช้งานไม่ได้ชั่วคราว', AI_AUTH: 'ต้องตรวจคีย์หรือชื่อโมเดลที่หน้าโมเดล AI', AI_RATE_LIMIT: 'ผู้ให้บริการ AI จำกัดการเรียกชั่วคราว', AI_NOT_CONFIGURED: 'ยังไม่ได้ตั้งค่า AI ที่หน้าโมเดล AI', AI_BUDGET: 'งบ AI เดือนนี้ถูกใช้หมดแล้ว', DAILY_LIMIT: 'ครบจำนวนเรียก AI ต่อวัน', HUMAN_REPLIED: 'ตรวจพบแอดมินตอบผ่าน Facebook', HANDOFF_REQUESTED: 'ลูกค้าหรือเรื่องนี้ต้องให้แอดมินดูแล', SEND_INTERRUPTED: 'ระบบหยุดระหว่างส่ง กรุณาตรวจใน Facebook', META_OUTCOME_UNKNOWN: 'ยังยืนยันการส่งไม่ได้ กรุณาตรวจใน Facebook', META_MISSING_MESSAGE_ID: 'Facebook ไม่ได้ยืนยันรหัสข้อความ', STATE_CHANGED: 'การตั้งค่าหรือบทสนทนาเปลี่ยนแล้ว', PAGE_PAUSED_OR_WINDOW_CLOSED: 'เพจหยุดทำงานหรือพ้นช่วงเวลาตอบ', PAGE_SETTINGS_CHANGED: 'มีการแก้ตั้งค่าเพจ', CONVERSATION_MODE_CHANGED: 'มีการเปลี่ยนผู้ดูแลแชท' } as Record<string, string>,
};
export const messengerErrorText = (code: string) => messengerText.errors[code] ?? (code.startsWith('META_HTTP_') ? 'Facebook ปฏิเสธการส่ง ตรวจสิทธิ์เพจและการเชื่อมต่อ' : 'ต้องตรวจการตั้งค่าหรือดูแลบทสนทนาต่อ');
