# ตั้งค่า Google Cloud สำหรับโมดูล YouTube

1. สร้างโปรเจกต์ใน Google Cloud Console → **APIs & Services → Library** เปิด **YouTube Data API v3** และ **YouTube Analytics API**
2. **Credentials → Create credentials → API key** → ใส่ใน `YOUTUBE_API_KEY` (ใช้อ่านช่องสาธารณะ/วิเคราะห์อย่างเดียว) — จำกัด key ให้ใช้ได้เฉพาะ YouTube Data API
3. **OAuth consent screen** → External → เพิ่ม scopes:
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/yt-analytics.readonly` (+ `yt-analytics-monetary.readonly` ถ้าลูกค้าต้องการรายได้)
   - `https://www.googleapis.com/auth/youtube.force-ssl` (ตอบคอมเมนต์ / แก้ metadata / playlist)
   - `https://www.googleapis.com/auth/youtube.upload` (อัปโหลด)
   - `https://www.googleapis.com/auth/userinfo.email`
   ระหว่างยังไม่ผ่าน verification ให้เพิ่มอีเมลเจ้าของช่องเป็น **Test users**
4. **Credentials → OAuth client ID → Web application** → Authorized redirect URI = `<API_URL>/youtube/oauth/callback` (เช่น `https://api.example.com/youtube/oauth/callback` หรือ `http://localhost:4000/youtube/oauth/callback`)
5. ใส่ค่าใน `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` แล้วรีสตาร์ท API + worker
6. **อัปโหลดผ่านระบบ**: แอปที่ยังไม่ผ่าน [API compliance audit](https://support.google.com/youtube/contact/yt_api_form) จะอัปโหลดได้แค่ `private` — ตั้ง `YOUTUBE_UPLOAD_ENABLED=true` เมื่อพร้อม; ก่อนนั้นระบบทำโหมด "เตรียมแพ็กเกจ" (ชื่อ/description/tags/สคริปต์/บรีฟปก) ให้คนอัปโหลดเองใน YouTube Studio (§104)
7. โควตา 10,000 units/วัน — ดูการใช้ที่หน้า **YouTube → โควตา API วันนี้**; ขอเพิ่มผ่าน Quota extension form เมื่อมีหลายช่อง

## ทางลัดตอนพัฒนา (เหมือน Facebook)
เปิด [OAuth Playground](https://developers.google.com/oauthplayground) → ⚙ ใช้ client id/secret ของเรา → เลือก scopes ข้างบน → Authorize → Exchange → คัดลอก **refresh token** → วางที่หน้า **YouTube → วาง refresh token** (token ถูกเข้ารหัสด้วย `AUTH_SECRET` ไม่แสดงซ้ำ)

## ทดสอบโดยไม่แตะช่องจริง
```
YOUTUBE_MOCK_BASE_URL=http://127.0.0.1:4997 GOOGLE_CLIENT_ID=gclient GOOGLE_CLIENT_SECRET=gsecret \
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:4000/youtube/oauth/callback YOUTUBE_API_KEY=APIKEY_OK YOUTUBE_UPLOAD_ENABLED=true pnpm dev:api
node test/phase9-smoke.mjs
```
