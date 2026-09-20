import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { InvitesService } from './invites.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, InvitesService],
  exports: [AuthService, AuthGuard, InvitesService],
})
export class AuthModule {}
