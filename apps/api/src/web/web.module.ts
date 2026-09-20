import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { WebController } from './web.controller';
import { webProvider, webPublishProvider } from './web.provider';
import { SitesService } from './sites.service';
import { WebContentService } from './web-content.service';

/** Website Care (AGENTS_WEB.md) — W-1 monitoring + W-2 Search Console/SEO Analyst + W-3 web content → WordPress */
@Module({ imports: [AiModule], controllers: [WebController], providers: [webProvider, webPublishProvider, SitesService, WebContentService], exports: [SitesService, WebContentService] })
export class WebModule {}
