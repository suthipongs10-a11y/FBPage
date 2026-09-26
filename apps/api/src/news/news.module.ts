import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ContentModule } from '../content/content.module';
import { MediaModule } from '../media/media.module';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';

/** ห้องข่าว — แหล่งข่าว → คัด → เขียนโพสต์ของเพจ → รออนุมัติ */
@Module({ imports: [AiModule, ContentModule, MediaModule], controllers: [NewsController], providers: [NewsService] })
export class NewsModule {}
