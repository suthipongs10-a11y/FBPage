import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { TikTokController, TikTokCallbackController } from './tiktok.controller';
import { TikTokService } from './tiktok.service';
import { TikTokContentService } from './content.service';
import { tiktokProvider } from './tiktok.provider';
@Module({ imports: [AiModule], controllers: [TikTokController, TikTokCallbackController], providers: [tiktokProvider, TikTokService, TikTokContentService] })
export class TikTokModule {}
