import { readFileSync } from 'node:fs';
import { createWorldServer } from './app';
import {fileURLToPath} from 'node:url';
try {
  const path = process.env.WORLD_CONFIG ?? new URL('./world.config.json', import.meta.url);
  const server = createWorldServer(JSON.parse(readFileSync(path, 'utf8')),{saveDirectory:process.env.BUILD_SAVE_DIR??fileURLToPath(new URL('./saves/',import.meta.url))});
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  server.on('error', (error) => { console.error(`World server: ${error.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Island Z world server · http://127.0.0.1:${port}`));
} catch (error) { console.error(`Cannot start world server: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
