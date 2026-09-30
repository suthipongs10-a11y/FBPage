import { Module } from '@nestjs/common';
import { LineController, LineWebhookController } from './line.controller';
import { LineService } from './line.service';

/** แจ้งเตือน LINE OA — docs/LINE_PORTAL.md */
@Module({ controllers: [LineController, LineWebhookController], providers: [LineService], exports: [LineService] })
export class LineModule {}
