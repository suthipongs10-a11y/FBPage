/**
 * schema แบบผ่อนปรนสำหรับผลลัพธ์ของ AI — ข้อความยาวเกิน/รายการเกินจำนวน "ตัดให้" แทนการปัดตกทั้งชุด
 * (เจอจริง: Gemini เขียนมุมเล่ายาวเกิน 300 ตัวอักษร 1 ข้อ → ไอเดียทั้ง 6 ข้อหาย แม้ลองซ้ำแล้ว)
 * ยังบังคับของที่ขาดไม่ได้ (ข้อความขั้นต่ำ, enum, รายการอย่างน้อย 1)
 */
import { z } from 'zod';

/** ข้อความ ≤ max ตัวอักษร (ยาวกว่านั้นตัดแล้วเติม …) · min = ความยาวขั้นต่ำที่ยังบังคับ */
export const clip = (max: number, min = 0) => (min > 0 ? z.string().min(min) : z.string()).transform(s => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s));
/** รายการ ≤ max ข้อ (เกินตัดทิ้งส่วนท้าย) */
export const upTo = <T extends z.ZodType>(item: T, max: number, min = 0) => (min > 0 ? z.array(item).min(min) : z.array(item)).transform(a => a.slice(0, max));
