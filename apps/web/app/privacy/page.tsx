'use client';
import { LegalPage, type LegalSection } from '@/components/legal-page';

const th: LegalSection[] = [
  { h: 'เกี่ยวกับบริการนี้', body: c => <p>{c.operator} ให้บริการระบบช่วยดูแลเพจ Facebook ที่ {c.host} สำหรับธุรกิจที่มอบหมายให้เราดูแลเพจ นโยบายนี้อธิบายว่าเราเก็บและใช้ข้อมูลอะไร</p> },
  { h: 'ข้อมูลที่เราเก็บ', body: () => <ul className="list-disc space-y-1 pl-5">
    <li><b>บัญชีผู้ใช้ระบบ:</b> ชื่อ อีเมล และรหัสผ่าน (เก็บแบบเข้ารหัสทางเดียว)</li>
    <li><b>ข้อมูลเพจ Facebook ที่ผู้ดูแลเพจเชื่อมเข้าระบบ:</b> ชื่อและรหัสเพจ, access token ของเพจ (เข้ารหัสก่อนบันทึก), โพสต์ และตัวเลขสถิติของเพจ</li>
    <li><b>คอมเมนต์บนโพสต์ของเพจ:</b> ชื่อผู้คอมเมนต์ รหัสผู้ใช้ที่ Facebook ให้กับแอป และข้อความคอมเมนต์ เพื่อจัดประเภทคำถาม ร่างคำตอบ และติดตามลูกค้าที่สนใจ</li>
    <li><b>ข้อความ Messenger ที่ส่งถึงเพจ:</b> รหัสผู้ส่งเฉพาะเพจ (PSID) และข้อความ เพื่อร่างหรือส่งคำตอบในนามของเพจ</li>
  </ul> },
  { h: 'เราใช้ข้อมูลอย่างไร', body: () => <ul className="list-disc space-y-1 pl-5">
    <li>เผยแพร่โพสต์ ตอบคอมเมนต์ และตอบข้อความ ในนามเพจที่เจ้าของเพจอนุญาตเท่านั้น</li>
    <li>ส่งข้อความที่เกี่ยวข้อง (เช่น คอมเมนต์หรือข้อความแชท และข้อมูลสินค้า/บริการของเพจ) ไปยังผู้ให้บริการ AI ที่ธุรกิจเลือก เพื่อสร้างร่างคำตอบ</li>
    <li>ทำรายงานผลของเพจให้เจ้าของเพจ</li>
    <li>เราไม่ขายข้อมูล ไม่ใช้ข้อมูลเพื่อยิงโฆษณา และไม่ส่งต่อให้บุคคลอื่น นอกจากผู้ให้บริการที่จำเป็นต่อการทำงาน (ผู้ให้บริการเซิร์ฟเวอร์, ผู้ให้บริการ AI ที่ธุรกิจเลือก และ Meta)</li>
  </ul> },
  { h: 'การเก็บรักษาและความปลอดภัย', body: () => <p>ข้อมูลเก็บไว้ตราบเท่าที่เพจยังเชื่อมกับระบบ หรือจนกว่าจะมีคำขอให้ลบ token ของเพจและคีย์ต่างๆ ถูกเข้ารหัสก่อนบันทึก และการเชื่อมต่อทั้งหมดใช้ HTTPS</p> },
  { h: 'สิทธิ์ของคุณและการลบข้อมูล', body: c => <p>คุณขอดู แก้ไข หรือลบข้อมูลของคุณได้ ติดต่อ {c.email} หรือดูวิธีที่หน้า <a className="text-sky-600 underline" href="/data-deletion">การลบข้อมูล</a></p> },
  { h: 'ติดต่อ', body: c => <p>{c.operator} · {c.email}</p> },
];

const en: LegalSection[] = [
  { h: 'About this service', body: c => <p>{c.operator} operates a Facebook Page management tool at {c.host} for businesses that ask us to manage their Pages. This policy explains what data we collect and how we use it.</p> },
  { h: 'Data we collect', body: () => <ul className="list-disc space-y-1 pl-5">
    <li><b>User accounts of this tool:</b> name, email and password (stored as a one-way hash).</li>
    <li><b>Facebook Pages connected by their admins:</b> Page name and ID, the Page access token (encrypted at rest), posts and Page metrics.</li>
    <li><b>Comments on the Page&apos;s posts:</b> commenter name, the user ID provided by Facebook, and the comment text. We use these to classify questions, draft replies and follow up with interested customers.</li>
    <li><b>Messenger messages sent to the Page:</b> the page-scoped sender ID (PSID) and message text. We use these to draft or send replies on behalf of the Page.</li>
  </ul> },
  { h: 'How we use data', body: () => <ul className="list-disc space-y-1 pl-5">
    <li>To publish posts and reply to comments and messages, only on behalf of Pages whose owners authorized it.</li>
    <li>To send relevant text to the AI provider chosen by the business to draft replies. This includes comments, chat messages and the Page&apos;s product or service information.</li>
    <li>To produce performance reports for the Page owner.</li>
    <li>We do not sell data or use it for ad targeting. We share it only with service providers needed to run the service: hosting, the AI provider chosen by the business, and Meta.</li>
  </ul> },
  { h: 'Retention and security', body: () => <p>We keep data while the Page stays connected, or until you ask us to delete it. Page tokens and API keys are encrypted at rest, and all connections use HTTPS.</p> },
  { h: 'Your rights and data deletion', body: c => <p>You can ask to access, correct or delete your data. Contact {c.email}, or see the <a className="text-sky-600 underline" href="/data-deletion">data deletion</a> page.</p> },
  { h: 'Contact', body: c => <p>{c.operator} · {c.email}</p> },
];

export default function PrivacyPage() {
  return <LegalPage title="นโยบายความเป็นส่วนตัว · Privacy Policy" updated="ปรับปรุงล่าสุด 28 กันยายน 2026 · Last updated 28 September 2026" th={th} en={en} />;
}
