import { HttpException, HttpStatus } from '@nestjs/common';
import { ChannelNotAccessible, YouTubeApiError } from '@fbpm/youtube-core';
/** normalized error → HTTP (§139) */
export function rethrowYt(e: unknown): never {
  if (e instanceof ChannelNotAccessible) throw new HttpException({ statusCode: HttpStatus.UNPROCESSABLE_ENTITY, message: e.message, reason: e.reason }, HttpStatus.UNPROCESSABLE_ENTITY);
  if (e instanceof YouTubeApiError) {
    const status = e.code === 'quotaExceeded' ? HttpStatus.TOO_MANY_REQUESTS : e.code === 'rateLimit' ? HttpStatus.TOO_MANY_REQUESTS : e.code === 'notFound' ? HttpStatus.NOT_FOUND : e.needsReconnect || e.code === 'forbidden' || e.code === 'commentsDisabled' || e.code === 'invalidRequest' || e.code === 'uploadNotEnabled' ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.BAD_GATEWAY;
    throw new HttpException({ statusCode: status, message: e.userMessage, code: e.code }, status);
  }
  throw e;
}
