import { Global, Module } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Global()
@Module({
  controllers: [WorkspacesController],
  providers: [WorkspacesService, TenantGuard],
  exports: [TenantGuard],
})
export class WorkspacesModule {}
