import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiGatewayService } from './gateway.service';
import { AiSettingsService } from './settings.service';
import { CommandService } from './command.service';
import { AnalystService } from './analyst.service';

/** AI Gateway + settings + command center + analyst (AGENTS.md §106 ขั้น 5, §73 ข้อ 11–13) */
@Module({
  controllers: [AiController],
  providers: [AiGatewayService, AiSettingsService, CommandService, AnalystService],
  exports: [AiGatewayService],
})
export class AiModule {}
