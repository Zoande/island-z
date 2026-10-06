/** Segments keep immutable contour templates within Pages' per-file size limit. */
export async function loadContour(url:string):Promise<Uint8Array|undefined>{
 const manifestURL=url.replace(/\.gz$/,'.manifest.json'),response=await fetch(manifestURL);
 if(response.ok&&response.headers.get('Content-Type')?.includes('json')){const manifest=await response.json();if(manifest.version!==1||!Array.isArray(manifest.parts)||manifest.length>128*1024*1024)throw new Error('Invalid contour manifest');const buffers:Uint8Array[]=[];let length=0;
   for(const part of manifest.parts){if(typeof part.path!=='string'||!/^[a-f0-9]{64}\.bin$/.test(part.path)||part.length>8*1024*1024)throw new Error('Invalid contour segment');const r=await fetch(new URL(part.path,new URL(manifestURL,location.href)));if(!r.ok)throw new Error('Contour segment failed');const b=new Uint8Array(await r.arrayBuffer());if(b.length!==part.length||hex(await crypto.subtle.digest('SHA-256',b))!==part.hash)throw new Error('Contour segment checksum mismatch');buffers.push(b);length+=b.length;}
   if(length!==manifest.length)throw new Error('Contour length mismatch');const blob=new Blob(buffers as BlobPart[]);return new Uint8Array(await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
 }
 const direct=await fetch(url);if(!direct.ok||!direct.body)return;return new Uint8Array(await new Response(direct.headers.get('Content-Encoding')?.includes('gzip')?direct.body:direct.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),n=>n.toString(16).padStart(2,'0')).join('');
