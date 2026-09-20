import { Module } from '@nestjs/common';
import { MessengerModule } from '../messenger/messenger.module';
import { FacebookController, OAuthCallbackController } from './facebook.controller';
import { WebhookController } from './webhook.controller';
import { facebookProvider } from './facebook.provider';
import { ConnectionsService } from './connections.service';
import { PagesService } from './pages.service';
import { SyncService } from './sync.service';

/** Facebook connection + page sync (AGENTS.md §106 ขั้น 3–4) */
@Module({
  imports: [MessengerModule],
  controllers: [FacebookController, OAuthCallbackController, WebhookController],
  providers: [facebookProvider, ConnectionsService, SyncService, PagesService],
  exports: [facebookProvider, SyncService, PagesService],
})
export class FacebookModule {}
