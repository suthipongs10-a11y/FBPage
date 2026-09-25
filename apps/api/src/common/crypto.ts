/** เข้ารหัสความลับ — implementation อยู่ใน @fbpm/database (ใช้ร่วมกับ worker) เพื่อให้ API และ worker ถอดรหัส token ชุดเดียวกัน (§13) */
export { encryptSecret, decryptSecret, signState, verifyState } from '@fbpm/database';
