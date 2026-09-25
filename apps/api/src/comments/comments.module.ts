import { Module } from '@nestjs/common';
import { FacebookModule } from '../facebook/facebook.module';
import { AiModule } from '../ai/ai.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

/** Comment intelligence + leads (§23, §24, §33) */
@Module({ imports: [FacebookModule, AiModule], controllers: [CommentsController], providers: [CommentsService] })
export class CommentsModule {}
