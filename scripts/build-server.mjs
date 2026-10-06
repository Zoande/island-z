import {build} from 'esbuild';
import {mkdirSync,copyFileSync} from 'node:fs';
mkdirSync('dist-server',{recursive:true});
await build({entryPoints:['server/index.ts','server/world-worker.ts','server/journal-worker.ts','server/geometry-worker.ts'],outdir:'dist-server',bundle:true,platform:'node',target:'node22',format:'esm',packages:'external',outExtension:{'.js':'.js'}});
for(const name of ['world','journal','geometry'])copyFileSync(`server/${name}-worker.production.mjs`,`dist-server/${name}-worker.mjs`);
copyFileSync('server/world.config.json','dist-server/world.config.json');
