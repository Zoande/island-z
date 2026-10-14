import {afterEach,describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {BuildScene} from '../shared/build-scene';
import {BuildStore} from '../server/build-store';
import {DestructionStore} from '../server/destruction-store';
import {WorldJournal} from '../server/journal';
import {CHARACTER} from '../shared/character';
import {recordFor,type WorldPatch} from '../shared/destruction';
import {SparseVolume} from '../shared/volume';
import {FLOOR_MAX_GRADE_DEPTH,floorPlaneHeight} from '../shared/build-terrain';
import {objectDefinition,type BuildObject} from '../shared/object-registry';
import type {WorldGenerator} from '../shared/world';

const config={seed:'floor-grading-regression',islandSizeMeters:1024};
const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0)){if(!resolve(directory).startsWith(resolve(tmpdir())))throw new Error('Unexpected test directory');rmSync(directory,{recursive:true,force:true});}});
function scene(height=(x:number,z:number)=>0){return new BuildScene({config:{seed:config.seed,islandSizeMeters:config.islandSizeMeters},height,sample:(x:number,z:number)=>({height:height(x,z),normal:[0,1,0],weights:[0,1,0,0,0,0,0,0]}),props:()=>[],surfaceWater:()=>null}as unknown as WorldGenerator);}
function floor(id:string,position:[number,number,number]=[0,0,0],normal:[number,number,number]=[0,1,0],rotation=0):BuildObject{return {id,definitionId:'floor-wood',variant:0,position,normal,rotation,support:{kind:'terrain'}};}
function floorAction(builds:BuildStore,id:string){const requestId='break-floor-000001';const eye:[number,number,number]=[0,1.5,0],feet:[number,number,number]=[0,eye[1]-CHARACTER.eyeHeight,0];return {action:'dismantle' as const,requestId,worldKey:builds.worldKey,sessionId:'floor-test-session',targetId:id,targetRevision:builds.scene.edits.get(id)?.revision??0,eye,feet,direction:[0,-1,0]as [number,number,number]};}

describe('temporary floor grading',()=>{
  it('grades to the tilted slab plane inside its projected footprint, with a bounded cut and no raising',()=>{
    const s=scene(),normal:[number,number,number]=[-.4,Math.sqrt(.84),0],f=floor('tilted-grade',[0,0,0],normal);s.add(f);
    const plane=floorPlaneHeight(f.position,f.normal,1,0);expect(plane).toBeGreaterThan(.4);
    expect(s.grade(1,0,1)).toBeCloseTo(plane-.015,6);
    expect(1-s.grade(1,0,1)).toBeLessThanOrEqual(FLOOR_MAX_GRADE_DEPTH);
    expect(s.grade(2.2,0,.8)).toBe(.8); // outside the projected tilted footprint
    expect(s.grade(1,0,-.5)).toBe(-.5); // grading never raises terrain
    expect(s.grade(1,0,plane+FLOOR_MAX_GRADE_DEPTH+.01)).toBe(plane+FLOOR_MAX_GRADE_DEPTH+.01);
  });

  it('keeps an overlapping floor grade when the other floor is removed',()=>{
    const s=scene(),a=floor('overlap-a',[0,0,0]),b=floor('overlap-b',[1,-.3,0]);s.add(a);s.keepLeveling(a);s.add(b);s.keepLeveling(b);
    expect(s.grade(1,0,.9)).toBeCloseTo(-.315);s.remove(a.id,true);expect(s.grade(1,0,.9)).toBeCloseTo(-.315);expect(s.leveling.has(a.id)).toBe(false);expect(s.leveling.has(b.id)).toBe(true);
  });

  it('keeps mined terrain sourced from raw terrain and preserves its voxel edit when a floor is removed',()=>{
    const s=scene(()=>.7),f=floor('mined-under-floor',[0,0,0]);s.add(f);const record=s.terrainRecord([0,0,0]);
    const field=record.source.primitives[0];expect(field.type).toBe('heightfield');if(field.type!=='heightfield')return;
    expect(field.heights.every(h=>h===.7)).toBe(true);const volume=new SparseVolume(record.source);expect(volume.edit({center:[.5,.5,.5],axis:[0,0,1],radius:0,depth:0,seed:4,box:[.2,.2,.2]})).toBe(true);
    s.applyRecord({...record,volume:volume.state,revision:1});s.remove(f.id);expect(s.edits.get(record.id)?.volume).toBe(volume.state);expect(s.terrainRecord([0,0,0]).volume).toBe(volume.state);expect(s.grade(.5,.5,0)).toBe(0);
  });

  it('breaks a whole floor, removes its grade immediately, and keeps the tombstone through journal checkpoint reload',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'island-z-floor-grade-'));directories.push(directory);const builds=new BuildStore(config),journal=new WorldJournal(directory,builds.worldKey),object=floor('persisted-floor-000001',[0,-.4,0]);
    builds.scene.world.height=()=>0;builds.scene.world.sample=(x,z)=>({height:0,normal:[0,1,0],forest:0,weights:[0,1,0,0,0,0,0,0]});builds.scene.naturalAt=()=>[];builds.accept(object);
    const edits=new DestructionStore(builds,journal,false);let journalOpen=true;
    try{
      await journal.loadWorld();await journal.append({kind:'build',object});
      expect(objectDefinition(object.definitionId).destruction?.mode).toBe('whole');expect(builds.scene.grade(0,0,0)).toBeCloseTo(-.415);
      const action=floorAction(builds,object.id);expect(builds.scene.raycast(action.eye,action.direction,4,false,true)?.solid?.id).toBe(object.id);
      const result=await edits.action(action);expect(result).toMatchObject({ok:true});if(!result.ok)return;
      expect(result.patch.removedLeveling).toEqual([object.id]);expect(builds.scene.grade(0,0,0)).toBe(0);expect(builds.scene.leveling.has(object.id)).toBe(false);
      await journal.checkpoint([]);await journal.close();journalOpen=false;
      const restarted=new WorldJournal(directory,builds.worldKey);try{
        const commits=await restarted.loadWorld();expect(commits.flatMap(c=>c.patch?.leveling??[]).some(o=>o.id===object.id)).toBe(false);
        expect(commits.some(c=>c.object?.id===object.id)).toBe(false);
        const restored=new BuildStore(config),restoredEdits=new DestructionStore(restored,undefined,false);try{for(const commit of commits)restoredEdits.restore(commit);expect(restored.scene.grade(0,0,0)).toBe(0);expect(restored.scene.leveling.has(object.id)).toBe(false);}finally{restoredEdits.dispose();}
      }finally{await restarted.close();}
    }finally{edits.dispose();if(journalOpen)await journal.close();}
  },30000);

  it('adds a leveling tombstone when support analysis removes a floor',async()=>{
    const builds=new BuildStore(config),edits=new DestructionStore(builds,undefined,false);builds.scene.terrain=()=>({height:0,normal:[0,1,0]});builds.scene.naturalAt=()=>[];
    const elevated=floor('unsupported-floor-00001',[0,5,0]);builds.accept(elevated);const wall:BuildObject={id:'support-trigger-wall',definitionId:'wall-wood',variant:0,position:[8,-.1,0],normal:[0,1,0],rotation:0,support:{kind:'terrain'}};builds.accept(wall);
    try{const ws=builds.scene.placed.get(wall.id)!,record=recordFor(wall.id,ws.prop,builds.scene.rocks,wall);record.removed=true;record.revision=1;const patch:WorldPatch={revision:1,solids:[record],removedBuilds:[wall.id],leveling:[],openings:[]};
      await (edits as any).support(patch,{action:'dismantle',requestId:'support-floor-removal',worldKey:builds.worldKey,sessionId:'support-test',targetId:wall.id,targetRevision:0,eye:[8,1,2],feet:[8,-.868,2],direction:[0,0,-1]});
      expect(patch.removedLeveling).toContain(elevated.id);expect(patch.solids.find((r:any)=>r.id===elevated.id)?.removed).toBe(true);
    }finally{edits.dispose();}
  },30000);
});
