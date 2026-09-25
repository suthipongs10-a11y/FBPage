import { Global, Module } from '@nestjs/common';
import { PRISMA, PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [{ provide: PRISMA, useClass: PrismaService }],
  exports: [PRISMA],
})
export class DatabaseModule {}
