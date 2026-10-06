import {readdirSync,statSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const directory='dist/models/solids',segmentSize=8*1024*1024;
for(const name of readdirSync(directory).filter(n=>n.endsWith('.contour.gz'))){const bytes=readFileSync(join(directory,name)),parts=[];
 for(let offset=0;offset<bytes.length;offset+=segmentSize){const segment=bytes.subarray(offset,offset+segmentSize),hash=createHash('sha256').update(segment).digest('hex'),path=`${hash}.bin`;writeFileSync(join(directory,path),segment);parts.push({path,length:segment.length,hash});}
 writeFileSync(join(directory,name.replace('.gz','.manifest.json')),JSON.stringify({version:1,length:bytes.length,hash:createHash('sha256').update(bytes).digest('hex'),parts}));unlinkSync(join(directory,name));
}
function check(path){for(const entry of readdirSync(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isDirectory())check(file);else if(statSync(file).size>25*1024*1024)throw new Error('Cloudflare Pages asset too large: '+file);}}
check('dist');console.log('Pages assets segmented and file-size check passed');
