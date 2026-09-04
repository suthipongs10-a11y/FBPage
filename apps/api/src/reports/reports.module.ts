import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/** Report service (§34, §64) */
@Module({ imports: [AiModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
