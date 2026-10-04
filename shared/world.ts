import type { WorldConfig } from './config';
import { fbm, hash, noise, seedHash, smooth } from './noise';
import { rockPoints, rockFootprintRadius } from './rocks';
import { WaterNetwork } from './water';
import type {CharacterWater} from './character';
import {oceanWaveHeight} from './waves';
/** Material order: sand, meadow, litter, bedrock, mud, gravel, moss, dry meadow. */
export interface SurfaceSample { height: number; normal: [number, number, number]; forest: number; weights: [number, number, number, number, number, number, number, number] }
export type PropKind = 'oak' | 'birch' | 'palm' | 'rock' | 'grass' | 'bush' | 'pebble' | 'algae' | import('./object-registry').BuiltKind;
export interface Prop { kind: PropKind; x: number; y: number; z: number; scale: number; rotation: number; variant: number; normal?: [number, number, number];aperture?:'door'|'window' }
interface MountainRange { x: number; z: number; angle: number; length: number; width: number; height: number; salt: number }
export class WorldGenerator {
  readonly seed: number;
  private readonly ranges: MountainRange[];
  private readonly featureScale: number;
  private readonly rockRadii: number[];
  readonly water: WaterNetwork;
  private treeCache=new Map<string,Prop|null>();
  constructor(readonly config: WorldConfig) {
    this.seed = seedHash(config.seed);
    this.featureScale = Math.min(1.5, config.islandSizeMeters / 16384);
    this.rockRadii = Array.from({ length: 12 }, (_, variant) => rockFootprintRadius(rockPoints(config.seed, variant)));
    const radius = config.islandSizeMeters * .5;
    this.ranges = Array.from({ length: 3 }, (_, i) => ({
      x: (hash(i, 0, this.seed + 401) - .5) * radius * .44,
      z: (hash(i, 1, this.seed + 402) - .5) * radius * .42,
      angle: hash(i, 2, this.seed + 403) * Math.PI,
      length: radius * (.40 + hash(i, 3, this.seed + 404) * .26),
      width: Math.min(radius * .16, 2550) * (.80 + hash(i, 4, this.seed + 405) * .40),
      height: (780 + hash(i, 5, this.seed + 406) * 570) * Math.min(1.4, config.islandSizeMeters / 16384),
      salt: this.seed + 500 + i * 71,
    }));
    this.water = new WaterNetwork(this.seed, config.islandSizeMeters, (x,z)=>this.terrainHeight(x,z), (x,z)=>this.coastDistance(x,z));
  }
  /** Signed inland distance used to keep lowlands and mountains away from beaches. */
  coastDistance(x: number, z: number): number {
    const radius = this.config.islandSizeMeters * .5, nx = x / radius, nz = z / radius, s = this.seed;
    const wx = nx + (noise(nx * 2.1 + 23, nz * 2.1, s + 4) - .5) * .14;
    const wz = nz + (noise(nx * 2.1, nz * 2.1 - 17, s + 5) - .5) * .14;
    const boundary = .75 + (fbm(nx * 2.2 + 11, nz * 2.2, s + 6, 3) - .5) * .23;
    return (boundary - Math.hypot(wx, wz)) * radius;
  }
  height(x: number, z: number): number {
    const original = this.terrainHeight(x,z), water = this.water.sample(x,z,original);
    return water ? water.bed : original;
  }
  surfaceWater(x:number,z:number,time?:number):CharacterWater|null {
    const water=this.water.sample(x,z);
    if(water) {
      const ground=this.terrainHeight(x,z),bed=ground+(Math.min(ground,water.bed)-ground)*water.bank;
      if(bed<water.level-.02)return {level:water.level,kind:water.kind};
    }
    const inland=this.coastDistance(x,z);
    if(inland<0)return {level:time===undefined?0:oceanWaveHeight(x,z,time),kind:'ocean',offshoreMeters:-inland};
    return null;
  }
  terrainHeight(x: number, z: number): number {
    const inland = this.coastDistance(x, z), s = this.seed;
    const scale = this.featureScale, shelf = Math.max(.06, Math.min(1, scale));
    if (inland < 0) {
      const offshore=-inland;
      return -28*(1-Math.exp(-offshore/(450*shelf)))-offshore*.055*smooth(100*shelf,900*shelf,offshore);
    }
    // The coast is a long, shallow shelf, not a short ramp into a mountain mask.
    const beach = 5 * shelf * (1 - Math.exp(-inland / (110 * shelf)));
    const lowlandBlend = smooth(140 * shelf, 1050 * shelf, inland);
    const mountainBlend = smooth(800 * shelf, 2700 * shelf, inland);
    const lowlands = (10 + fbm(x / (2600 * scale) + 53, z / (2600 * scale), s + 11, 3) * 34) * shelf;
    const hillsMask = smooth(.40, .72, noise(x / (4100 * scale) - 21, z / (4100 * scale) + 17, s + 17));
    const hills = Math.pow(fbm(x / (900 * scale), z / (900 * scale), s + 19, 3), 1.7) * hillsMask * 145 * shelf;
    // Rolling relief is present throughout inland plains, independently of the hill mask.
    const rollX = x + (noise(x / (1800 * shelf), z / (1800 * shelf), s + 41) - .5) * 220 * shelf;
    const rollZ = z + (noise(x / (1800 * shelf), z / (1800 * shelf), s + 42) - .5) * 220 * shelf;
    const rolling = ((fbm(rollX / (650 * shelf) + 17, rollZ / (650 * shelf), s + 43, 3) - .5) * 85
      + (noise(x / (1450 * shelf) - 12, z / (1450 * shelf) + 3, s + 44) - .5) * 60) * shelf;
    let mountainSquared = 0;
    for (const range of this.ranges) {
      const dx = x - range.x, dz = z - range.z, c = Math.cos(range.angle), sn = Math.sin(range.angle);
      const along = dx * c + dz * sn, across = -dx * sn + dz * c;
      const envelope = 1 - smooth(.55, 1.0, Math.abs(along) / range.length);
      if (envelope <= 0) continue;
      const bend = (fbm(along / (3200 * scale) + 9, 5, range.salt, 3) - .5) * range.width * .75;
      const warpedAcross = across - bend;
      const distance = Math.sqrt(warpedAcross ** 2 + (24 * scale) ** 2) - 24 * scale;
      const foothill = Math.exp(-.53 * (distance / range.width) ** 2);
      // Expanding shoulders leaves the upper spine narrower, preserving steep summits.
      const spine = Math.exp(-Math.pow(distance / (range.width * .32), 1.55));
      const peaks = .70 + fbm(along / (1000 * scale) + 19, 8, range.salt + 1, 3) * .56;
      // Slope-following ribs and gullies give each range branching shoulders and valleys.
      const ribs = 1 - Math.abs(noise(along / (480 * scale) + distance / (1600 * scale), distance / (1100 * scale), range.salt + 2) * 2 - 1);
      const erosionShape = .80 + ribs * .20;
      let mass = range.height * peaks * envelope * (.39 * foothill + .61 * spine) * erosionShape;
      // A few local, warped upland benches. These are blended bands, never global terraces.
      const benchMask = smooth(.55, .76, fbm(along / (1500 * scale) + 7, across / (2200 * scale) - 5, range.salt + 9, 3));
      const benchElevation = range.height * (.33 + noise(along / (3300 * scale), across / (2800 * scale), range.salt + 10) * .16);
      const halfBand = 80 * shelf;
      const delta = mass - benchElevation;
      const benchWindow = 1 - smooth(halfBand * .35, halfBand, Math.abs(delta));
      mass -= delta * benchMask * benchWindow * .68;
      mountainSquared += mass * mass;
    }
    const mountain = Math.sqrt(mountainSquared) * mountainBlend;
    const mountainDetail = (fbm(x / (125 * scale), z / (125 * scale), s + 33, 3) - .5) * 8 * shelf * smooth(90 * shelf, 500 * shelf, mountain);
    const groundDetail = (noise(x / (45 * shelf), z / (45 * shelf), s + 35) - .5) * .8 * shelf;
    const foothillBlend = smooth(650 * shelf, 1900 * shelf, inland);
    const rollBlend = smooth(280 * shelf, 1350 * shelf, inland);
    const rolledHeight = lowlands + rolling;
    // Smooth valley floors keep inland depressions above sea without a flat clamped shelf.
    const positiveRolledHeight = .5 * (rolledHeight + Math.sqrt(rolledHeight ** 2 + (8 * shelf) ** 2));
    return beach + lowlandBlend * (lowlands + groundDetail) + rollBlend * (positiveRolledHeight - lowlands)
      + foothillBlend * hills + mountain + mountainDetail;
  }
  sample(x: number, z: number): SurfaceSample {
    const height = this.height(x, z), e = 1;
    const dx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const dz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    const len = Math.hypot(dx, 1, dz), slope = 1 - 1 / len;
    const forestScale = Math.max(.12, Math.min(1, this.featureScale));
    const forest = smooth(.38, .65, fbm(x / (680 * forestScale) + 31, z / (680 * forestScale) - 12, this.seed + 81, 3))
      * (1 - smooth(.18, .45, slope)) * (1 - smooth(650 * forestScale, 1150 * forestScale, height));
    const sand = (1 - smooth(75 * forestScale, 210 * forestScale, this.coastDistance(x, z))) * (1 - smooth(.1, .3, slope));
    const altitudeRock = smooth(700 * forestScale, 1250 * forestScale, height) * .65;
    const rock = Math.max(smooth(.08, .36, slope), altitudeRock) * (1 - sand);
    const patch = fbm(x / 95 + 7, z / 95 - 11, this.seed + 86, 3);
    const humidity = noise(x / 440 - 9, z / 440 + 23, this.seed + 87);
    const wet = smooth(.44, .72, humidity) * (1 - smooth(25 * forestScale, 100 * forestScale, height))
      * (1 - smooth(.015, .10, slope));
    const mudMask = wet * smooth(.40, .65, patch) * .85 * (1 - sand);
    const gravelMask = Math.max(smooth(.016, .10, slope) * (1 - smooth(.13, .32, slope)),
      sand * smooth(1.5, 5, height) * .48) * smooth(.40, .62, patch) * .75;
    const available = 1 - sand - rock;
    const mud = available * mudMask;
    const gravel = (available - mud) * gravelMask;
    const remainder = available - mud - gravel;
    const moss = remainder * forest * smooth(.32, .68, humidity) * .60;
    const dry = (remainder - moss) * (1 - forest) * (1 - wet) * (1 - smooth(.32, .62, humidity)) * .70;
    const soil = (remainder - moss - dry) * forest * .45;
    const grass = remainder - moss - dry - soil;
    const weights: SurfaceSample['weights'] = [sand, grass, soil, rock, mud, gravel, moss, dry];
    const water = this.water.sample(x,z);
    if(water && height < water.level + .5) {
      const blend=water.bank*.85, material=water.kind==='river'?5:4;
      for(let i=0;i<8;i++)weights[i]*=1-blend;
      weights[material]+=blend;
    }
    return { height, normal: [-dx / len, 1 / len, -dz / len], forest, weights };
  }
  // Stable jittered candidates have global cell ownership, independent of chunks and load order.
  treeCandidate(cx: number, cz: number): Prop | null {
    const key=`${cx}:${cz}`;
    if(this.treeCache.has(key))return this.treeCache.get(key)!;
    const tree=this.makeTreeCandidate(cx,cz);this.treeCache.set(key,tree);
    if(this.treeCache.size>65536)this.treeCache.delete(this.treeCache.keys().next().value!);
    return tree;
  }
  private makeTreeCandidate(cx:number,cz:number):Prop|null {
    const s = this.seed, spacing = 11;
    const x = (cx + 0.15 + hash(cx, cz, s + 102) * 0.7) * spacing;
    const z = (cz + 0.15 + hash(cx, cz, s + 103) * 0.7) * spacing;
    const inland = this.coastDistance(x,z);
    // Exact early rejection: no non-palm tree can exceed this acceptance rate.
    if((inland<=35||inland>=240)&&hash(cx,cz,s+104)>.62)return null;
    const surface = this.sample(x, z);
    const water = this.water.sample(x,z);
    if (water && water.level > surface.height && water.bank > .25) return null;
    const palm = inland > 35 && inland < 240 && surface.height > 1.5 && surface.height < 15 && surface.normal[1] > .97
      && hash(cx,cz,s+109) < .11 * smooth(.36,.65,noise(x/260,z/260,s+110));
    if (palm) return {kind:'palm',x,y:surface.height-.2,z,scale:.80+hash(cx,cz,s+106)*.45,rotation:hash(cx,cz,s+107)*Math.PI*2,variant:Math.floor(hash(cx,cz,s+108)*3)};
    if (surface.height < 8 || surface.normal[1] < 0.87 || hash(cx, cz, s + 104) > 0.02 + surface.forest * 0.60) return null;
    const kind = hash(cx, cz, s + 105) < 0.68 ? 'oak' : 'birch';
    return { kind, x, y: surface.height - 0.18, z, scale: 0.75 + hash(cx, cz, s + 106) * 0.65,
      rotation: hash(cx, cz, s + 107) * Math.PI * 2, variant: Math.floor(hash(cx, cz, s + 108) * 6) };
  }
  treeProps(x0:number,z0:number,extent:number):Prop[] {
    const props:Prop[]=[],endX=x0+extent,endZ=z0+extent;
    for(let z=Math.floor(z0/11);z<Math.ceil(endZ/11);z++)for(let x=Math.floor(x0/11);x<Math.ceil(endX/11);x++) {
      const tree=this.treeCandidate(x,z);
      if(tree&&tree.x>=x0&&tree.x<endX&&tree.z>=z0&&tree.z<endZ)props.push(tree);
    }
    return props;
  }
  private algaeProps(x0:number,z0:number,extent:number):Prop[] {
    const props:Prop[]=[],endX=x0+extent,endZ=z0+extent;
      const spacing=8;
      for(let cz=Math.floor(z0/spacing);cz<Math.ceil(endZ/spacing);cz++)for(let cx=Math.floor(x0/spacing);cx<Math.ceil(endX/spacing);cx++) {
        if(hash(cx,cz,this.seed+651)>.3)continue;
        const x=(cx+.1+hash(cx,cz,this.seed+652)*.8)*spacing,z=(cz+.1+hash(cx,cz,this.seed+653)*.8)*spacing;
        if(x<x0||x>=endX||z<z0||z>=endZ)continue;
        const height=this.height(x,z),water=this.surfaceWater(x,z);if(!water)continue;
        const depth=water.level-height;if(depth<.8||depth>18||noise(x/35,z/35,this.seed+654)<.42)continue;
        const surface=this.sample(x,z);if(surface.normal[1]<.8)continue;
        props.push({kind:'algae',x,z,y:height-.04,scale:.55+hash(cx,cz,this.seed+655)*.65,rotation:hash(cx,cz,this.seed+656)*Math.PI*2,variant:0});
      }
    return props;
  }
  props(x0: number, z0: number, extent: number, includeGrass = true): Prop[] {
    const props: Prop[] = [], endX = x0 + extent, endZ = z0 + extent;
    const trees = new Map<string, Prop | null>();
    const treeAt = (x: number, z: number) => {
      const key = `${x}:${z}`;
      if (!trees.has(key)) trees.set(key, this.treeCandidate(x, z));
      return trees.get(key)!;
    };
    for (let z = Math.floor(z0 / 11); z < Math.ceil(endZ / 11); z++) for (let x = Math.floor(x0 / 11); x < Math.ceil(endX / 11); x++) {
      const tree = treeAt(x, z);
      if (tree && tree.x >= x0 && tree.x < endX && tree.z >= z0 && tree.z < endZ) props.push(tree);
    }
    const addCandidates = (kind: 'rock' | 'grass' | 'bush', spacing: number, salt: number) => {
      for (let cz = Math.floor(z0 / spacing); cz < Math.ceil(endZ / spacing); cz++) for (let cx = Math.floor(x0 / spacing); cx < Math.ceil(endX / spacing); cx++) {
        const x = (cx + 0.1 + hash(cx, cz, this.seed + salt) * 0.8) * spacing;
        const z = (cz + 0.1 + hash(cx, cz, this.seed + salt + 1) * 0.8) * spacing;
        if (x < x0 || x >= endX || z < z0 || z >= endZ) continue;
        const surface = this.sample(x, z), chance = hash(cx, cz, this.seed + salt + 2);
        const water = this.water.sample(x,z);
        if (water && water.level > surface.height && water.bank > .25) continue;
        if (kind === 'grass' ? surface.height < 5 || surface.weights[0] > .3 || surface.normal[1] < .85
          || chance > (.74 - surface.forest * .32) * (1 - surface.weights[4]) * (1 - surface.weights[5])
          : kind === 'bush' ? surface.height < 7 || surface.normal[1] < .90 || surface.weights[0] > .25
          || chance > (.08 + surface.forest * .25) * smooth(.32, .60, noise(x / 70, z / 70, this.seed + 461))
          : surface.height < 1.2 || surface.normal[1] < .36 || chance > .055 + surface.weights[3] * .115) continue;
        // Different coordinate mixing avoids correlation between acceptance and large sizes.
        const sizeRoll = kind === 'rock' ? hash(cx * 3 + 17, cz * 5 - 23, this.seed + salt + 701) : hash(cx, cz, this.seed + salt + 3);
        const large = kind === 'rock' && sizeRoll > .978 && surface.normal[1] > .65;
        const variant = kind === 'rock' ? large ? (hash(cx, cz, this.seed + salt + 5) < .5 ? 3 : 9) : Math.floor(hash(cx, cz, this.seed + salt + 5) * 12)
          : kind === 'bush' ? Math.floor(hash(cx, cz, this.seed + salt + 5) * 4)
          : surface.weights[7] > .20 ? 2 : surface.forest > .5 ? 3 : sizeRoll > .66 ? 1 : 0;
        const scale = kind === 'grass' ? .75 + sizeRoll * .70 : kind === 'bush' ? .70 + sizeRoll * .65 : (large ? 3.6 + (sizeRoll - .978) / .022 * 2.4
          : sizeRoll > .78 ? 1.65 + (sizeRoll - .78) / .22 * 1.85 : .55 + sizeRoll / .78 * .95) * (.60 + surface.normal[1] * .40);
        const clearance = kind === 'rock' ? this.rockRadii[variant] * scale + 1.5 : kind === 'bush' ? 2.3 * scale : 1.1;
        let blocked = false;
        const treeX = Math.floor(x / 11), treeZ = Math.floor(z / 11);
        const reach = Math.ceil(clearance / 11);
        for (let dz = -reach; dz <= reach && !blocked; dz++) for (let dx = -reach; dx <= reach; dx++) {
          const tree = treeAt(treeX + dx, treeZ + dz);
          if (tree && Math.hypot(tree.x - x, tree.z - z) < clearance) { blocked = true; break; }
        }
        if (blocked) continue;
        props.push({ kind, x, y: surface.height - (kind === 'rock' ? 0.28 : 0.02), z,
          scale,
          rotation: hash(cx, cz, this.seed + salt + 4) * Math.PI * 2,
          variant,
          normal: kind === 'rock' ? surface.normal : undefined });
      }
    };
    addCandidates('rock', 16, 201);
    addCandidates('bush', 9, 451);
    if (includeGrass) {
      props.push(...this.algaeProps(x0,z0,extent));
      addCandidates('grass', 3.2, 301);
      // Sparse global patch owners scatter small angular stones without a visible grid.
      // Include a margin so patches crossing chunk boundaries keep identical ownership.
      const spacing = 18, radius = 3;
      for (let cz = Math.floor((z0 - radius) / spacing); cz <= Math.floor((endZ + radius) / spacing); cz++)
        for (let cx = Math.floor((x0 - radius) / spacing); cx <= Math.floor((endX + radius) / spacing); cx++) {
          if (hash(cx, cz, this.seed + 601) > .28) continue;
          const px = (cx + hash(cx, cz, this.seed + 602)) * spacing;
          const pz = (cz + hash(cx, cz, this.seed + 603)) * spacing;
          const patch = this.sample(px, pz);
          if (patch.height < .8 || patch.normal[1] < .75 || hash(cx, cz, this.seed + 604) > .06 + patch.weights[5] * 1.8 + patch.weights[0] * .25 + patch.weights[3] * .18) continue;
          for (let i = 0; i < 9; i++) {
            const angle = hash(cx * 11 + i, cz, this.seed + 605) * Math.PI * 2;
            const r = Math.sqrt(hash(cx, cz * 11 + i, this.seed + 606)) * radius;
            const x = px + Math.cos(angle) * r, z = pz + Math.sin(angle) * r;
            if (x < x0 || x >= endX || z < z0 || z >= endZ) continue;
            const surface = this.sample(x, z);
            const water = this.water.sample(x,z);
            if (water && water.level > surface.height && water.bank > .25) continue;
            if (surface.height < .7 || surface.normal[1] < .75) continue;
            props.push({ kind: 'pebble', x, z, y: surface.height, scale: .06 + hash(cx * 11 + i, cz, this.seed + 607) * .20,
              variant: [0, 1, 2, 4][i % 4], rotation: angle, normal: surface.normal });
          }
        }
    }
    return props;
  }
}
