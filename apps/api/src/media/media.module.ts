import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MediaGenService } from './media-gen.service';

/** Media service (§63) — การ์ดภาพจากเทมเพลต + Creative Director (§21) */
@Module({ imports: [AiModule], controllers: [MediaController], providers: [MediaService, MediaGenService], exports: [MediaService, MediaGenService] })
export class MediaModule {}
