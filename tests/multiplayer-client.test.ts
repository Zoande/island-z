import {afterEach,describe,expect,it,vi} from 'vitest';
import {Character} from '../shared/character';
import {emptyInventory} from '../shared/inventory';
vi.mock('../client/api',()=>({apiBase:'http://localhost',socketURL:()=> 'ws://localhost/api/events'}));
import {MultiplayerClient} from '../client/multiplayer';
class WorkerFixture {
 static instance:WorkerFixture;
 onmessage?: (event:{data:unknown})=>void;
 constructor(){WorkerFixture.instance=this;}
 postMessage(){}
 terminate(){}
 send(data:unknown){this.onmessage?.({data});}
}
afterEach(()=>vi.unstubAllGlobals());
describe('main-thread multiplayer snapshots',()=>{
 it('applies new injuries and respawns once while maintaining equipment between worker frames',async()=>{
  vi.stubGlobal('Worker',WorkerFixture);
  vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({id:'snapshot-client-0001',nickname:'Player'}),setItem:()=>{}});
  const environment={surface:()=>({height:0,normal:[0,1,0]as [number,number,number]}),colliders:()=>[]};
  const character=new Character(environment);character.spawn(0,0,0);
  const restore=vi.spyOn(character,'restore'),camera={character,keys:new Set(['KeyW']),yaw:1,pitch:0,adoptStance:vi.fn(),update:vi.fn(),onInput:undefined as undefined|((input:unknown)=>void)},renderer={remotePlayers:[]};
  const client=new MultiplayerClient({seed:'snapshots',islandSizeMeters:1024},camera as any,renderer as any);
  try{
   const inventory=emptyInventory();inventory.offhand={item:'crutches',count:1};
   WorkerFixture.instance.send({type:'welcome',message:{state:character.capture(),inventory}});await client.ready;
   for(let i=0;i<60;i++)client.update();expect(restore).toHaveBeenCalledTimes(1);
   const server=new Character(environment);server.spawn(2,0,3);server.damage('head',80,'moderate');
   WorkerFixture.instance.send({type:'state',state:server.capture(),time:1,connected:true});
   for(let i=0;i<60;i++)client.update();expect(restore).toHaveBeenCalledTimes(2);expect(character.health.head.hp).toBe(20);expect(character.feet).toEqual(server.feet);
   expect(character.effects.canUseCrutches).toBe(false);
   server.spawn(4,0,5);const state=server.capture();state.respawns++;
   WorkerFixture.instance.send({type:'state',state,time:2,connected:true});
   for(let i=0;i<60;i++)client.update();expect(restore).toHaveBeenCalledTimes(3);expect(camera.keys.size).toBe(0);expect(camera.yaw).toBe(0);expect(camera.adoptStance).toHaveBeenLastCalledWith('stand');
  }finally{client.dispose();}
 });
});
