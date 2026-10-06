import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {solidSource,encodeContourTemplate,meshVolume,emptyVolume} from '../shared/volume';
import {initializeMeshRefinement,refineVolumeMeshes} from '../shared/mesh-refinement';
await initializeMeshRefinement();
mkdirSync('public/models/solids',{recursive:true});
for(const kind of ['oak','birch','palm'])for(let variant=0;variant<(kind==='palm'?3:6);variant++){
  const key=`${kind}-${variant}`;if(process.argv[2]&&process.argv[2]!==key)continue;
  const began=performance.now(),asset=JSON.parse(readFileSync(`public/models/${key}-solid.json`,'utf8')),source=solidSource(asset.primitives);for(const m of meshVolume(source,emptyVolume())){const levels=[.0015,.005,.02,.08].map(error=>{const r=refineVolumeMeshes([m],error)[0];return {material:r.material,vertices:r.vertices,indices:r.indices};});m.prepared=levels;}const bytes=gzipSync(encodeContourTemplate(source));
  writeFileSync(`public/models/solids/${key}.contour.gz`,bytes);console.log(`${key}: ${(bytes.length/1048576).toFixed(2)} MiB, ${Math.round(performance.now()-began)} ms`);
}
