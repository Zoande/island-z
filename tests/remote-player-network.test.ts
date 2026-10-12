import {describe,expect,it,vi} from 'vitest';
import {capsuleGeometry} from '../client/player-geometry';
import {closeForReconnect,RECONNECT_CLOSE_CODE} from '../client/socket-close';
import {RemotePlayerTimeline} from '../client/remote-player-timeline';

describe('remote multiplayer client',()=>{
  it('uses a material registered by the renderer for remote player capsules',()=>{
    const capsule=capsuleGeometry();
    expect(capsule.material).toBe('rock');
    expect(capsule.indices.length).toBeGreaterThan(0);
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
  it('clears remote avatars as soon as transport disconnects or welcomes a fresh session',async()=>{
    vi.stubGlobal('location',{origin:'http://localhost'});
    const {MultiplayerClient}=await import('../client/multiplayer');
    const client=Object.create(MultiplayerClient.prototype) as any;
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
});
