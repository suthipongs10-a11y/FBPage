import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { LegalController } from './legal.controller';

@Module({ controllers: [HealthController, LegalController] })
export class HealthModule {}
