/**
 * ใส่ข้อมูลตัวอย่างเข้าฐานข้อมูล เพื่อดูหน้าจอตอนมีของจริง
 *
 * ─── ทำไมถึงต้องมี ───
 *
 * หน้าจอที่ว่างเปล่าดูดีเสมอ ปัญหาของงานออกแบบโผล่ตอนมีข้อมูลจริงเท่านั้น:
 * ชื่อยาวเกินกรอบ, ตัวเลขหลักหมื่นดันคอลัมน์, การ์ดสูงไม่เท่ากันจนเหลือช่องว่าง
 * — ดูหน้าเปล่าแล้วบอกว่า "สวยแล้ว" คือการหลอกตัวเอง
 *
 * ทุกแถวที่สร้างมี prefix `[demo]` ในชื่อ workspace เพื่อให้ล้างออกได้หมด
 * โดยไม่แตะข้อมูลจริงของใคร
 *
 *   pnpm demo-data        # ใส่ข้อมูล
 *   pnpm demo-data clear  # ล้างออก
 *
 * ⚠️ สคริปต์นี้มีไว้ดูหน้าจอตอนพัฒนาเท่านั้น ห้ามรันบนเครื่องที่มีข้อมูลจริง
 *    (มันไม่ลบของคนอื่น แต่เพจปลอมจะไปปนในรายการจนสับสน)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TAG = "[demo]";
const now = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;

async function clear() {
  const { count } = await prisma.workspace.deleteMany({
    where: { name: { startsWith: TAG } },
  });
  console.log(`ล้างข้อมูลตัวอย่างแล้ว (${count} workspace)`);
}

const CLIENTS = [
  {
    name: "ครัวคุณยาย",
    sla: 60,
    pages: [
      { fbPageId: "100064000001", name: "ครัวคุณยาย ข้าวแกงใต้", followers: 18_420 },
      { fbPageId: "100064000002", name: "ครัวคุณยาย สาขาลาดพร้าว", followers: 4_110 },
    ],
  },
  {
    name: "บ้านสวนออร์แกนิก",
    sla: 240,
    pages: [{ fbPageId: "100064000003", name: "บ้านสวนออร์แกนิก", followers: 32_900 }],
  },
  {
    name: "ร้านกาแฟริมคลอง",
    sla: 30,
    pages: [{ fbPageId: "100064000004", name: "ร้านกาแฟริมคลอง ประชาอุทิศ", followers: 7_640 }],
  },
];

/** ข้อความจริงที่คนไทยพิมพ์ — สั้นบ้างยาวบ้าง เพื่อให้เห็นปัญหาการตัดบรรทัด */
const ASKS = [
  "พี่คะ ข้าวแกงกล่องละเท่าไหร่คะ มีส่งแถวรามคำแหงไหม",
  "สั่ง 30 กล่องพรุ่งนี้เช้าได้ไหมครับ ต้องมัดจำก่อนหรือเปล่า",
  "เมื่อวานสั่งไปแล้วยังไม่ได้ของเลยค่ะ เลขออเดอร์ 88214 รบกวนเช็คให้หน่อย",
  "ร้านเปิดกี่โมงคะ",
  "มีเมนูเจไหมคะ แม่ทานเจอยู่",
  "ขอที่อยู่ร้านหน่อยครับ จะไปรับเอง",
];

const COMMENTS = [
  "อร่อยมากกก สั่งทุกอาทิตย์เลย",
  "ส่งช้ามากค่ะ รอตั้งสองชั่วโมง",
  "ราคาโอเคนะ แต่เผ็ดไปนิดนึงสำหรับเด็ก",
  "พี่ครับ เปิดสาขาแถวบางนาบ้างสิครับ",
  "สั่งไปเมื่อวาน ของครบดีค่ะ ขอบคุณนะคะ",
  "แพงขึ้นจากเดิมเยอะเลยนะ",
];

async function seed() {
  await clear();
  console.log("กำลังใส่ข้อมูลตัวอย่าง…\n");

  let colorSeed = 0;

  for (const c of CLIENTS) {
    const ws = await prisma.workspace.create({
      data: { name: `${TAG} ${c.name}`, clientName: c.name, slaMinutes: c.sla },
    });

    for (const p of c.pages) {
      colorSeed += 1;
      const page = await prisma.page.create({
        data: {
          workspaceId: ws.id,
          fbPageId: p.fbPageId,
          name: p.name,
          timezone: "Asia/Bangkok",
          // เพจหนึ่งเงียบไปนาน เพื่อให้ตัวตรวจปัญหามีของจริงให้เตือน
          lastWebhookAt: new Date(now - (colorSeed === 2 ? 3 * HOUR : 4 * 60_000)),
          // เพจหนึ่งปิดบอทไว้ — ทุกข้อความจึงเข้าคิวคนหมด
          botEnabled: colorSeed !== 3,
        },
      });

      /**
       * token คนละสถานะกันในแต่ละเพจ — หน้าจอต้องแสดงได้ครบทุกแบบ
       * ไม่ใช่แค่แบบ "ปกติ" ซึ่งเป็นแบบเดียวที่ไม่ต้องออกแบบอะไรเลย
       */
      const status =
        colorSeed === 1 ? "active" : colorSeed === 2 ? "expiring_soon" : colorSeed === 3 ? "active" : "expired";
      await prisma.pageToken.create({
        data: {
          pageId: page.id,
          encryptedToken: "demo-not-a-real-token",
          tokenType: "page",
          scopes: ["pages_show_list", "pages_messaging"],
          status,
          statusReason:
            status === "expiring_soon"
              ? "เหลืออีก 5 วันจะหมดอายุ"
              : status === "expired"
                ? "หมดอายุแล้วเมื่อวาน — ต้องเชื่อมใหม่"
                : null,
          expiresAt: new Date(now + (status === "expiring_soon" ? 5 * DAY : 40 * DAY)),
        },
      });

      /**
       * `page_follows` คือคีย์ที่หน้าจอจริงอ่าน (ดู FOLLOWER_METRICS ใน
       * workspace-queries.ts) ใส่ย้อนหลัง 7 วันแบบขยับขึ้นเรื่อยๆ เพื่อให้เห็นว่า
       * กราฟ/ตัวเลขเปรียบเทียบทำงานจริง ไม่ใช่ค่าเดียวนิ่งๆ
       */
      /**
       * ⚠️ ห้ามให้เป็นเส้นตรงเป๊ะ
       *
       * รอบแรกใช้สูตรเชิงเส้น (`followers - d * k`) ผลคือเส้นแนวโน้มบนหน้าจอ
       * ออกมาเป็นเส้นทแยงตรงเป๊ะ ซึ่ง**ดูเหมือนขีดที่วาดพลาด** ไม่เหมือนกราฟ
       * — แล้วก็ตัดสินไม่ได้ว่ากราฟที่เขียนไว้ทำงานถูกหรือเปล่า
       *
       * ของจริงผู้ติดตามขึ้นๆ ลงๆ รายวัน ใช้ฟังก์ชันที่คำนวณจากลำดับวัน
       * (ไม่ใช่สุ่ม) เพื่อให้ภาพหน้าจอออกมาเหมือนเดิมทุกครั้งที่รัน
       */
      for (let d = 13; d >= 0; d--) {
        const wobble = Math.round(Math.sin(d * 1.3 + colorSeed) * 26 + Math.cos(d * 0.7) * 11);
        await prisma.insightsDaily.create({
          data: {
            pageId: page.id,
            date: new Date(new Date(now - d * DAY).toISOString().slice(0, 10)),
            metricKey: "page_follows",
            value: p.followers - d * (14 + colorSeed * 4) + wobble,
          },
        });
      }

      // ── บทสนทนาที่ยังไม่ได้ตอบ ─────────────────────────────────────
      for (let i = 0; i < 3; i++) {
        const waitedMs = (i + 1) * 35 * 60_000 + colorSeed * 12 * 60_000;
        const contact = await prisma.contact.create({
          data: {
            pageId: page.id,
            psid: `demo-psid-${page.id}-${i}`,
            name: ["สุณี ปะสาวะถา", "วิชัย ทองดี", "มะลิ แซ่ตั้ง", "ต้น ชัยพร"][i % 4],
            lastSeen: new Date(now - waitedMs),
          },
        });

        /**
         * ─── จุดที่ข้อมูลตัวอย่างชุดแรกทำผิด ───
         *
         * รอบแรกไม่ได้ตั้ง `botPausedUntil` เลย ผลคือทุกบทสนทนาถูกนับว่า
         * "บอทดูแลอยู่" แล้วหายจากคิวคนทั้งหมด — หน้าจอขึ้น "ตอบครบแล้ว 🎉"
         * ทั้งที่มี 12 คนรออยู่ ซึ่ง**หน้าจอถูก ข้อมูลตัวอย่างผิด**
         *
         * ของจริงบอทจะหยุดเองเมื่อคนพิมพ์เข้ามาแทน (ข้อ 6.3) หรือเมื่อเจอ
         * คำถามที่ตอบไม่ได้ — ที่นี่จึงหยุดบอทให้ 2 ใน 3 เหมือนของจริง
         */
        const needsHuman = i < 2;

        const convo = await prisma.conversation.create({
          data: {
            pageId: page.id,
            contactId: contact.id,
            channel: "messenger",
            status: "open",
            lastCustomerMessageAt: new Date(now - waitedMs),
            awaitingSince: new Date(now - waitedMs),
            windowExpiresAt: new Date(now - waitedMs + 24 * HOUR),
            slaDueAt: new Date(now - waitedMs + c.sla * 60_000),
            ...(needsHuman ? { botPausedUntil: new Date(now + 2 * HOUR) } : {}),
            unread: needsHuman ? 1 + (i % 3) : 0,
          },
        });

        await prisma.message.create({
          data: {
            conversationId: convo.id,
            direction: "inbound",
            sentBy: "human",
            body: ASKS[(i + colorSeed) % ASKS.length],
            mid: `demo-mid-${convo.id}`,
            createdAt: new Date(now - waitedMs),
          },
        });
      }

      // ── โพสต์ที่ตั้งเวลาไว้ ────────────────────────────────────────
      /**
       * ข้อความต้องต่างกันจริงในทุกเพจ ไม่ใช่ชุดเดียวซ้ำ — รายการที่มีแต่
       * บรรทัดหน้าตาเหมือนกันทำให้ตัดสินไม่ได้ว่าหน้าจออ่านง่ายจริงหรือแค่
       * "ยังไม่มีอะไรให้อ่าน"
       */
      const BODIES = [
        "เมนูวันนี้ 🍛 แกงไตปลาสูตรคุณยาย เผ็ดกำลังดี สั่งก่อน 10 โมงรับส่วนลด 10%",
        "ปิดรับออเดอร์วันอาทิตย์นะคะ กลับมาเปิดปกติวันจันทร์ 🙏",
        "รีวิวจากลูกค้าประจำ — ขอบคุณที่อุดหนุนกันมาตลอด 3 ปีค่ะ",
        "เปิดจองล่วงหน้าสำหรับงานเลี้ยง 50 ที่ขึ้นไป ทักแชทได้เลยค่ะ",
        "ผักสดจากสวนวันนี้ เก็บตอนเช้า ส่งถึงบ้านตอนบ่าย 🥬",
        "กาแฟดริปตัวใหม่มาแล้ว เมล็ดดอยช้าง คั่วกลาง หอมมาก ☕",
        "แจกโค้ดส่วนลด 50 บาท 100 สิทธิ์แรก พิมพ์ว่า “รับโค้ด” ใต้โพสต์นี้",
        "พรุ่งนี้หยุด 1 วัน ไปตลาดหาของสด กลับมาเจอกันวันพุธค่ะ",
      ];

      for (let i = 0; i < 4; i++) {
        // เวลาต่างกันจริง ไม่ใช่ทุกใบลงเวลาเดียวกันหมด
        const at = now + (i * 6 + colorSeed * 2 + 1) * HOUR + i * 37 * 60_000;
        const post = await prisma.post.create({
          data: {
            pageId: page.id,
            body: BODIES[(i + colorSeed * 2) % BODIES.length],
            contentHash: `demo-hash-${page.id}-${i}`,
            scheduledAt: new Date(at),
            status: "scheduled",
            // บางใบรออนุมัติ บางใบอนุมัติแล้ว — หน้าจอต้องแยกสองอย่างนี้ให้เห็น
            approvalStatus: i % 2 === 0 ? "pending" : "approved",
          },
        });
        await prisma.postTarget.create({
          data: { postId: post.id, pageId: page.id, status: "scheduled" },
        });
      }

      // ── โพสต์ที่ยิงไม่สำเร็จ (ของจริงที่ต้องมีคนไปแก้) ──────────────
      if (colorSeed === 2) {
        const failed = await prisma.post.create({
          data: {
            pageId: page.id,
            body: "โปรโมชันวันแม่ ลด 20% ทั้งร้าน 🌸",
            contentHash: `demo-hash-failed-${page.id}`,
            scheduledAt: new Date(now - 2 * HOUR),
            status: "failed",
            approvalStatus: "approved",
          },
        });
        await prisma.postTarget.create({
          data: {
            postId: failed.id,
            pageId: page.id,
            status: "failed",
            attempts: 3,
            error: "token หมดอายุ — เชื่อมเพจใหม่แล้วสั่งยิงซ้ำ",
          },
        });
      }
    }

    // ── ช่อง/เพจที่เฝ้าดู + คอมเมนต์ ────────────────────────────────
    const watched = [
      {
        externalId: c.pages[0].fbPageId,
        platform: "FACEBOOK",
        name: c.pages[0].name,
        kind: "OWNED",
        source: "META_API",
        followers: c.pages[0].followers,
      },
      {
        externalId: `10006499${colorSeed}0`,
        platform: "FACEBOOK",
        name: `คู่แข่ง ${c.name}`,
        kind: "COMPETITOR",
        source: "EXTERNAL",
        followers: Math.round(c.pages[0].followers * 1.8),
      },
      {
        externalId: `UCdemo${String(colorSeed).padStart(2, "0")}${"x".repeat(16)}`,
        platform: "YOUTUBE",
        name: `${c.name} Channel`,
        kind: "OWNED",
        source: "YOUTUBE_API",
        followers: Math.round(c.pages[0].followers * 0.35),
      },
    ];

    for (const w of watched) {
      const tp = await prisma.trackedPage.create({
        data: {
          workspaceId: ws.id,
          externalId: w.externalId,
          platform: w.platform,
          name: w.name,
          kind: w.kind,
          source: w.source,
          followers: w.followers,
          lastFetchedAt: new Date(now - 40 * 60_000),
        },
      });

      // แหล่งข้อมูลภายนอกยังดึงไม่ได้ จึงไม่ควรมีโพสต์ — ต้องตรงกับความจริง
      if (w.source === "EXTERNAL") continue;

      for (let i = 0; i < 6; i++) {
        const yt = w.platform === "YOUTUBE";
        const post = await prisma.trackedPost.create({
          data: {
            trackedPageId: tp.id,
            externalId: `${w.externalId}_p${i}`,
            publishedAt: new Date(now - i * 2.5 * DAY),
            message: yt
              ? `รีวิวเมนูใหม่ EP.${i + 1}\n\nกดติดตามช่องด้วยนะครับ`
              : ["เมนูวันนี้ 🍛", "ขอบคุณทุกออเดอร์วันนี้ค่ะ", "เปิดจองงานเลี้ยงแล้ว"][i % 3],
            permalink: yt
              ? `https://www.youtube.com/watch?v=${w.externalId}_p${i}`
              : `https://facebook.com/${w.externalId}/posts/${i}`,
            reactions: 40 + ((i * 37 + colorSeed * 13) % 380),
            // YouTube ไม่มียอดแชร์เลย ต้องเป็น 0 เสมอ
            shares: yt ? 0 : (i * 5 + colorSeed) % 40,
            commentCount: 3 + (i % 4),
          },
        });

        for (let j = 0; j < 3 + (i % 3); j++) {
          await prisma.trackedComment.create({
            data: {
              trackedPostId: post.id,
              externalId: `${post.externalId}_c${j}`,
              authorId: yt ? `UCfan${(j + i) % 5}` : `fbuser-${(j + i) % 5}`,
              authorName: ["สุณี ป.", "วิชัย ท.", "มะลิ ต.", "ต้น ช.", "แนน ก."][(j + i) % 5],
              message: COMMENTS[(j + i + colorSeed) % COMMENTS.length],
              createdAt: new Date(now - i * 2.5 * DAY + j * HOUR),
            },
          });
        }
      }
    }

    console.log(`  ✓ ${c.name} — ${c.pages.length} เพจ + 3 รายการที่เฝ้าดู`);
  }

  const counts = {
    เพจ: await prisma.page.count(),
    บทสนทนา: await prisma.conversation.count(),
    โพสต์: await prisma.post.count(),
    "ที่เฝ้าดู": await prisma.trackedPage.count(),
    คอมเมนต์: await prisma.trackedComment.count(),
  };
  console.log(`\nเรียบร้อย: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(" · ")}`);
  console.log("ล้างออกด้วย: pnpm demo-data clear");
}

const mode = process.argv[2];
await (mode === "clear" ? clear() : seed());
await prisma.$disconnect();
