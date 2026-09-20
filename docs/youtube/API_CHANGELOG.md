# YouTube module — API changelog (AGENTS_YOUTUBE.md §167)

รูปแบบ: `<วันที่> · <API/เวอร์ชัน> · <สิ่งที่พึ่งพา> · <ผลกระทบถ้าเปลี่ยน>`

| วันที่ | API | สิ่งที่ระบบพึ่งพา | หมายเหตุ / ความเสี่ยง |
| --- | --- | --- | --- |
| 2026-09-05 | YouTube Data API v3 | `channels.list` (mine / id / forHandle) part `snippet,statistics,contentDetails,brandingSettings` | 1 unit ต่อครั้ง |
| 2026-09-05 | YouTube Data API v3 | `playlistItems.list` บน uploads playlist (`UU…`) แทน `search.list` | 1 unit/หน้า แทน 100 — อย่าเปลี่ยนไปใช้ search |
| 2026-09-05 | YouTube Data API v3 | `videos.list` part `snippet,contentDetails,statistics,status` (≤ 50 id/ครั้ง) | `commentCount` อาจไม่ส่งมา → เก็บ `null` |
| 2026-09-05 | YouTube Data API v3 | `videos.update` (title/description/tags/categoryId/privacyStatus/publishAt) | 50 units; ต้องส่ง snippet ครบ (API แทนที่ทั้งก้อน) |
| 2026-09-05 | YouTube Data API v3 | `commentThreads.list`, `comments.list`, `comments.insert` (reply) | 1/1/50 units; `commentsDisabled` (403) ต่อวิดีโอไม่ถือเป็น sync failure |
| 2026-09-05 | YouTube Data API v3 | `playlists.list/insert`, `playlistItems.insert` | 1/50/50 units |
| 2026-09-05 | YouTube Data API v3 | resumable upload `POST /upload/youtube/v3/videos?uploadType=resumable` → `Location` → PUT chunks (`Content-Range`), 308 = resume | 1600 units; ต้องผ่าน API audit ถึงจะเผยแพร่ public ได้ (§104) |
| 2026-09-05 | YouTube Data API v3 | `thumbnails.set` | 50 units; ช่องต้องยืนยันเบอร์โทร |
| 2026-09-05 | YouTube Analytics API v2 | `reports.query ids=channel==MINE` metrics `views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost` (+ `estimatedRevenue` เมื่อมี scope monetary) | ข้อมูลล่าช้า 24–72 ชม. (§94); ไม่มี impressions/CTR → แสดง "ไม่มีข้อมูล" |
| 2026-09-05 | Google OAuth 2.0 | `accounts.google.com/o/oauth2/v2/auth`, `oauth2.googleapis.com/token`, `/tokeninfo`, `/revoke` | `invalid_grant` = ต้องเชื่อมใหม่ (§122); scopes ขั้นต่ำตามฟีเจอร์ (§8) |
| 2026-09-05 | Quota | 10,000 units/วัน/โปรเจกต์ รีเซ็ตเที่ยงคืน Pacific | บันทึกทุกคำขอลง `YouTubeApiUsage`; เตือนที่ 80% ผ่าน notification |

## Error normalization (§139)
`quotaExceeded` → 429 · `invalid_grant`/`authError` → 422 + `reconnect_required` · `insufficientPermissions`/`forbidden` → 422 · `commentsDisabled` → ทำเครื่องหมายเฉพาะวิดีโอ · `notFound` → 404 · อื่นๆ → 502 (retry ตาม backoff ใน `YouTubeClient`)
