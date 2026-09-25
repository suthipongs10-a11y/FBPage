import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { MessengerController } from './messenger.controller';
import { MessengerService } from './messenger.service';
@Module({ imports: [AiModule], controllers: [MessengerController], providers: [MessengerService], exports: [MessengerService] })
export class MessengerModule {}
