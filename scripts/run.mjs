import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
process.env.MEDIA_DIR = resolve(root, process.env.MEDIA_DIR || 'data/media');
const task = process.argv[2];
const win = process.platform === 'win32';
const cmds = {
  api: ['--filter', '@fbpm/api', 'dev'],
  web: ['--filter', '@fbpm/web', 'exec', 'next', 'dev', '-p', process.env.WEB_PORT || '3000'],
  worker: ['--filter', '@fbpm/worker-scheduler', 'dev'],
  migrate: ['--filter', '@fbpm/database', 'exec', 'prisma', 'migrate', 'deploy'],
};
const args = cmds[task];
if (!args) throw new Error('Expected api, web, worker or migrate');
const child = spawn(win ? 'pnpm.cmd' : 'pnpm', args, { cwd: root, stdio: 'inherit', shell: win, windowsHide: true });
child.on('exit', code => process.exit(code ?? 1));
child.on('error', () => { console.error('Could not start pnpm'); process.exit(1); });
