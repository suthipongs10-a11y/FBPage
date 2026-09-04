import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from './env';

/** โหลด + ตรวจ env ครั้งเดียว แล้วแจก ENV ให้ทุกโมดูลผ่าน global scope */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
