import {TREE_LOD,type LodBoundary} from './lod';
export type Quality='low'|'medium'|'high';
export const qualityDescriptions:Record<Quality,string>={low:'Lighter shadows and scenery detail for faster rendering.',medium:'Balanced scenery detail and soft shadows.',high:'Sharper shadows and detailed scenery farther away.'};
export interface QualitySettings {
  scale:number;distance:number;grass:number;trees:number;
  shadowSize:number;shadowRadius:number;shadowCasterRange:number;shadowFilter:number;shadowLodOffset:number;
  treeLod:LodBoundary[];grassLod:LodBoundary[];shrubLod:LodBoundary[];rockDetail:number;
}
/** Rendering choices only. Density, generated terrain and physics do not vary. */
export const qualities:Record<Quality,QualitySettings>={
  low:{scale:.65,distance:3000,grass:70,trees:1800,shadowSize:1024,shadowRadius:150,shadowCasterRange:700,shadowFilter:1,shadowLodOffset:1,
    treeLod:[{distance:80,width:30},{distance:150,width:50},{distance:300,width:120}],
    grassLod:[{distance:30,width:16},{distance:55,width:24}],shrubLod:[{distance:80,width:60}],rockDetail:.8},
  medium:{scale:.85,distance:6500,grass:120,trees:2600,shadowSize:2048,shadowRadius:230,shadowCasterRange:850,shadowFilter:2,shadowLodOffset:0,
    treeLod:TREE_LOD,grassLod:[{distance:35,width:16},{distance:65,width:24}],shrubLod:[{distance:85,width:60}],rockDetail:1},
  high:{scale:1,distance:11000,grass:170,trees:3600,shadowSize:4096,shadowRadius:320,shadowCasterRange:1000,shadowFilter:2,shadowLodOffset:0,
    treeLod:[{distance:120,width:40},{distance:330,width:90},{distance:600,width:200}],
    grassLod:[{distance:50,width:24},{distance:100,width:40}],shrubLod:[{distance:130,width:80}],rockDetail:1.35},
};
