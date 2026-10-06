import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {GENERATOR_VERSION,parseWorldConfig} from '../shared/config';
import {encodeMessage,decodeMessage,validCell,PROTOCOL_VERSION} from '../shared/network';
import {WorldService} from './world-service';
export function createWorldServer(configuration:unknown,options:{saveDirectory?:string;origins?:string[]}={}){
 const world=Object.freeze({...parseWorldConfig(configuration),generatorVersion:GENERATOR_VERSION});
 const peers=new Map<string,WebSocket>(),connections=new Map<WebSocket,string>(),alive=new Set<WebSocket>();let service:WorldService|undefined;
 const send=(id:string,m:any)=>{const peer=peers.get(id);if(!peer||peer.readyState!==WebSocket.OPEN)return;if(peer.bufferedAmount>256*1024){if(m.type==='players'||m.type==='motion')return;if(peer.bufferedAmount>8*1024*1024){peer.close(1013,'Slow connection; reconnect to resync');return;}}peer.send(encodeMessage(m));};
 const authority=()=>service??=new WorldService(world,options.saveDirectory,send);
 const allowed=(origin:string|undefined,host:string|undefined)=>{if(!origin)return !options.origins?.length;try{const u=new URL(origin);return options.origins?.length?options.origins.includes(u.origin):u.host===host;}catch{return false;}};
 const server=createServer((req,res)=>{const origin=req.headers.origin;if(!allowed(origin,req.headers.host)){res.writeHead(403);res.end('Origin not allowed');return;}if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
   const url=new URL(req.url??'/','http://localhost'),path=url.pathname;if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, OPTIONS'});res.end();return;}if(req.method!=='GET'){res.writeHead(405,{Allow:'GET'});res.end(JSON.stringify({error:'World commands require a joined WebSocket session'}));return;}
   if(path==='/api/world'){res.end(JSON.stringify(world));return;}if(path==='/api/health'){void authority().request('performance').then(()=>res.end(JSON.stringify({status:'ok',generatorVersion:GENERATOR_VERSION}))).catch(()=>{res.writeHead(503);res.end(JSON.stringify({status:'unavailable'}));});return;}
   if(path==='/api/performance'){void authority().request('performance').then(v=>res.end(JSON.stringify(v))).catch(()=>{res.writeHead(503);res.end('{}');});return;}
   if(path==='/api/builds'){const session=url.searchParams.get('session')??'',generation=Number(url.searchParams.get('generation')),cells=(url.searchParams.get('cells')??'').split(',').filter(Boolean);if(peers.get(session)?.readyState!==WebSocket.OPEN||!Number.isSafeInteger(generation)||generation<1||cells.length>16||cells.some(c=>!validCell(c))){res.writeHead(400);res.end(JSON.stringify({error:'Invalid or expired region request'}));return;}
     void authority().request('baseline',session,{cells,generation}).then(v=>{const bytes=encodeMessage(v);if(bytes.length>32*1024*1024)throw new Error('Region too large');res.setHeader('Content-Type','application/octet-stream');res.end(bytes);}).catch(()=>{res.writeHead(409);res.end(JSON.stringify({error:'Region load obsolete; retry'}));});return;}
   res.writeHead(404);res.end(JSON.stringify({error:'Not found'}));
 });
 const sockets=new WebSocketServer({noServer:true,maxPayload:32768});
 server.on('upgrade',(req,socket,head)=>{if(!allowed(req.headers.origin,req.headers.host)||new URL(req.url??'/','http://localhost').pathname!=='/api/events'){socket.destroy();return;}sockets.handleUpgrade(req,socket,head,peer=>sockets.emit('connection',peer));});
 sockets.on('connection',peer=>{const id=randomUUID();peers.set(id,peer);connections.set(peer,id);alive.add(peer);send(id,{type:'hello',connection:id,version:PROTOCOL_VERSION});let joined=false,busy=false,windowStart=Date.now(),messages=0,bytes=0;let ordered=Promise.resolve();
   peer.on('pong',()=>alive.add(peer));peer.on('message',(data,binary)=>{if(Date.now()-windowStart>1000){windowStart=Date.now();messages=0;bytes=0;}if(++messages>120||(bytes+=(data instanceof ArrayBuffer?data.byteLength:Array.isArray(data)?data.reduce((n,b)=>n+b.length,0):data.length))>128*1024||!binary){peer.close(1008,'Message limit or format');return;}
     let m:any;try{m=decodeMessage(new Uint8Array(data as Buffer),32768);if(!m||typeof m!=='object'||Array.isArray(m)||typeof m.type!=='string')throw new Error('Invalid envelope');}catch{peer.close(1008,'Invalid binary message');return;}
     if(m.type==='ping'){send(id,{type:'pong',sent:m.sent});return;}
     if(!joined&&!busy&&m.type!=='join'){peer.close(1008,'Join first');return;}
     if(m.type==='join'){if(joined||busy){peer.close(1008,'Already joining');return;}busy=true;ordered=ordered.then(async()=>{await authority().request('join',id,m);joined=true;});}
     else ordered=ordered.then(async()=>{if(m.type==='inputs')await authority().request('inputs',id,m.steps);else if(m.type==='subscribe'){const v=await authority().request('subscribe',id,m);send(id,{type:'subscribed',...v});}else if(m.type==='command')await authority().request('command',id,m);else throw new Error('Unknown message');});
     ordered=ordered.catch(e=>{send(id,{type:'error',error:e.message});peer.close(1008,'Invalid session message');});
   });
   peer.on('close',()=>{peers.delete(id);connections.delete(peer);alive.delete(peer);if(!closing)void ordered.then(()=>service?.request('leave',id)).catch(e=>console.error('Disconnect save:',e));});
 });
 const heartbeat=setInterval(()=>{for(const peer of peers.values()){if(!alive.delete(peer)){peer.terminate();continue;}peer.ping();}},15000);heartbeat.unref();
 const close=server.close.bind(server);let closing=false;server.close=((callback?:Parameters<typeof server.close>[0])=>{if(closing)return server;closing=true;clearInterval(heartbeat);for(const peer of peers.values())peer.terminate();void(service?.close()??Promise.resolve()).then(()=>{sockets.close();close(callback);}).catch(error=>{console.error('World shutdown:',error);close(()=>callback?.(error));});return server;})as typeof server.close;
 return server;
}
