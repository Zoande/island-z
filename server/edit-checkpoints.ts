import {readFileSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,mkdirSync,readdirSync,unlinkSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import type {SolidRecord} from '../shared/destruction';
import {buildCell} from '../shared/object-registry';
export interface ArchivedSolid {id:string;file:string;cells:string[];active:boolean;removedBuild?:boolean}
/** Immutable region checkpoint files. The small head file switches generations
 * atomically; an interrupted checkpoint leaves the previous generation valid. */
export class EditCheckpoints {
  readonly entries=new Map<string,ArchivedSolid>();private cells=new Map<string,Set<string>>();
  constructor(readonly directory:string,readonly worldKey:string){}
  register(entry:ArchivedSolid){if(!entry||typeof entry.file!=='string'||!new RegExp('^'+this.worldKey+'\\.\\d+\\.-?\\d+_-?\\d+\\.region\\.json$').test(entry.file)||!Array.isArray(entry.cells)||entry.cells.some(c=>!/^[-]?\d+:[-]?\d+$/.test(c)))throw new Error('Invalid archived region');this.forget(entry.id);this.entries.set(entry.id,entry);for(const key of entry.cells){const ids=this.cells.get(key)??new Set();ids.add(entry.id);this.cells.set(key,ids);}}
  forget(id:string){const old=this.entries.get(id);if(old)for(const cell of old.cells){const ids=this.cells.get(cell);ids?.delete(id);if(!ids?.size)this.cells.delete(cell);}this.entries.delete(id);}
  load(ids:Iterable<string>):SolidRecord[]{const files=new Map<string,Set<string>>();for(const id of ids){const entry=this.entries.get(id);if(!entry)continue;const wanted=files.get(entry.file)??new Set();wanted.add(id);files.set(entry.file,wanted);}const records:SolidRecord[]=[];for(const [file,wanted]of files){const data=JSON.parse(readFileSync(join(this.directory,file),'utf8'));if(data.schema!==1||data.worldKey!==this.worldKey)throw new Error('Invalid region checkpoint');for(const record of data.solids)if(wanted.has(record.id))records.push(record);}return records;}
  clean(){const keep=new Set([...this.entries.values()].map(e=>e.file)),base=resolve(this.directory);for(const file of readdirSync(base))if(file.startsWith(this.worldKey+'.')&&file.endsWith('.region.json')&&!keep.has(file)){const path=resolve(base,file);if(!path.startsWith(base+sep))throw new Error('Checkpoint path outside save directory');unlinkSync(path);}}
  ids(keys:Iterable<string>){const ids=new Set<string>();for(const cell of keys)for(const id of this.cells.get(cell)??[])ids.add(id);return ids;}
  write(revision:number,resident:Iterable<SolidRecord>):ArchivedSolid[]{
    mkdirSync(this.directory,{recursive:true});const residentGroups=new Map<string,Map<string,SolidRecord>>(),oldFiles=new Map<string,Set<string>>();
    for(const e of this.entries.values()){const cell=e.cells[0],files=oldFiles.get(cell)??new Set();files.add(e.file);oldFiles.set(cell,files);}
    for(const r of resident){const cell=buildCell(r.prop.x,r.prop.z),group=residentGroups.get(cell)??new Map();group.set(r.id,r);residentGroups.set(cell,group);}
    const entries:ArchivedSolid[]=[];for(const cell of new Set([...oldFiles.keys(),...residentGroups.keys()])){const group=new Map<string,SolidRecord>();for(const oldFile of oldFiles.get(cell)??[]){const data=JSON.parse(readFileSync(join(this.directory,oldFile),'utf8'));for(const r of data.solids as SolidRecord[])if(this.entries.get(r.id)?.file===oldFile)group.set(r.id,r);}for(const [id,r]of residentGroups.get(cell)??[])group.set(id,r);
      const file=`${this.worldKey}.${revision}.${cell.replace(':','_')}.region.json`,path=join(this.directory,file),temp=path+'.tmp',solids=[...group.values()];const fd=openSync(temp,'w');try{writeFileSync(fd,JSON.stringify({schema:1,worldKey:this.worldKey,revision,solids}));fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,path);for(const r of solids){const p=r.pose?.position??[r.prop.x,r.prop.y,r.prop.z];entries.push({id:r.id,file,cells:[...new Set([cell,buildCell(p[0],p[2])])],active:!!r.fall&&!r.fall.settled&&!r.removed,removedBuild:r.removed&&!!r.object||undefined});}}
    return entries;
  }
}
