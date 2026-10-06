import { createServer } from 'node:http';
import { GENERATOR_VERSION, parseWorldConfig } from '../shared/config';
import {BuildStore} from './build-store';
import {DestructionStore} from './destruction-store';
import {FallingSimulation} from './falling';
import {WebSocketServer,WebSocket} from 'ws';
import {buildCell} from '../shared/object-registry';
import {predictionReply,validAction,type WorldAction} from '../shared/destruction';
export function createWorldServer(configuration: unknown,options:{saveDirectory?:string}={}) {
  const world = Object.freeze({ ...parseWorldConfig(configuration), generatorVersion: GENERATOR_VERSION });
  let builds:BuildStore|undefined;
  const store=()=>builds??=new BuildStore(world,options.saveDirectory);
  let edits:DestructionStore|undefined,falling:FallingSimulation|undefined;
  const peers=new Map<WebSocket,Set<string>>();
  const sessions=new Map<WebSocket,string>(),requests=new Map<string,WorldAction>();
  const broadcast=(message:any)=>{for(const [peer,cells]of peers){if(peer.readyState!==WebSocket.OPEN)continue;const records=message.patch?.solids??message.states??[];if(!records.length||records.some((r:any)=>{const p=r.pose?.position??(r.prop&&[r.prop.x,r.prop.y,r.prop.z]);return !p||cells.has(buildCell(p[0],p[2]))||r.prop&&cells.has(buildCell(r.prop.x,r.prop.z));})){const request=requests.get(message.patch?.actionId);const reply=request&&request.sessionId===sessions.get(peer)?predictionReply({ok:true,requestId:request.requestId,patch:message.patch},request.prediction):undefined;peer.send(JSON.stringify(reply?.ok&&'ack'in reply?{type:'ack',worldKey:store().worldKey,result:reply}:message));}}};
  const destruction=()=>{if(!edits){edits=new DestructionStore(store(),options.saveDirectory);falling=new FallingSimulation(edits);edits.listeners.add(patch=>broadcast({type:'patch',worldKey:store().worldKey,patch}));falling.listeners.add(states=>broadcast({type:'motion',states}));}return edits;};
  const server=createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const url=new URL(req.url ?? '/', 'http://localhost'),path=url.pathname;
    if(path==='/api/actions'&&req.method==='POST'){let body='',size=0,rejected=false;req.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>8192){if(!rejected){rejected=true;res.writeHead(413);res.end(JSON.stringify({ok:false,code:'request',error:'Action request too large'}));}return;}body+=chunk.toString('utf8');});req.on('end',()=>{if(rejected)return;let input:unknown;try{input=JSON.parse(body);}catch{res.writeHead(400);res.end(JSON.stringify({ok:false,code:'request',error:'Invalid JSON'}));return;}const action=validAction(input)?input:undefined;if(action)requests.set(action.requestId,action);void Promise.resolve().then(()=>destruction().action(input)).then(result=>{res.writeHead(result.ok?200:409);res.end(JSON.stringify(predictionReply(result,action?.prediction)));}).catch(error=>{console.error(error);res.writeHead(500);res.end(JSON.stringify({ok:false,code:'internal',error:'Destruction service failed'}));}).finally(()=>{if(action&&requests.get(action.requestId)===action)requests.delete(action.requestId);});});return;}
    if(path==='/api/builds'&&req.method==='POST') {
      let size=0,body='';let rejected=false;
      req.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>8192){if(!rejected){rejected=true;res.writeHead(413);res.end(JSON.stringify({ok:false,code:'request',error:'Placement request is too large'}));}return;}body+=chunk.toString('utf8');});
      req.on('end',async()=>{if(rejected)return;try{const damage=destruction();const result=await damage.place(JSON.parse(body));res.writeHead(result.ok?201:409);res.end(JSON.stringify(result));}catch(error){res.writeHead(400);res.end(JSON.stringify({ok:false,code:'request',error:error instanceof SyntaxError?'Invalid JSON':'The building service could not load its world'}));}});
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405, { Allow: path==='/api/builds'?'GET, POST':'GET' }); res.end(JSON.stringify({ error: 'Method not allowed.' })); return; }
    if (path === '/api/world') { res.end(JSON.stringify(world)); return; }
    if (path === '/api/health') { res.end(JSON.stringify({ status: 'ok', generatorVersion: GENERATOR_VERSION })); return; }
    if(path==='/api/performance'){res.end(JSON.stringify({edits:edits?.performanceReport()??null,physicsRegions:falling?.regions.size??0}));return;}
    if(path==='/api/builds') {
      const cells=(url.searchParams.get('cells')??'').split(',').filter(Boolean),since=url.searchParams.get('since');
      if(cells.length>64||cells.some(c=>!/^[-]?\d{1,7}:[-]?\d{1,7}$/.test(c))||since!==null&&!/^\d{1,12}$/.test(since)){res.writeHead(400);res.end(JSON.stringify({error:'Invalid build region query'}));return;}
      try{const damage=destruction(),snapshot=store().snapshot([...new Set(cells)],since===null?undefined:Number(since));res.end(JSON.stringify({...snapshot,edits:snapshot.unchanged?undefined:damage.snapshot(cells)}));}catch(error){console.error(error);res.writeHead(500);res.end(JSON.stringify({error:'The building service could not load its world'}));}return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'Not found.' }));
  });
  const sockets=new WebSocketServer({noServer:true,maxPayload:32768});
  server.on('upgrade',(req,socket,head)=>{if(new URL(req.url??'/', 'http://localhost').pathname!=='/api/events'){socket.destroy();return;}sockets.handleUpgrade(req,socket,head,peer=>sockets.emit('connection',peer));});
  sockets.on('connection',peer=>{peers.set(peer,new Set());peer.on('message',data=>{try{const m=JSON.parse(data.toString());if(m.type==='pose'){if(typeof m.sessionId==='string'&&m.sessionId.length<=100)sessions.set(peer,m.sessionId);destruction().updateActor(m.sessionId,m.feet);return;}if(m.type==='subscribe'&&Array.isArray(m.cells)&&m.cells.length<=512&&m.cells.every((c:any)=>typeof c==='string'&&/^-?\d+:-?\d+$/.test(c))){peers.set(peer,new Set(m.cells));const damage=destruction();peer.send(JSON.stringify({type:'snapshot',worldKey:store().worldKey,patch:damage.snapshot(m.cells)}));}}catch{peer.close(1008,'Invalid subscription');}});peer.on('close',()=>{peers.delete(peer);sessions.delete(peer);});});
  const close=server.close.bind(server);server.close=((callback?:Parameters<typeof server.close>[0])=>{for(const peer of peers.keys())peer.terminate();return close(callback);})as typeof server.close;
  server.on('close',()=>{sockets.close();falling?.dispose();edits?.dispose();});
  return server;
}

