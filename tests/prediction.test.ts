import {it,expect} from 'vitest';
import {predictionDigest,predictionReply,recordFor,actionBrush,brushSeed,volumeRay,type WorldAction,type ActionResult} from '../shared/destruction';
import {SparseVolume} from '../shared/volume';
import {BuildStore} from '../server/build-store';
import {solvePlacement} from '../shared/build-placement';
import {createWorldServer} from '../server/app';
import {buildProp,type BuildRequest} from '../shared/object-registry';
import {WebSocket} from 'ws';
import type {AddressInfo} from 'node:net';

it('uses canonical prediction hints and returns corrections for differences and side effects',()=>{
  const r=recordFor('wall',{kind:'wall-wood',variant:0,x:0,y:0,z:0,scale:1,rotation:0},[]);
  r.volume.bricks={'1:0:0':[1,2],'0:0:0':[3,4]};const reordered={...r,volume:{...r.volume,bricks:{'0:0:0':[3,4],'1:0:0':[1,2]}}};
  expect(predictionDigest(r)).toBe(predictionDigest(reordered));
  const result:ActionResult={ok:true,requestId:'action-one',patch:{revision:5,solids:[r],removedBuilds:[],leveling:[],openings:[]}};
  expect(predictionReply(result,predictionDigest(r))).toHaveProperty('ack.targetId','wall');
  expect(predictionReply(result,predictionDigest({...r,revision:1}))).toBe(result);
  result.patch.openings.push({id:'wall',kind:null});expect(predictionReply(result,predictionDigest(r))).toBe(result);
});

it('confirms predicted cuts to the origin, broadcasts geometry to other editors, and deduplicates compact replies',async()=>{
  const config={seed:'prediction-network',islandSizeMeters:1024},probe=new BuildStore(config),server=createWorldServer(config),sockets:WebSocket[]=[];
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;
  try{
    let request:BuildRequest|undefined;for(let z=40;z<200&&!request;z+=9)for(let x=-100;x<100;x+=9){const y=probe.scene.terrain(x,z+3).height,eye:[number,number,number]=[x,y+1.968,z+3],dy=probe.scene.terrain(x,z).height-eye[1],l=Math.hypot(dy,3),r:BuildRequest={requestId:'prediction-wall-001',worldKey:probe.worldKey,definitionId:'wall-wood',variant:0,rotation:0,eye,feet:[x,y,z+3],direction:[0,dy/l,-3/l],standing:true};if(solvePlacement(probe.scene,r).valid){request=r;break;}}
    expect(request).toBeDefined();const placed=await(await fetch(url+'/api/builds',{method:'POST',body:JSON.stringify(request)})).json();expect(placed.ok).toBe(true);
    const p=placed.object.position,r=recordFor(placed.object.id,buildProp(placed.object),probe.scene.rocks,placed.object);
    const a:WorldAction={action:'cut',requestId:'predicted-cut-001',sessionId:'prediction-editor',worldKey:probe.worldKey,targetId:r.id,targetRevision:0,eye:[p[0],p[1]+1.2,p[2]+2],feet:[p[0],p[1]+1.2-1.968,p[2]+2],direction:[0,0,-1]};
    const hit=volumeRay(r,a.eye,a.direction,4)!;const v=new SparseVolume(r.source,r.volume);v.edit(actionBrush(r,hit.point,a.direction,false,brushSeed(a.requestId)));a.prediction=predictionDigest({...r,volume:v.state,revision:1});
    const events:any[][]=[[],[]];for(let i=0;i<2;i++){const s=new WebSocket(url.replace('http:','ws:')+'/api/events');sockets.push(s);await new Promise<void>((resolve,reject)=>{s.once('open',resolve);s.once('error',reject);});s.on('message',m=>events[i].push(JSON.parse(String(m))));s.send(JSON.stringify({type:'pose',sessionId:i?'other-editor':a.sessionId,feet:a.feet}));s.send(JSON.stringify({type:'subscribe',cells:[`${Math.floor(p[0]/512)}:${Math.floor(p[2]/512)}`]}));}
    await new Promise<void>(resolve=>{const poll=()=>events.every(e=>e.some(m=>m.type==='snapshot'))?resolve():setTimeout(poll,5);poll();});
    const post=async(body:WorldAction)=>(await fetch(url+'/api/actions',{method:'POST',body:JSON.stringify(body)})).json(),reply=await post(a);
    expect(reply).toHaveProperty('ack.targetRevision',1);expect(reply).not.toHaveProperty('patch');expect(await post(a)).toEqual(reply);
    expect(events[0].some(m=>m.type==='ack'&&m.result.requestId===a.requestId)).toBe(true);expect(events[1].some(m=>m.type==='patch'&&m.patch.actionId===a.requestId)).toBe(true);
    expect(await post({...a,prediction:'0000000000000000'})).toMatchObject({ok:false,code:'request-id'});
  }finally{for(const s of sockets)s.terminate();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
},30000);
