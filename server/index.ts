import { readFileSync } from 'node:fs';
import { createWorldServer } from './app';
import {fileURLToPath} from 'node:url';
try {
  const path = process.env.WORLD_CONFIG ?? new URL('./world.config.json', import.meta.url);
  const server = createWorldServer(JSON.parse(readFileSync(path, 'utf8')),{saveDirectory:process.env.WORLD_SAVE_DIR??fileURLToPath(new URL('../server/saves/',import.meta.url)),origins:process.env.CLIENT_ORIGINS?.split(',').map(v=>v.trim()).filter(Boolean)});
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>server.close(error=>{if(error)console.error(error);process.exitCode=error?1:0;}));
  server.on('error', (error) => { console.error(`World server: ${error.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Island Z world server · http://127.0.0.1:${port}`));
} catch (error) { console.error(`Cannot start world server: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
