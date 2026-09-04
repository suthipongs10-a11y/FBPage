import { HttpException, HttpStatus } from '@nestjs/common';
import { FacebookApiError } from '@fbpm/facebook-core';

/** แปลง FacebookApiError เป็น HTTP error ที่หน้าเว็บอ่านรู้เรื่อง (§59) — ไม่เผย token หรือ payload ภายใน */
export function rethrowGraph(e: unknown): never {
  if (e instanceof FacebookApiError) {
    const status = e.isTokenError || e.isPermissionError ? HttpStatus.UNPROCESSABLE_ENTITY
      : e.isRateLimited ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.BAD_GATEWAY;
    throw new HttpException({ statusCode: status, message: e.userMessage, facebookCode: e.code, facebookSubcode: e.subcode }, status);
  }
  throw e;
}
