import {createHash} from 'node:crypto';
import type {WorldConfig} from '../shared/config';
import {GENERATOR_VERSION} from '../shared/config';
import {BuildScene} from '../shared/build-scene';
import {WorldGenerator} from '../shared/world';
import {buildCell,type BuildObject,type BuildResult} from '../shared/object-registry';
import {validBuildRequest,solvePlacement} from '../shared/build-placement';
import {validDoorRequest,doorChange} from '../shared/door-interaction';
import type {WorldPatch} from '../shared/destruction';
/** In-memory placement rules. Durability belongs to the unified WorldJournal. */
export class BuildStore {
 readonly worldKey:string;readonly scene:BuildScene;revision=0;
 private receipts=new Map<string,{fingerprint:string;result:BuildResult}>();
 constructor(config:WorldConfig){this.worldKey=createHash('sha256').update(JSON.stringify([config.seed,config.islandSizeMeters,GENERATOR_VERSION])).digest('hex').slice(0,24);this.scene=new BuildScene(new WorldGenerator(config));}
 prepare(value:unknown):{result:BuildResult;fingerprint?:string;fresh?:boolean}{
   if(!validBuildRequest(value)&&!validDoorRequest(value))return {result:{ok:false,code:'request',error:'Invalid building command'}};
   if(value.worldKey!==this.worldKey)return {result:{ok:false,code:'world',error:'The server world changed; refresh the game'}};
   const fingerprint=createHash('sha256').update(JSON.stringify(value)).digest('hex'),old=this.receipts.get(value.requestId);
   if(old)return {result:old.fingerprint===fingerprint?old.result:{ok:false,code:'request-id',error:'Request ID was reused'}};
   if(validDoorRequest(value)){const result=doorChange(this.scene,value);return {result:result.ok?{...result,revision:this.revision+1}:result,fingerprint,fresh:result.ok};}
   const placement=solvePlacement(this.scene,value);return {result:placement.valid?{ok:true,object:placement.object,revision:this.revision+1}:{ok:false,code:placement.code,error:placement.reason},fingerprint,fresh:placement.valid};
 }
 accept(object:BuildObject){this.scene.add(object);if(object.definitionId.startsWith('floor-'))this.scene.keepLeveling(object);if(object.support.kind==='wall'&&['door-wood','door-reinforced','window'].includes(object.definitionId))this.scene.setOpening(object.support.id,object.definitionId==='window'?'window':'door');this.revision++;}
 remember(id:string,fingerprint:string,result:BuildResult){this.receipts.set(id,{fingerprint,result});while(this.receipts.size>2048)this.receipts.delete(this.receipts.keys().next().value!);}
 place(value:unknown):BuildResult{const prepared=this.prepare(value);if(prepared.fresh&&prepared.result.ok){this.accept(prepared.result.object);this.remember((value as any).requestId,prepared.fingerprint!,prepared.result);}return prepared.result;}
 snapshot(keys:string[],since?:number){return {worldKey:this.worldKey,revision:this.revision,unchanged:since===this.revision,cells:since===this.revision?[]:keys.map(key=>{const [x,z]=key.split(':').map(Number);return {key,objects:this.scene.placed.query((x+.5)*512,(z+.5)*512,Math.SQRT2*256).filter(s=>buildCell(s.prop.x,s.prop.z)===key).map(s=>s.object!)};})};}
 applyWorldPatch(patch:WorldPatch){for(const id of patch.removedBuilds)this.scene.remove(id,true);for(const floor of patch.leveling)this.scene.keepLeveling(floor);for(const o of patch.openings)this.scene.setOpening(o.id,o.kind);for(const solid of patch.solids)this.scene.applyRecord(solid);this.revision++;}
}
