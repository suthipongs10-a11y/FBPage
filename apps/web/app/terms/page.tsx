'use client';
import { LegalPage, type LegalSection } from '@/components/legal-page';

const link = (href: string, text: string) => <a className="text-sky-600 underline" href={href} target="_blank" rel="noreferrer">{text}</a>;

const th: LegalSection[] = [
  { h: '1. การยอมรับข้อตกลง', body: c => <p>ข้อตกลงนี้ใช้กับการใช้งานระบบที่ {c.host} ซึ่งให้บริการโดย {c.operator} เมื่อคุณสมัคร ล็อกอิน หรือเชื่อมบัญชีโซเชียลเข้าระบบ ถือว่าคุณยอมรับข้อตกลงนี้และ <a className="text-sky-600 underline" href="/privacy">นโยบายความเป็นส่วนตัว</a></p> },
  { h: '2. บริการของเรา', body: () => <p>ระบบช่วยธุรกิจดูแลช่องทางโซเชียลของตัวเอง ได้แก่ เพจ Facebook, ช่อง YouTube และบัญชี TikTok เช่น ดูสถิติ ร่างคอนเทนต์ด้วย AI ตั้งเวลาเผยแพร่ ร่างและส่งคำตอบคอมเมนต์ และทำรายงาน ทุกการเผยแพร่หรือส่งข้อความต้องผ่านการยืนยันของผู้ใช้ตามที่ตั้งค่าไว้ สำหรับ TikTok คลิปจะถูกส่งเข้ากล่องร่างในแอป TikTok ให้เจ้าของบัญชีตรวจและกดโพสต์เอง</p> },
  { h: '3. บัญชีและการเชื่อมแพลตฟอร์ม', body: () => <ul className="list-disc space-y-1 pl-5">
    <li>คุณต้องเป็นเจ้าของ หรือได้รับอนุญาตจากเจ้าของ ให้จัดการเพจ ช่อง หรือบัญชีที่เชื่อมเข้าระบบ</li>
    <li>การเชื่อมใช้ระบบล็อกอินของแต่ละแพลตฟอร์ม (OAuth) เราไม่เก็บรหัสผ่านโซเชียลของคุณ</li>
    <li>คุณยกเลิกการเชื่อมได้ตลอดเวลาในระบบ หรือในหน้าตั้งค่าสิทธิ์แอปของ Facebook, Google และ TikTok</li>
    <li>คุณรับผิดชอบการรักษารหัสผ่านบัญชีระบบของคุณ และการกระทำที่เกิดจากบัญชีนั้น</li>
  </ul> },
  { h: '4. เนื้อหาและความรับผิดชอบ', body: () => <ul className="list-disc space-y-1 pl-5">
    <li>เนื้อหาที่คุณสร้าง อัปโหลด หรือเผยแพร่ผ่านระบบเป็นของคุณ และคุณรับผิดชอบให้ถูกต้องตามกฎหมายและนโยบายของแต่ละแพลตฟอร์ม</li>
    <li>ร่างที่ AI สร้างอาจไม่ถูกต้อง คุณต้องตรวจก่อนเผยแพร่ทุกครั้ง โดยเฉพาะตัวเลข ราคา ข้อมูลสุขภาพ และข้อกล่าวอ้าง</li>
    <li>ห้ามเผยแพร่เนื้อหาหรือรูปภาพที่คัดลอกจากผู้อื่นโดยไม่ได้รับอนุญาต</li>
  </ul> },
  { h: '5. การใช้งานที่ไม่อนุญาต', body: () => <ul className="list-disc space-y-1 pl-5">
    <li>สแปม ส่งข้อความจำนวนมากที่ผู้รับไม่ต้องการ หรือสร้างการมีส่วนร่วมปลอม</li>
    <li>แอบอ้างเป็นบุคคลหรือองค์กรอื่น หรือเผยแพร่เนื้อหาผิดกฎหมาย หลอกลวง หรือสร้างความเกลียดชัง</li>
    <li>เก็บข้อมูลของผู้ใช้อื่นเกินกว่าที่จำเป็นต่อการดูแลช่องทางของตัวเอง หรือนำข้อมูลไปขาย</li>
    <li>พยายามหลบเลี่ยงข้อจำกัด โควต้า หรือระบบความปลอดภัยของเราหรือของแพลตฟอร์ม</li>
  </ul> },
  { h: '6. บริการของบุคคลที่สาม', body: () => <p>ระบบทำงานผ่าน API ของ Meta, YouTube (Google) และ TikTok รวมถึงผู้ให้บริการ AI ที่ธุรกิจเลือก การใช้งานส่วนนั้นอยู่ภายใต้ข้อตกลงของผู้ให้บริการด้วย เช่น {link('https://www.youtube.com/t/terms', 'ข้อกำหนดการใช้งาน YouTube')}, {link('https://policies.google.com/privacy', 'นโยบายความเป็นส่วนตัวของ Google')}, {link('https://www.tiktok.com/legal/terms-of-service', 'ข้อกำหนดของ TikTok')} และ {link('https://www.facebook.com/terms', 'ข้อกำหนดของ Meta')} เราไม่ได้เป็นบริษัทในเครือหรือได้รับการรับรองจากผู้ให้บริการเหล่านี้</p> },
  { h: '7. ความพร้อมใช้งานและข้อจำกัดความรับผิด', body: () => <p>เราให้บริการตามสภาพที่เป็นอยู่ บางฟีเจอร์อาจหยุดชั่วคราวเมื่อแพลตฟอร์มเปลี่ยน API จำกัดโควต้า หรือปิดปรับปรุง เราพยายามป้องกันการโพสต์ซ้ำหรือผิดพลาด แต่ไม่รับผิดชอบต่อความเสียหายทางอ้อม เช่น รายได้หรือยอดเข้าถึงที่ลดลง เท่าที่กฎหมายอนุญาต</p> },
  { h: '8. การยกเลิก', body: () => <p>คุณเลิกใช้และขอลบข้อมูลได้ตลอดเวลาตาม <a className="text-sky-600 underline" href="/data-deletion">วิธีขอลบข้อมูล</a> เราอาจระงับบัญชีที่ละเมิดข้อตกลงนี้หรือนโยบายของแพลตฟอร์ม</p> },
  { h: '9. การเปลี่ยนแปลงข้อตกลง', body: () => <p>เราอาจปรับข้อตกลงนี้เป็นครั้งคราว และจะแก้วันที่ปรับปรุงไว้ด้านบน การใช้งานต่อหลังจากนั้นถือว่ายอมรับข้อตกลงฉบับใหม่</p> },
  { h: '10. กฎหมายที่ใช้บังคับ', body: () => <p>ข้อตกลงนี้อยู่ภายใต้กฎหมายไทย</p> },
  { h: '11. ติดต่อ', body: c => <p>{c.operator} · {c.email}</p> },
];

const en: LegalSection[] = [
  { h: '1. Acceptance', body: c => <p>These terms govern your use of the service at {c.host}, operated by {c.operator}. By signing up, logging in or connecting a social account, you agree to these terms and to our <a className="text-sky-600 underline" href="/privacy">Privacy Policy</a>.</p> },
  { h: '2. The service', body: () => <p>The service helps businesses manage their own social channels: Facebook Pages, YouTube channels and TikTok accounts. It shows analytics, drafts content with AI, schedules publishing, drafts and sends comment replies, and produces reports. Every publish or message requires the user&apos;s confirmation as configured. For TikTok, videos are sent to the account owner&apos;s drafts inbox in the TikTok app, and the owner reviews and posts them.</p> },
  { h: '3. Accounts and connected platforms', body: () => <ul className="list-disc space-y-1 pl-5">
    <li>You must own, or be authorized by the owner to manage, every Page, channel or account you connect.</li>
    <li>Connections use each platform&apos;s own login (OAuth). We never store your social media passwords.</li>
    <li>You can disconnect at any time in the service or in the app permission settings of Facebook, Google and TikTok.</li>
    <li>You are responsible for keeping your password for this service safe and for activity under your account.</li>
  </ul> },
  { h: '4. Your content', body: () => <ul className="list-disc space-y-1 pl-5">
    <li>Content you create, upload or publish through the service remains yours. You are responsible for making sure it complies with the law and with each platform&apos;s policies.</li>
    <li>AI-generated drafts can be wrong. Review every draft before publishing, especially numbers, prices, health information and claims.</li>
    <li>Do not publish content or images copied from others without permission.</li>
  </ul> },
  { h: '5. Prohibited use', body: () => <ul className="list-disc space-y-1 pl-5">
    <li>Spam, unsolicited bulk messaging or fake engagement.</li>
    <li>Impersonating people or organizations, or publishing illegal, deceptive or hateful content.</li>
    <li>Collecting other users&apos; data beyond what is needed to manage your own channels, or selling such data.</li>
    <li>Circumventing our or a platform&apos;s limits, quotas or security measures.</li>
  </ul> },
  { h: '6. Third-party services', body: () => <p>The service works through the APIs of Meta, YouTube (Google) and TikTok, and the AI providers each business chooses. Their own terms also apply, including the {link('https://www.youtube.com/t/terms', 'YouTube Terms of Service')}, the {link('https://policies.google.com/privacy', 'Google Privacy Policy')}, the {link('https://www.tiktok.com/legal/terms-of-service', 'TikTok Terms of Service')} and the {link('https://www.facebook.com/terms', 'Meta Terms')}. We are not affiliated with or endorsed by these providers.</p> },
  { h: '7. Availability and liability', body: () => <p>The service is provided &quot;as is&quot;. Features may pause when a platform changes its API, applies quota limits or during maintenance. We take steps to prevent duplicate or wrong posts. To the extent permitted by law, we are not liable for indirect losses such as lost revenue or reach.</p> },
  { h: '8. Termination', body: () => <p>You may stop using the service and request deletion at any time. See <a className="text-sky-600 underline" href="/data-deletion">data deletion</a>. We may suspend accounts that violate these terms or platform policies.</p> },
  { h: '9. Changes', body: () => <p>We may update these terms and will change the date at the top. Continued use after an update means you accept the new terms.</p> },
  { h: '10. Governing law', body: () => <p>These terms are governed by the laws of Thailand.</p> },
  { h: '11. Contact', body: c => <p>{c.operator} · {c.email}</p> },
];

export default function TermsPage() {
  return <LegalPage title="ข้อกำหนดการใช้งาน · Terms of Service" updated="ปรับปรุงล่าสุด 29 กันยายน 2026 · Last updated 29 September 2026" th={th} en={en} />;
}
