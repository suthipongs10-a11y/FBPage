/**
 * เรนเดอร์รายงานรายเดือนเป็น HTML (M7)
 *
 * ทำเป็น HTML แล้วค่อยแปลงเป็น PDF ด้วย headless Chromium ตอน deploy
 * เหตุผลที่ไม่ใช้ไลบรารี PDF ตรงๆ: ฟอนต์ไทยใน PDF library ส่วนใหญ่จัดการยาก
 * สระลอยเพี้ยน วรรณยุกต์ซ้อนผิดตำแหน่ง ส่วนเบราว์เซอร์เรนเดอร์ไทยได้ถูกต้องอยู่แล้ว
 *
 * ทุกค่าที่มาจากข้อมูลต้อง escape ก่อนใส่ลง HTML — ชื่อเพจและข้อความโพสต์
 * มาจากผู้ใช้ ถ้าไม่ escape จะกลายเป็นช่องโหว่ในไฟล์ที่เราส่งให้ลูกค้า
 */
import type {
  MetricComparison,
  MonthlyReport,
  TopPost,
} from "./report.js";

/** escape ทุกอักขระที่มีความหมายใน HTML */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface BrandConfig {
  /** ชื่อเอเจนซี่ที่จะขึ้นหัวรายงาน */
  agencyName: string;
  /** สีหลักของแบรนด์ */
  primaryColor?: string;
  logoUrl?: string;
  footerNote?: string;
}

const DEFAULT_BRAND: Required<Omit<BrandConfig, "logoUrl">> = {
  agencyName: "PAGE OS",
  primaryColor: "#1877F2",
  footerNote: "รายงานนี้สร้างอัตโนมัติจากข้อมูลจริงของเพจ",
};

function arrow(m: MetricComparison): string {
  if (m.direction === "flat") return "→";
  return m.direction === "up" ? "▲" : "▼";
}

function toneClass(m: MetricComparison): string {
  if (m.changePct === null || m.direction === "flat") return "flat";
  return m.improved ? "good" : "bad";
}

function metricCard(m: MetricComparison): string {
  return `
    <div class="card">
      <div class="card-label">${escapeHtml(m.labelTh)}</div>
      <div class="card-value">${escapeHtml(m.currentText)}</div>
      <div class="card-change ${toneClass(m)}">
        ${arrow(m)} ${escapeHtml(m.changeText)}
        <span class="card-prev">เดือนก่อน ${escapeHtml(m.previousText)}</span>
      </div>
    </div>`;
}

/** กราฟแท่งเทียบเดือนก่อนแบบ inline SVG — ไม่ต้องพึ่ง JS หรือไลบรารีภายนอก */
function comparisonChart(metrics: MetricComparison[], color: string): string {
  const items = metrics.filter((m) => m.current > 0 || m.previous > 0);
  if (items.length === 0) {
    return '<p class="empty">ยังไม่มีข้อมูลพอจะวาดกราฟเทียบ</p>';
  }

  const rowH = 46;
  const barH = 14;
  const labelW = 190;
  const chartW = 420;
  const height = items.length * rowH + 24;

  const rows = items
    .map((m, i) => {
      const max = Math.max(m.current, m.previous, 1);
      const curW = Math.round((m.current / max) * chartW);
      const prevW = Math.round((m.previous / max) * chartW);
      const y = i * rowH + 12;
      return `
      <text x="0" y="${y + 12}" class="chart-label">${escapeHtml(m.labelTh)}</text>
      <rect x="${labelW}" y="${y}" width="${prevW}" height="${barH}" rx="3" class="bar-prev"></rect>
      <rect x="${labelW}" y="${y + barH + 4}" width="${curW}" height="${barH}" rx="3" fill="${escapeHtml(color)}"></rect>
      <text x="${labelW + Math.max(curW, prevW) + 8}" y="${y + barH + 15}" class="chart-value">${escapeHtml(m.currentText)}</text>`;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${labelW + chartW + 90} ${height}" class="chart" role="img"
         aria-label="กราฟเทียบเดือนนี้กับเดือนก่อน">
      ${rows}
    </svg>
    <div class="legend">
      <span><i class="swatch" style="background:${escapeHtml(color)}"></i>เดือนนี้</span>
      <span><i class="swatch swatch-prev"></i>เดือนก่อน</span>
    </div>`;
}

function topPostRow(p: TopPost, rank: number): string {
  const date = new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
  }).format(new Date(p.publishedAtMs));
  const link = p.permalink
    ? `<a href="${escapeHtml(p.permalink)}">ดูโพสต์</a>`
    : "";
  return `
    <tr>
      <td class="rank">${rank}</td>
      <td>
        <div class="post-excerpt">${escapeHtml(p.excerpt)}</div>
        <div class="post-meta">${escapeHtml(date)} ${link}</div>
      </td>
      <td class="num">${p.engagement.toLocaleString("th-TH")}</td>
      <td class="num">${p.mediaViews === undefined ? "-" : p.mediaViews.toLocaleString("th-TH")}</td>
    </tr>`;
}

export function renderReportHtml(
  report: MonthlyReport,
  brand: BrandConfig = DEFAULT_BRAND,
): string {
  const b = { ...DEFAULT_BRAND, ...brand };
  const color = b.primaryColor;

  const warnings =
    report.warnings.length === 0
      ? ""
      : `<div class="warn">
           <strong>หมายเหตุ</strong>
           <ul>${report.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
         </div>`;

  const logo = b.logoUrl
    ? `<img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(b.agencyName)}" class="logo">`
    : "";

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>รายงานเพจ ${escapeHtml(report.pageName)} — ${escapeHtml(report.monthLabelTh)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Sarabun", "Noto Sans Thai", "Leelawadee UI", sans-serif;
    color: #1c1e21; margin: 0; line-height: 1.6; font-size: 14px;
  }
  h1, h2 { line-height: 1.3; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 {
    font-size: 17px; margin: 0 0 12px;
    padding-bottom: 6px; border-bottom: 2px solid ${escapeHtml(color)};
  }
  .page { page-break-after: always; padding-bottom: 8px; }
  .page:last-child { page-break-after: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           margin-bottom: 20px; }
  .logo { max-height: 40px; }
  .subtitle { color: #65676b; font-size: 13px; }
  .summary li { margin-bottom: 6px; }
  .cards { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; }
  .card {
    flex: 1 1 150px; border: 1px solid #dadde1; border-radius: 8px;
    padding: 12px 14px;
  }
  .card-label { font-size: 12px; color: #65676b; }
  .card-value { font-size: 22px; font-weight: 700; margin: 2px 0; }
  .card-change { font-size: 12px; }
  .card-change.good { color: #1a7f37; }
  .card-change.bad { color: #c9252d; }
  .card-change.flat { color: #65676b; }
  .card-prev { display: block; color: #8a8d91; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #e4e6eb;
           vertical-align: top; }
  th { font-size: 12px; color: #65676b; font-weight: 600; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  td.rank { color: ${escapeHtml(color)}; font-weight: 700; width: 28px; }
  .post-excerpt { font-size: 13px; }
  .post-meta { font-size: 11px; color: #8a8d91; margin-top: 2px; }
  .post-meta a { color: ${escapeHtml(color)}; }
  .chart { width: 100%; height: auto; margin-top: 8px; }
  .chart-label { font-size: 11px; fill: #1c1e21; }
  .chart-value { font-size: 11px; fill: #65676b; }
  .bar-prev { fill: #ccd0d5; }
  .legend { font-size: 11px; color: #65676b; display: flex; gap: 14px;
            margin-top: 6px; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px;
            margin-right: 4px; }
  .swatch-prev { background: #ccd0d5; }
  .warn { background: #fff8e1; border-left: 3px solid #f0b400; padding: 8px 12px;
          font-size: 12px; margin: 14px 0; }
  .warn ul { margin: 4px 0 0; padding-left: 18px; }
  .empty { color: #8a8d91; font-style: italic; }
  .plan li { margin-bottom: 6px; }
  footer { margin-top: 24px; font-size: 11px; color: #8a8d91;
           border-top: 1px solid #e4e6eb; padding-top: 8px; }
</style>
</head>
<body>

<section class="page">
  <header>
    <div>
      <h1>รายงานผลการดูแลเพจ</h1>
      <div class="subtitle">
        ${escapeHtml(report.pageName)} · ${escapeHtml(report.monthLabelTh)}
        (${escapeHtml(report.periodFrom)} ถึง ${escapeHtml(report.periodTo)})
      </div>
    </div>
    ${logo}
  </header>

  <h2>สรุปผู้บริหาร</h2>
  <ul class="summary">
    ${report.executiveSummary.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}
  </ul>

  <div class="cards">
    ${report.highlights.map(metricCard).join("")}
  </div>

  ${warnings}
</section>

<section class="page">
  <h2>เทียบกับเดือนก่อน</h2>
  ${comparisonChart(report.highlights, color)}

  <table>
    <thead>
      <tr>
        <th>ตัวชี้วัด</th>
        <th class="num">เดือนนี้</th>
        <th class="num">เดือนก่อน</th>
        <th class="num">เปลี่ยนแปลง</th>
      </tr>
    </thead>
    <tbody>
      ${report.allMetrics
        .map(
          (m) => `<tr>
            <td>${escapeHtml(m.labelTh)}</td>
            <td class="num">${escapeHtml(m.currentText)}</td>
            <td class="num">${escapeHtml(m.previousText)}</td>
            <td class="num ${toneClass(m)}">${arrow(m)} ${escapeHtml(m.changeText)}</td>
          </tr>`,
        )
        .join("")}
    </tbody>
  </table>
</section>

<section class="page">
  <h2>5 โพสต์ที่ทำผลงานดีที่สุด</h2>
  ${
    report.topPosts.length === 0
      ? '<p class="empty">เดือนนี้ยังไม่มีโพสต์ที่มีข้อมูลผลงาน</p>'
      : `<table>
          <thead>
            <tr>
              <th></th><th>เนื้อหา</th>
              <th class="num">การมีส่วนร่วม</th><th class="num">ยอดดู</th>
            </tr>
          </thead>
          <tbody>
            ${report.topPosts.map((p, i) => topPostRow(p, i + 1)).join("")}
          </tbody>
        </table>`
  }

  <h2 style="margin-top:28px">สรุปงานตอบข้อความ</h2>
  <p>${escapeHtml(report.inbox.th)}</p>
  <table>
    <tbody>
      <tr><td>บทสนทนาทั้งหมด</td>
          <td class="num">${report.inbox.conversations.toLocaleString("th-TH")}</td></tr>
      <tr><td>ลูกค้าใหม่</td>
          <td class="num">${report.inbox.newContacts.toLocaleString("th-TH")}</td></tr>
      <tr><td>ตอบเกินเวลาที่สัญญาไว้</td>
          <td class="num">${report.inbox.slaBreaches.toLocaleString("th-TH")} ครั้ง</td></tr>
      <tr><td>บอทส่งต่อให้คน</td>
          <td class="num">${report.inbox.botEscalations.toLocaleString("th-TH")} ครั้ง</td></tr>
    </tbody>
  </table>
</section>

<section class="page">
  <h2>สิ่งที่จะทำเดือนหน้า</h2>
  <ul class="plan">
    ${report.nextMonthPlan.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}
  </ul>

  <footer>
    ${escapeHtml(b.agencyName)} · ${escapeHtml(b.footerNote)}<br>
    สร้างเมื่อ ${escapeHtml(
      new Intl.DateTimeFormat("th-TH", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "Asia/Bangkok",
      }).format(new Date(report.generatedAtMs)),
    )}
  </footer>
</section>

</body>
</html>`;
}
