import { Logger } from '@nestjs/common';
import { createApp } from './app.factory';

async function bootstrap(): Promise<void> {
  const { app, env } = await createApp();
  await app.listen(env.API_PORT, '0.0.0.0');
  new Logger('bootstrap').log(`API listening on :${env.API_PORT} (env=${env.APP_ENV}) · OpenAPI at /docs`);
}

bootstrap().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
