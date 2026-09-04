/**
 * i18n ขั้นต่ำ (AGENTS.md §86) — ข้อความที่ผู้ใช้เห็นต้องผ่าน t() เสมอ ห้าม hardcode ใน component
 * ภาษา UI แยกจากภาษาคอนเทนต์ของแบรนด์
 */
export const LOCALES = ['th', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

const dict = {
  th: {
    'app.name': 'Facebook AI Page Manager',
    'nav.overview': 'ภาพรวม', 'nav.clients': 'ลูกค้า', 'nav.pages': 'เพจ', 'nav.ai': 'AI Command',
    'nav.content': 'คอนเทนต์', 'nav.calendar': 'ปฏิทิน', 'nav.analytics': 'วิเคราะห์', 'nav.comments': 'คอมเมนต์',
    'nav.leads': 'ลีด', 'nav.reports': 'รายงาน', 'nav.automation': 'อัตโนมัติ', 'nav.aiModels': 'โมเดล AI', 'nav.settings': 'ตั้งค่า',
    'overview.title': 'ภาพรวม',
    'overview.phase1': 'Phase 1 — ฐานระบบ: monorepo, ฐานข้อมูล, คิว, health check',
    'health.api': 'API', 'health.postgres': 'PostgreSQL', 'health.redis': 'Redis',
    'health.up': 'ทำงานปกติ', 'health.down': 'ล้มเหลว', 'health.unreachable': 'ติดต่อ API ไม่ได้',
    'needsAttention.title': 'ต้องดูแล',
    'needsAttention.none': 'ยังไม่มีรายการ — เชื่อมต่อเพจใน Phase ถัดไป',
  },
  en: {
    'app.name': 'Facebook AI Page Manager',
    'nav.overview': 'Overview', 'nav.clients': 'Clients', 'nav.pages': 'Pages', 'nav.ai': 'AI Command',
    'nav.content': 'Content', 'nav.calendar': 'Calendar', 'nav.analytics': 'Analytics', 'nav.comments': 'Comments',
    'nav.leads': 'Leads', 'nav.reports': 'Reports', 'nav.automation': 'Automation', 'nav.aiModels': 'AI Models', 'nav.settings': 'Settings',
    'overview.title': 'Overview',
    'overview.phase1': 'Phase 1 — base stack: monorepo, database, queue, health check',
    'health.api': 'API', 'health.postgres': 'PostgreSQL', 'health.redis': 'Redis',
    'health.up': 'Up', 'health.down': 'Down', 'health.unreachable': 'API unreachable',
    'needsAttention.title': 'Needs attention',
    'needsAttention.none': 'Nothing yet — connect a Page in the next phase',
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type MessageKey = keyof (typeof dict)['th'];
export const t = (key: MessageKey, locale: Locale = 'th'): string => dict[locale][key] ?? dict.th[key] ?? key;
