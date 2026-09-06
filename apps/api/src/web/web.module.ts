import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { WebController } from './web.controller';
import { webProvider } from './web.provider';
import { SitesService } from './sites.service';

/** Website Care (AGENTS_WEB.md) — W-1 monitoring + W-2 Search Console/SEO Analyst */
@Module({ imports: [AiModule], controllers: [WebController], providers: [webProvider, SitesService], exports: [SitesService] })
export class WebModule {}
