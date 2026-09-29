'use client';
import { LegalPage, type LegalSection } from '@/components/legal-page';

const link = (href: string, text: string) => <a className="text-sky-600 underline" href={href} target="_blank" rel="noreferrer">{text}</a>;

const th: LegalSection[] = [
  { h: 'เกี่ยวกับบริการนี้', body: c => <p>{c.operator} ให้บริการระบบช่วยดูแลช่องทางโซเชียล (เพจ Facebook, ช่อง YouTube และบัญชี TikTok) ที่ {c.host} สำหรับธุรกิจที่มอบหมายให้เราดูแล นโยบายนี้อธิบายว่าเราเก็บและใช้ข้อมูลอะไร และใช้ร่วมกับ <a className="text-sky-600 underline" href="/terms">ข้อกำหนดการใช้งาน</a></p> },
  { h: 'ข้อมูลที่เราเก็บ', body: () => <ul className="list-disc space-y-1 pl-5">
    <li><b>บัญชีผู้ใช้ระบบ:</b> ชื่อ อีเมล และรหัสผ่าน (เก็บแบบเข้ารหัสทางเดียว)</li>
    <li><b>ข้อมูลเพจ Facebook ที่ผู้ดูแลเพจเชื่อมเข้าระบบ:</b> ชื่อและรหัสเพจ, access token ของเพจ (เข้ารหัสก่อนบันทึก), โพสต์ และตัวเลขสถิติของเพจ</li>
    <li><b>คอมเมนต์บนโพสต์ของเพจ:</b> ชื่อผู้คอมเมนต์ รหัสผู้ใช้ที่ Facebook ให้กับแอป และข้อความคอมเมนต์ เพื่อจัดประเภทคำถาม ร่างคำตอบ และติดตามลูกค้าที่สนใจ</li>
    <li><b>ข้อความ Messenger ที่ส่งถึงเพจ:</b> รหัสผู้ส่งเฉพาะเพจ (PSID) และข้อความ เพื่อร่างหรือส่งคำตอบในนามของเพจ</li>
    <li><b>ช่อง YouTube ที่เจ้าของช่องเชื่อมผ่าน Google:</b> อีเมลบัญชี Google, ข้อมูลช่องและรายการคลิป, สถิติจาก YouTube Analytics (วิว เวลาดู ผู้ติดตาม), คอมเมนต์และชื่อผู้คอมเมนต์ และ token ของ Google (เข้ารหัสก่อนบันทึก)</li>
    <li><b>บัญชี TikTok ที่เจ้าของบัญชีเชื่อมผ่าน TikTok:</b> ข้อมูลโปรไฟล์พื้นฐาน (open ID, ชื่อที่แสดง, รูปโปรไฟล์), ตัวเลขผู้ติดตาม, รายการคลิปพร้อมยอดวิว ไลค์ คอมเมนต์ แชร์ และ token ของ TikTok (เข้ารหัสก่อนบันทึก)</li>
    <li><b>ไฟล์ที่อัปโหลดเพื่อเผยแพร่:</b> รูปและคลิปที่คุณอัปโหลด คลิปที่ส่งขึ้น YouTube แล้วจะถูกลบจากเซิร์ฟเวอร์ของเรา</li>
  </ul> },
  { h: 'เราใช้ข้อมูลอย่างไร', body: () => <ul className="list-disc space-y-1 pl-5">
    <li>เผยแพร่โพสต์ อัปโหลดคลิป ตอบคอมเมนต์ และตอบข้อความ ในนามเพจ ช่อง หรือบัญชีที่เจ้าของอนุญาตเท่านั้น และทุกครั้งต้องผ่านการยืนยันของผู้ใช้ตามที่ตั้งค่า สำหรับ TikTok คลิปถูกส่งเข้ากล่องร่างในแอปให้เจ้าของกดโพสต์เอง</li>
    <li>แสดงสถิติ วิเคราะห์ผล และทำรายงานให้เจ้าของช่องทาง</li>
    <li>ส่งข้อความที่เกี่ยวข้อง (เช่น คอมเมนต์ ข้อความแชท ชื่อคลิป และข้อมูลสินค้า/บริการ) ไปยังผู้ให้บริการ AI ที่ธุรกิจเลือก เพื่อสร้างร่างคำตอบหรือไอเดียคอนเทนต์</li>
    <li>เราไม่ขายข้อมูล ไม่ใช้ข้อมูลเพื่อยิงโฆษณา และไม่ส่งต่อให้บุคคลอื่น นอกจากผู้ให้บริการที่จำเป็นต่อการทำงาน (ผู้ให้บริการเซิร์ฟเวอร์, ผู้ให้บริการ AI ที่ธุรกิจเลือก, Meta, Google และ TikTok)</li>
  </ul> },
  { h: 'YouTube และ Google', body: () => <p>ระบบใช้ YouTube API Services การใช้งานส่วนนี้อยู่ภายใต้ {link('https://www.youtube.com/t/terms', 'ข้อกำหนดการใช้งาน YouTube')} และ {link('https://policies.google.com/privacy', 'นโยบายความเป็นส่วนตัวของ Google')} การใช้และส่งต่อข้อมูลที่ได้จาก Google API เป็นไปตาม {link('https://developers.google.com/terms/api-services-user-data-policy', 'Google API Services User Data Policy')} รวมถึงข้อกำหนด Limited Use คุณถอนสิทธิ์ได้ที่ {link('https://myaccount.google.com/permissions', 'การตั้งค่าความปลอดภัยของบัญชี Google')}</p> },
  { h: 'TikTok', body: () => <p>ระบบใช้ TikTok for Developers API ตามขอบเขตที่เจ้าของบัญชีอนุญาต คุณถอนสิทธิ์ได้ในแอป TikTok ที่ การตั้งค่าและความเป็นส่วนตัว › ความปลอดภัย › จัดการสิทธิ์ของแอป หรือกดยกเลิกการเชื่อมในระบบ</p> },
  { h: 'การเก็บรักษาและความปลอดภัย', body: () => <p>ข้อมูลเก็บไว้ตราบเท่าที่ช่องทางยังเชื่อมกับระบบ หรือจนกว่าจะมีคำขอให้ลบ เมื่อยกเลิกการเชื่อม เราหยุดดึงข้อมูลใหม่ทันที token และคีย์ต่างๆ ถูกเข้ารหัสก่อนบันทึก และการเชื่อมต่อทั้งหมดใช้ HTTPS</p> },
  { h: 'สิทธิ์ของคุณและการลบข้อมูล', body: c => <p>คุณขอดู แก้ไข หรือลบข้อมูลของคุณได้ ติดต่อ {c.email} หรือดูวิธีที่หน้า <a className="text-sky-600 underline" href="/data-deletion">การลบข้อมูล</a></p> },
  { h: 'ติดต่อ', body: c => <p>{c.operator} · {c.email}</p> },
];

const en: LegalSection[] = [
  { h: 'About this service', body: c => <p>{c.operator} operates a social media management tool at {c.host} for Facebook Pages, YouTube channels and TikTok accounts of businesses that ask us to manage them. This policy explains what data we collect and how we use it. Read it together with our <a className="text-sky-600 underline" href="/terms">Terms of Service</a>.</p> },
  { h: 'Data we collect', body: () => <ul className="list-disc space-y-1 pl-5">
    <li><b>User accounts of this tool:</b> name, email and password (stored as a one-way hash).</li>
    <li><b>Facebook Pages connected by their admins:</b> Page name and ID, the Page access token (encrypted at rest), posts and Page metrics.</li>
    <li><b>Comments on the Page&apos;s posts:</b> commenter name, the user ID provided by Facebook, and the comment text. We use these to classify questions, draft replies and follow up with interested customers.</li>
    <li><b>Messenger messages sent to the Page:</b> the page-scoped sender ID (PSID) and message text. We use these to draft or send replies on behalf of the Page.</li>
    <li><b>YouTube channels connected by their owners through Google:</b> the Google account email, channel and video information, YouTube Analytics metrics (views, watch time, subscribers), comments with commenter names, and Google tokens (encrypted at rest).</li>
    <li><b>TikTok accounts connected by their owners through TikTok:</b> basic profile (open ID, display name, avatar), follower counts, the video list with view, like, comment and share counts, and TikTok tokens (encrypted at rest).</li>
    <li><b>Files uploaded for publishing:</b> images and videos you upload. Videos sent to YouTube are deleted from our server after upload.</li>
  </ul> },
  { h: 'How we use data', body: () => <ul className="list-disc space-y-1 pl-5">
    <li>To publish posts, upload videos and reply to comments and messages, only for Pages, channels or accounts whose owners authorized it, and only with the user&apos;s confirmation as configured. For TikTok, videos go to the owner&apos;s drafts inbox in the TikTok app for the owner to post.</li>
    <li>To show analytics, analyze performance and produce reports for the owner.</li>
    <li>To send relevant text to the AI provider chosen by the business to draft replies or content ideas. This includes comments, chat messages, video titles and product or service information.</li>
    <li>We do not sell data or use it for ad targeting. We share it only with service providers needed to run the service: hosting, the AI provider chosen by the business, Meta, Google and TikTok.</li>
  </ul> },
  { h: 'YouTube and Google', body: () => <p>This service uses YouTube API Services. By using these features you are bound by the {link('https://www.youtube.com/t/terms', 'YouTube Terms of Service')}, and the {link('https://policies.google.com/privacy', 'Google Privacy Policy')} applies. Our use and transfer of information received from Google APIs adheres to the {link('https://developers.google.com/terms/api-services-user-data-policy', 'Google API Services User Data Policy')}, including the Limited Use requirements. You can revoke access at any time in your {link('https://myaccount.google.com/permissions', 'Google account security settings')}.</p> },
  { h: 'TikTok', body: () => <p>This service uses the TikTok for Developers APIs within the scopes the account owner authorizes. You can revoke access in the TikTok app under Settings and privacy › Security › Manage app permissions, or by disconnecting in this service.</p> },
  { h: 'Retention and security', body: () => <p>We keep data while the account stays connected, or until you ask us to delete it. When you disconnect, we stop fetching new data immediately. Tokens and API keys are encrypted at rest, and all connections use HTTPS.</p> },
  { h: 'Your rights and data deletion', body: c => <p>You can ask to access, correct or delete your data. Contact {c.email}, or see the <a className="text-sky-600 underline" href="/data-deletion">data deletion</a> page.</p> },
  { h: 'Contact', body: c => <p>{c.operator} · {c.email}</p> },
];

export default function PrivacyPage() {
  return <LegalPage title="นโยบายความเป็นส่วนตัว · Privacy Policy" updated="ปรับปรุงล่าสุด 29 กันยายน 2026 · Last updated 29 September 2026" th={th} en={en} />;
}
