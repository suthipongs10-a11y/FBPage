'use client';
import { LegalPage, type LegalSection } from '@/components/legal-page';

const th: LegalSection[] = [
  { h: 'ขอลบข้อมูลของคุณ', body: c => <>
    <p>ถ้าคุณเคยคอมเมนต์หรือส่งข้อความถึงเพจที่ใช้ระบบของ {c.operator} หรือเป็นผู้ใช้ระบบ คุณขอให้ลบข้อมูลได้ดังนี้</p>
    <ol className="list-decimal space-y-1 pl-5">
      <li>ส่งอีเมลถึง {c.email} หัวข้อ &quot;ขอลบข้อมูล&quot;</li>
      <li>ระบุชื่อบัญชี Facebook ของคุณ ชื่อเพจที่คุณคอมเมนต์หรือทักแชท และช่วงเวลาโดยประมาณ</li>
      <li>เราจะยืนยันตัวตนตามความจำเป็น และลบคอมเมนต์ ข้อความแชท และข้อมูลที่เกี่ยวข้องออกจากระบบภายใน 30 วัน แล้วแจ้งกลับทางอีเมล</li>
    </ol>
  </> },
  { h: 'ถอนสิทธิ์แอปจาก Facebook', body: () => <p>ผู้ดูแลเพจที่เคยเชื่อมเพจเข้าระบบ ถอนสิทธิ์ได้ทุกเมื่อที่ Facebook → การตั้งค่าและความเป็นส่วนตัว → การตั้งค่า → การเชื่อมต่อธุรกิจ (หรือ แอพและเว็บไซต์) → เลือกแอปนี้ → ลบออก เมื่อถอนสิทธิ์ ระบบจะใช้ token ของเพจนั้นต่อไม่ได้ และคุณแจ้งให้เราลบข้อมูลที่เหลือได้ตามขั้นตอนด้านบน</p> },
  { h: 'สิ่งที่ถูกลบ', body: () => <p>ข้อมูลบัญชี, token ของเพจ, คอมเมนต์และข้อความแชทที่ระบบเก็บไว้ และลีดที่สร้างจากข้อมูลนั้น ส่วนบันทึกการตรวจสอบ (audit log) ที่กฎหมายหรือความปลอดภัยต้องใช้จะเก็บเฉพาะข้อมูลที่จำเป็น โดยไม่มีข้อความของคุณ</p> },
];

const en: LegalSection[] = [
  { h: 'Request deletion of your data', body: c => <>
    <p>If you commented on, or sent a message to, a Page managed with {c.operator}&apos;s tool, or if you are a user of the tool, you can ask us to delete your data:</p>
    <ol className="list-decimal space-y-1 pl-5">
      <li>Email {c.email} with the subject &quot;Data deletion request&quot;.</li>
      <li>Include your Facebook account name, the Page you commented on or messaged, and the approximate date.</li>
      <li>We will verify your identity if needed, then delete your comments, chat messages and related data within 30 days and confirm by email.</li>
    </ol>
  </> },
  { h: 'Remove the app from Facebook', body: () => <p>Page admins who connected a Page can revoke access at any time: Facebook → Settings &amp; privacy → Settings → Business integrations (or Apps and websites) → select this app → Remove. After you remove it, the tool can no longer use that Page&apos;s token. You can then ask us to delete any remaining data as described above.</p> },
  { h: 'What is deleted', body: () => <p>Account data, Page tokens, stored comments and chat messages, and any leads created from them. Audit logs required for legal or security reasons keep only the minimum necessary, without your message content.</p> },
];

export default function DataDeletionPage() {
  return <LegalPage title="การลบข้อมูลผู้ใช้ · User Data Deletion" updated="ปรับปรุงล่าสุด 28 กันยายน 2026 · Last updated 28 September 2026" th={th} en={en} />;
}
