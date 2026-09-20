import { Global, Module } from '@nestjs/common';
import { MAILER, mailerProvider } from './mailer.provider';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({ controllers: [NotificationsController], providers: [NotificationsService, mailerProvider], exports: [NotificationsService, MAILER] })
export class NotificationsModule {}
