import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { EmailController, EmailPublicController } from './email.controller';
import { emailProvider } from './email.provider';
import { EmailService } from './email.service';

/** W-4 Email marketing (AGENTS_WEB.md) — ผู้ให้บริการส่งจำนวนมาก + รายชื่อ/consent + แคมเปญอนุมัติ + webhook สถิติ */
@Module({ imports: [AiModule], controllers: [EmailController, EmailPublicController], providers: [emailProvider, EmailService], exports: [EmailService] })
export class EmailModule {}
