import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

/** Media service (§63) — การ์ดภาพจากเทมเพลต + Creative Director (§21) */
@Module({ imports: [AiModule], controllers: [MediaController], providers: [MediaService], exports: [MediaService] })
export class MediaModule {}
