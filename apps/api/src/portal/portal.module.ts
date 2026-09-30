import { Module } from '@nestjs/common';
import { CommentsModule } from '../comments/comments.module';
import { MessengerModule } from '../messenger/messenger.module';
import { ContentModule } from '../content/content.module';
import { ReportsModule } from '../reports/reports.module';
import { LineModule } from '../line/line.module';
import { PortalController, PortalInviteController, PortalTeamController } from './portal.controller';
import { PortalService } from './portal.service';

/** พอร์ทัลลูกค้า (เจ้าของธุรกิจ) — docs/LINE_PORTAL.md */
@Module({ imports: [CommentsModule, MessengerModule, ContentModule, ReportsModule, LineModule], controllers: [PortalTeamController, PortalInviteController, PortalController], providers: [PortalService] })
export class PortalModule {}
