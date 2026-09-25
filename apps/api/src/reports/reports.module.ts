import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ShareService } from './share.service';
import { ShareController } from './share.controller';

/** Report service (§34, §64) */
@Module({ imports: [AiModule], controllers: [ReportsController, ShareController], providers: [ReportsService, ShareService], exports: [ShareService] })
export class ReportsModule {}
