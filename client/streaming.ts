import type { WorldConfig } from '../shared/config';
import { BASE_CHUNK, type ChunkData, type ChunkRequest } from '../shared/mesh';
export interface TileNode { request: ChunkRequest; children: TileNode[] }
export function selectTiles(x: number, z: number, size: number, distance: number): TileNode[] {
  const roots: TileNode[] = [], level = 7, extent = BASE_CHUNK * 2 ** level;
  const build = (tx: number, tz: number, l: number): TileNode | null => {
    const e = BASE_CHUNK * 2 ** l;
    // The island has finite bounds, but the surrounding seabed streams too.
    // Working memory stays bounded by the camera's view radius offshore.
    const nearest = Math.hypot(Math.max(tx - x, 0, x - tx - e), Math.max(tz - z, 0, z - tz - e));
    if (nearest > distance) return null;
    const key = `${tx}:${tz}:${l}`;
    const node: TileNode = { request: { key, x: tx, z: tz, level: l }, children: [] };
    // Keep ownership tiles sufficiently fine for the longest forest range.
    if (l > 0 && nearest < Math.max(e * 1.35,l>4?Math.min(distance,3600):0)) {
      const half = e / 2;
      for (const [dx, dz] of [[0, 0], [half, 0], [0, half], [half, half]]) {
        const child = build(tx + dx, tz + dz, l - 1); if (child) node.children.push(child);
      }
    }
    return node;
  };
  for (let tz = Math.floor((z - distance) / extent) * extent; tz <= z + distance; tz += extent)
    for (let tx = Math.floor((x - distance) / extent) * extent; tx <= x + distance; tx += extent) {
      const node = build(tx, tz, level); if (node) roots.push(node);
    }
  return roots;
}
interface WorkerSlot { worker: Worker; busy: string | null }
export function playerPriority(roots:TileNode[],x:number,z:number):Set<string> {
  const priority=new Set<string>();
  const visit=(node:TileNode)=>{
    const r=node.request,e=BASE_CHUNK*2**r.level;
    if(Math.hypot(Math.max(r.x-x,0,x-r.x-e),Math.max(r.z-z,0,z-r.z-e))>80)return;
    priority.add(r.key);
    // Include sibling fallback tiles so the player's children can display
    // without holes before the rest of the background has finished loading.
    for(const child of node.children)priority.add(child.request.key);
    node.children.forEach(visit);
  };
  roots.forEach(visit);return priority;
}
export function resolveDrawKeys(roots:TileNode[],available:Set<string>):string[] {
  const resolve=(node:TileNode):string[]|null=>{
    if(node.children.length) {
      const children=node.children.map(resolve);
      if(children.every(c=>c!==null))return children.flat()as string[];
    }
    return available.has(node.request.key)?[node.request.key]:null;
  };
  return roots.flatMap(node=>resolve(node)??[]);
}
export class TerrainStream {
  readonly workers: WorkerSlot[] = [];
  roots: TileNode[] = [];
  desired = new Map<string, ChunkRequest>();
  pending: ChunkData[] = [];
  ready = new Set<string>();
  private queue: ChunkRequest[] = [];
  private disposed = false;
  private lastSelection='';
  revision=0;
  error: string | null = null;
  readonly worldGenerationMs:number[]=[];
  readonly generationSamples:{key:string;level:number;timings:Record<string,number>}[]=[];
  constructor(readonly config: WorldConfig,readonly profile=false) {
    for (let i = 0; i < Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 4) - 2)); i++) {
      const worker = new Worker(new URL('./world.worker.ts', import.meta.url), { type: 'module' });
      const slot: WorkerSlot = { worker, busy: null }; this.workers.push(slot);
      worker.postMessage({ config });
      worker.onmessage = e => {
        if(e.data.workerReady) {this.worldGenerationMs.push(e.data.generationMs);return;}
        slot.busy = null;
        if(e.data.timings) {this.generationSamples.push({key:e.data.key,level:e.data.level,timings:e.data.timings});if(this.generationSamples.length>200)this.generationSamples.shift();}
        if (e.data.error) this.error = e.data.error;
        else if (this.desired.has(e.data.key)) { this.pending.push(e.data); this.ready.add(e.data.key); }
        this.dispatch();
      };
      worker.onerror = e => { this.error = `Terrain worker failed: ${e.message}`; slot.busy = null; };
    }
  }
  update(x: number, z: number, distance: number) {
    const selection=`${x}/${z}/${distance}`;if(selection===this.lastSelection)return;
    this.lastSelection=selection;this.revision++;
    this.roots = selectTiles(x, z, this.config.islandSizeMeters, distance);
    this.desired.clear();
    const visit = (node: TileNode) => { this.desired.set(node.request.key, node.request); node.children.forEach(visit); };
    this.roots.forEach(visit);
    // Prioritize the player's nearby hierarchy, including its detailed collision
    // tiles. Coarse parents elsewhere still provide quick background coverage.
    const busy = new Set(this.workers.map(s => s.busy));
    const priority=playerPriority(this.roots,x,z);
    const near=(r:ChunkRequest)=>{const e=BASE_CHUNK*2**r.level;return Math.hypot(Math.max(r.x-x,0,x-r.x-e),Math.max(r.z-z,0,z-r.z-e));};
    this.queue = [...this.desired.values()].filter(r => !this.ready.has(r.key) && !busy.has(r.key))
      .sort((a, b) => Number(!priority.has(a.key))-Number(!priority.has(b.key)) || b.level - a.level || near(a)-near(b));
    this.dispatch();
  }
  private dispatch() {
    if (this.disposed) return;
    for (const slot of this.workers) if (!slot.busy) {
      const request = this.queue.shift(); if (!request) break;
      slot.busy = request.key; slot.worker.postMessage({ request,profile:this.profile });
    }
  }
  drawKeys(available: Set<string>): string[] {
    return resolveDrawKeys(this.roots,available);
  }
  forget(key: string) { this.ready.delete(key); }
  get loading() { return this.queue.length + this.workers.filter(w => w.busy).length; }
  dispose() { this.disposed = true; this.workers.forEach(w => w.worker.terminate()); this.pending.length = 0; this.queue.length = 0; }
}
