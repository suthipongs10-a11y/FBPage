import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ContentModule } from '../content/content.module';
import { MediaModule } from '../media/media.module';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';
import { NewsAutomationService } from './automation.service';
import { ContentImportService } from './import.service';
import { InboxController } from './inbox.controller';
import { ResearchService } from './research.service';
import { PageScoutService } from './scout.service';

/** ห้องข่าว — แหล่งข่าว → คัด → เขียนโพสต์ของเพจ → รออนุมัติ · นำเข้าแพ็กเกจจาก AI ภายนอก */
@Module({ imports: [AiModule, ContentModule, MediaModule], controllers: [NewsController, InboxController], providers: [NewsService, NewsAutomationService, ContentImportService, ResearchService, PageScoutService], exports: [NewsAutomationService] })
export class NewsModule {}
