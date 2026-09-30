import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

/** แพ็กเกจลูกค้า + โควต้าโพสต์ + ภาพรวมทุกเพจ — docs/PLANS_QUOTA.md */
@Module({ controllers: [PlansController], providers: [PlansService], exports: [PlansService] })
export class PlansModule {}
