import type {Prop} from '../shared/world';
import type {Point3} from '../shared/rocks';

export const headBlur=(hp:number)=>Math.min(2.4,Math.max(0,(45-hp)/45)*2.4);
function hash(value:string){let h=2166136261;for(const c of value)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
/** Presentation only: never edits the collision scene, placements, or network state. */
export class HeadInjuryPerception {
  private active=false;private sector='';private position:Point3=[0,0,0];
  private revealed=new Set<string>();private revision=0;
  ghosts:Prop[]=[];
  constructor(private seed:string,private height:(x:number,z:number)=>number){}
  get signature(){return `${this.active}/${this.sector}/${this.revision}`;}
  update(hp:number,position:ArrayLike<number>){
    this.position=[position[0],position[1],position[2]];
    const active=hp<10;
    if(!active){if(this.active){this.active=false;this.ghosts=[];this.revealed.clear();this.sector='';this.revision++;}return;}
    this.active=true;
    const cx=Math.floor(position[0]/32),cz=Math.floor(position[2]/32),sector=`${cx}:${cz}`;
    if(sector===this.sector)return;this.sector=sector;
    const props:Prop[]=[];
    // Adjacent sectors overlap so ghosts stay still as the player walks around.
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      const key=`${this.seed}:${cx+dx}:${cz+dz}`,h=hash(key),x=(cx+dx)*32+4+h%240/10,z=(cz+dz)*32+4+(h>>>8)%240/10;
      const kinds:Prop['kind'][]=['rock','oak','wall-wood','torch','birch'],kind=kinds[h%kinds.length];
      props.push({kind,x,y:this.height(x,z),z,variant:kind==='rock'?h%12:0,scale:kind==='rock'?1.25:1,rotation:(h%628)/100,normal:[0,1,0]});
    }
    this.ghosts=props;
  }
  hidden(id:string,x:number,z:number){return this.active&&!this.revealed.has(id)&&Math.hypot(x-this.position[0],z-this.position[2])<40&&hash(`${this.seed}:${id}`)%100<14;}
  reveal(id:string){if(this.active&&!this.revealed.has(id)){this.revealed.add(id);this.revision++;}}
}
