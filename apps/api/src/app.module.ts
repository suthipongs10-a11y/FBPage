import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { ClientsModule } from './clients/clients.module';
import { BrandsModule } from './brands/brands.module';
import { FacebookModule } from './facebook/facebook.module';
import { AiModule } from './ai/ai.module';
import { JobsModule } from './jobs/jobs.module';
import { ContentModule } from './content/content.module';
import { ReportsModule } from './reports/reports.module';
import { MediaModule } from './media/media.module';

@Module({
  imports: [ConfigModule, DatabaseModule, RedisModule, AuditModule, AuthModule, WorkspacesModule, ClientsModule, BrandsModule, JobsModule, FacebookModule, AiModule, ContentModule, ReportsModule, MediaModule, HealthModule],
})
export class AppModule {}
