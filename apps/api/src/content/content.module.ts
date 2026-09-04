import { Module } from '@nestjs/common';
import { FacebookModule } from '../facebook/facebook.module';
import { AiModule } from '../ai/ai.module';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { ContentAgentsService } from './agents.service';

/** Content domain + approval + scheduling + publish + Strategist/Content/Reviewer agents (§73 ข้อ 14–19) */
@Module({ imports: [FacebookModule, AiModule], controllers: [ContentController], providers: [ContentService, ContentAgentsService], exports: [ContentService] })
export class ContentModule {}
