import { Module } from '@nestjs/common';
import { FacebookController, OAuthCallbackController } from './facebook.controller';
import { facebookProvider } from './facebook.provider';
import { ConnectionsService } from './connections.service';
import { PagesService } from './pages.service';
import { SyncService } from './sync.service';

/** Facebook connection + page sync (AGENTS.md §106 ขั้น 3–4) */
@Module({
  controllers: [FacebookController, OAuthCallbackController],
  providers: [facebookProvider, ConnectionsService, SyncService, PagesService],
  exports: [facebookProvider, SyncService, PagesService],
})
export class FacebookModule {}
