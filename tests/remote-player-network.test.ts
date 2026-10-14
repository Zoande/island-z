import {describe,expect,it,vi} from 'vitest';
import {capsuleGeometry,crouchGeometry,crawlGeometry} from '../client/player-geometry';
import {closeForReconnect,RECONNECT_CLOSE_CODE} from '../client/socket-close';
import {RemotePlayerTimeline} from '../client/remote-player-timeline';

describe('remote multiplayer client',()=>{
  it('uses a material registered by the renderer for remote player capsules',()=>{
    const capsule=capsuleGeometry();
    expect(capsule.material).toBe('rock');
    expect(capsule.indices.length).toBeGreaterThan(0);
  });
  it('builds finite reduced-height capsule placeholders for crouching and crawling',()=>{
    const maximumY=(geometry:ReturnType<typeof capsuleGeometry>)=>{let max=-Infinity;for(let i=1;i<geometry.vertices.length;i+=16)max=Math.max(max,geometry.vertices[i]);return max;};
    for(const geometry of [capsuleGeometry(),crouchGeometry(),crawlGeometry()])expect([...geometry.vertices].every(Number.isFinite)).toBe(true);
    expect(maximumY(capsuleGeometry())).toBeCloseTo(2.16,4);
    expect(maximumY(crouchGeometry())).toBeCloseTo(1.5,4);
    expect(maximumY(crawlGeometry())).toBeCloseTo(1.05,4);
  });
  it('uses a browser-valid private WebSocket close code for resynchronization',()=>{
    expect(RECONNECT_CLOSE_CODE).toBeGreaterThanOrEqual(3000);
    expect(RECONNECT_CLOSE_CODE).toBeLessThanOrEqual(4999);
    const close=vi.fn();
    for(const reason of ['Send queue full','Region replay queue exceeded','Prediction queue exceeded']){
      closeForReconnect({close},reason);
      expect(close).toHaveBeenLastCalledWith(RECONNECT_CLOSE_CODE,reason);
    }
    expect(close).toHaveBeenCalledTimes(3);
  });
  it('does not fail when a socket has not been created',()=>{
    expect(()=>closeForReconnect(undefined,'Prediction queue exceeded')).not.toThrow();
  });
  it('interpolates server timestamps and adapts a bounded buffer to arrival jitter',()=>{
    const timeline=new RemotePlayerTimeline(),at=(x:number)=>[{id:'peer',nickname:'Peer',feet:[x,0,0] as [number,number,number]}];
    timeline.push(0,1000,at(0));timeline.push(50,1050,at(5));
    expect(timeline.delayMs).toBe(100);expect(timeline.sample(1100)[0].feet[0]).toBe(0);expect(timeline.sample(1150)[0].feet[0]).toBe(5);
    timeline.push(100,1120,at(10));expect(timeline.delayMs).toBeCloseTo(108);expect(timeline.sample(1228)[0].feet[0]).toBe(10);
    timeline.push(150,1300,at(15));expect(timeline.delayMs).toBeGreaterThan(108);expect(timeline.delayMs).toBeLessThanOrEqual(250);expect(timeline.sample(1300)[0].feet[0]).toBeGreaterThanOrEqual(10);
    timeline.push(125,1400,at(12));expect(timeline.delayMs).toBeLessThanOrEqual(250);
    timeline.push(200,1350,[{id:'peer',nickname:'Peer',feet:[100,0,0],respawns:1}]);expect(timeline.sample(2350)[0].feet[0]).toBe(100);
    timeline.reset();expect(timeline.sample(2000)).toEqual([]);expect(timeline.delayMs).toBe(100);
  });
  it('keeps the newest remote posture attached while interpolating position',()=>{
    const timeline=new RemotePlayerTimeline();
    timeline.push(0,1000,[{id:'peer',nickname:'Peer',feet:[0,0,0],posture:'stand'}]);
    timeline.push(50,1050,[{id:'peer',nickname:'Peer',feet:[5,0,0],posture:'crawl'}]);
    const sample=timeline.sample(1100)[0];
    expect(sample.feet[0]).toBe(0);
    expect(sample.posture).toBe('crawl');
  });
  it('maps remote snapshot stance intent and forced crawling into render posture',async()=>{
    vi.stubGlobal('location',{origin:'http://localhost'});
    const {MultiplayerClient}=await import('../client/multiplayer');
    const client=Object.create(MultiplayerClient.prototype) as any;
    client.identity='self';client.snapshotTimes=[];client.metrics={};client.remoteTimeline=new RemotePlayerTimeline();
    client.receive({type:'players',correction:0,pending:0,receivedAt:1000,message:{time:1,players:[
      {id:'crouching',nickname:'Crouching',state:{feet:[0,0,0],stanceIntent:'crouch'}},
      {id:'crawling',nickname:'Crawling',state:{feet:[1,0,0],stanceIntent:'stand',crawling:true}},
      {id:'low-roof',nickname:'Low roof',state:{feet:[2,0,0],stanceIntent:'stand',posture:'crouch'}},
    ]}});
    const poses=client.remoteTimeline.sample(1100);
    expect(poses.map((pose:any)=>pose.posture)).toEqual(['crouch','crawl','crouch']);
  });
  it('clears remote avatars as soon as transport disconnects or welcomes a fresh session',async()=>{
    vi.stubGlobal('location',{origin:'http://localhost'});
    const {MultiplayerClient}=await import('../client/multiplayer');
    const {InventoryPrediction}=await import('../client/inventory-state');
    const client=Object.create(MultiplayerClient.prototype) as any;
    client.inventoryPrediction=new InventoryPrediction();
    client.renderer={remotePlayers:[{id:'departed',nickname:'Old',feet:[1,0,1]}]};
    client.remoteTimeline=new RemotePlayerTimeline();client.remoteTimeline.push(0,1000,[{id:'departed',nickname:'Old',feet:[1,0,1]}]);client.connected=true;
    client.requests=new Map();client.state=undefined;client.welcomeResolve=()=>{};client.welcomeReject=()=>{};
    client.receive({type:'status',connected:false});
    expect(client.connected).toBe(false);expect(client.renderer.remotePlayers).toEqual([]);expect(client.remoteTimeline.sample(1000)).toEqual([]);
    client.renderer.remotePlayers=[{id:'stale',nickname:'Old',feet:[1,0,1]}];client.remoteTimeline.push(0,1000,[{id:'stale',nickname:'Old',feet:[1,0,1]}]);
    client.camera={character:{restore:vi.fn()},update:vi.fn()};
    client.receive({type:'welcome',message:{state:{},time:0}});
    expect(client.renderer.remotePlayers).toEqual([]);expect(client.remoteTimeline.sample(1000)).toEqual([]);expect(client.connected).toBe(true);
  });
  it('carries a late remote snapshot forward for at most 100 ms without drifting vertically on ground',()=>{
    const timeline=new RemotePlayerTimeline();
    const at=(x:number)=>[{id:'peer',nickname:'Peer',feet:[x,2,0] as [number,number,number],velocity:[5,-3,0] as [number,number,number],grounded:true,respawns:0}];
    timeline.push(0,1000,at(0));timeline.push(50,1050,at(.25));
    expect(timeline.sample(1150)[0].feet).toEqual([.25,2,0]);
    expect(timeline.sample(1200)[0].feet).toEqual([.5,2,0]);
    expect(timeline.sample(1250)[0].feet).toEqual([.75,2,0]);
    expect(timeline.sample(10000)[0].feet).toEqual([.75,2,0]);
    timeline.push(100,10000,[{...at(100)[0],respawns:1}]);
    expect(timeline.sample(10100)[0].feet).toEqual([100,2,0]);
  });
});
