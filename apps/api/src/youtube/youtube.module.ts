import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { GoogleOAuthCallbackController, YoutubeController } from './youtube.controller';
import { quotaProvider, ytProvider } from './youtube.provider';
import { YtChannelsService } from './channels.service';
import { YtVideosService } from './videos.service';
import { YtCommentsService } from './comments.service';
import { YtContentLabService } from './content-lab.service';
import { YtReportsService } from './reports.service';

/** YouTube AI Channel Manager (AGENTS_YOUTUBE.md) — โมดูลใน monorepo เดียว ใช้ auth/tenant/AI gateway/queue/notification ร่วมกับ Facebook */
@Module({ imports: [AiModule], controllers: [YoutubeController, GoogleOAuthCallbackController], providers: [quotaProvider, ytProvider, YtChannelsService, YtVideosService, YtCommentsService, YtContentLabService, YtReportsService], exports: [YtChannelsService, YtContentLabService] })
export class YoutubeModule {}
