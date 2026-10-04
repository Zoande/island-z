import { createServer } from 'node:http';
import { GENERATOR_VERSION, parseWorldConfig } from '../shared/config';
import {BuildStore} from './build-store';
export function createWorldServer(configuration: unknown,options:{saveDirectory?:string}={}) {
  const world = Object.freeze({ ...parseWorldConfig(configuration), generatorVersion: GENERATOR_VERSION });
  let builds:BuildStore|undefined;
  const store=()=>builds??=new BuildStore(world,options.saveDirectory);
  return createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const url=new URL(req.url ?? '/', 'http://localhost'),path=url.pathname;
    if(path==='/api/builds'&&req.method==='POST') {
      let size=0,body='';let rejected=false;
      req.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>8192){if(!rejected){rejected=true;res.writeHead(413);res.end(JSON.stringify({ok:false,code:'request',error:'Placement request is too large'}));}return;}body+=chunk.toString('utf8');});
      req.on('end',()=>{if(rejected)return;try{const result=store().place(JSON.parse(body));res.writeHead(result.ok?201:409);res.end(JSON.stringify(result));}catch(error){res.writeHead(400);res.end(JSON.stringify({ok:false,code:'request',error:error instanceof SyntaxError?'Invalid JSON':'The building service could not load its world'}));}});
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405, { Allow: path==='/api/builds'?'GET, POST':'GET' }); res.end(JSON.stringify({ error: 'Method not allowed.' })); return; }
    if (path === '/api/world') { res.end(JSON.stringify(world)); return; }
    if (path === '/api/health') { res.end(JSON.stringify({ status: 'ok', generatorVersion: GENERATOR_VERSION })); return; }
    if(path==='/api/builds') {
      const cells=(url.searchParams.get('cells')??'').split(',').filter(Boolean),since=url.searchParams.get('since');
      if(cells.length>64||cells.some(c=>!/^[-]?\d{1,7}:[-]?\d{1,7}$/.test(c))||since!==null&&!/^\d{1,12}$/.test(since)){res.writeHead(400);res.end(JSON.stringify({error:'Invalid build region query'}));return;}
      try{res.end(JSON.stringify(store().snapshot([...new Set(cells)],since===null?undefined:Number(since))));}catch(error){console.error(error);res.writeHead(500);res.end(JSON.stringify({error:'The building service could not load its world'}));}return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'Not found.' }));
  });
}
