/** Cells index object bounds, not just their centers. Queries deduplicate spanning objects. */
export class SpatialIndex<T> {
  private cells=new Map<string,Set<string>>();private entries=new Map<string,{value:T;keys:string[]}>();
  constructor(readonly cellSize=32){}
  get size(){return this.entries.size;}
  get(id:string){return this.entries.get(id)?.value;}
  values():T[]{return [...this.entries.values()].map(e=>e.value);}
  insert(id:string,value:T,x:number,z:number,radius:number) {
    this.remove(id);const keys:string[]=[];
    for(let cz=Math.floor((z-radius)/this.cellSize);cz<=Math.floor((z+radius)/this.cellSize);cz++)for(let cx=Math.floor((x-radius)/this.cellSize);cx<=Math.floor((x+radius)/this.cellSize);cx++) {
      const key=`${cx}:${cz}`;let cell=this.cells.get(key);if(!cell){cell=new Set();this.cells.set(key,cell);}cell.add(id);keys.push(key);
    }
    this.entries.set(id,{value,keys});
  }
  remove(id:string) {const entry=this.entries.get(id);if(!entry)return;for(const key of entry.keys){const cell=this.cells.get(key)!;cell.delete(id);if(!cell.size)this.cells.delete(key);}this.entries.delete(id);}
  query(x:number,z:number,radius:number):T[] {
    const ids=new Set<string>();
    for(let cz=Math.floor((z-radius)/this.cellSize);cz<=Math.floor((z+radius)/this.cellSize);cz++)for(let cx=Math.floor((x-radius)/this.cellSize);cx<=Math.floor((x+radius)/this.cellSize);cx++)for(const id of this.cells.get(`${cx}:${cz}`)??[])ids.add(id);
    return [...ids].map(id=>this.entries.get(id)!.value);
  }
  clear(){this.cells.clear();this.entries.clear();}
}
