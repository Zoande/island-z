import {CHARACTER,type CharacterCollider} from './character';
import type {Point3} from './rocks';
/** Standing capsules block horizontally, including in water; never support a player.
 * Reusing the controller's swept circular contacts prevents tunnelling and slides. */
export function playerContacts(others:Iterable<{id:string;feet:ArrayLike<number>}>,self:string):CharacterCollider[]{
  return [...others].filter(p=>p.id!==self).sort((a,b)=>a.id.localeCompare(b.id)).map(p=>({kind:'player',x:p.feet[0],z:p.feet[2],bottom:p.feet[1],top:p.feet[1]+CHARACTER.height,radius:CHARACTER.radius}));
}
export function separatePlayers(players:Iterable<{id:string;feet:Float64Array;velocity:Float64Array}>,move?:(id:string,delta:Point3)=>Point3){
  const sorted=[...players].sort((a,b)=>a.id.localeCompare(b.id));
  for(let pass=0;pass<3;pass++)for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length;j++){
    const a=sorted[i],b=sorted[j];if(a.feet[1]>=b.feet[1]+CHARACTER.height||b.feet[1]>=a.feet[1]+CHARACTER.height)continue;
    const dx=b.feet[0]-a.feet[0],dz=b.feet[2]-a.feet[2],distance=Math.hypot(dx,dz),overlap=CHARACTER.radius*2+.002-distance;if(overlap<=0)continue;
    const nx=distance?dx/distance:1,nz=distance?dz/distance:0;
    for(const [p,sign]of [[a,-1],[b,1]]as const){const delta:Point3=[nx*overlap*.5*sign,0,nz*overlap*.5*sign],next=move?.(p.id,delta)??[p.feet[0]+delta[0],p.feet[1],p.feet[2]+delta[2]];p.feet.set(next);const inward=Math.min(0,p.velocity[0]*nx*sign+p.velocity[2]*nz*sign);p.velocity[0]-=nx*sign*inward;p.velocity[2]-=nz*sign*inward;}
  }
}
