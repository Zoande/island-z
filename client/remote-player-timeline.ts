export interface RemotePlayer {id:string;nickname:string;feet:[number,number,number];respawns?:number}
interface Frame {time:number;arrived:number;players:RemotePlayer[]}

/** Buffers server-timed player snapshots and increases its delay when arrivals jitter. */
export class RemotePlayerTimeline {
  private frames:Frame[]=[];
  private jitter=0;
  private previous?:Frame;
  private playback?:number;
  private lastSampleAt?:number;
  reset(){this.frames=[];this.previous=undefined;this.jitter=0;this.playback=undefined;this.lastSampleAt=undefined;}
  get delayMs(){return Math.max(100,Math.min(250,100+this.jitter*2));}
  push(time:number,arrived:number,players:RemotePlayer[]){
    const frame={time,arrived,players};
    const last=this.frames[this.frames.length-1];
    if(last&&time<last.time)return;
    if(this.previous){
      const transitChange=Math.abs((arrived-this.previous.arrived)-(time-this.previous.time));
      this.jitter=this.jitter*.8+transitChange*.2;
    }
    this.previous=frame;
    if(last&&time===last.time)this.frames[this.frames.length-1]=frame;
    else this.frames.push(frame);
    while(this.frames.length>20)this.frames.shift();
  }
  sample(now:number):RemotePlayer[]{
    if(!this.frames.length)return [];
    const latest=this.frames[this.frames.length-1],desired=Math.min(latest.time,latest.time+Math.max(0,now-latest.arrived)-this.delayMs);
    if(this.playback===undefined)this.playback=desired;
    else this.playback+=Math.min(Math.max(0,desired-this.playback),Math.max(0,now-(this.lastSampleAt??now))*1.25);
    this.lastSampleAt=now;
    const target=this.playback;
    let from=this.frames[0],to=latest;
    for(let i=1;i<this.frames.length;i++)if(this.frames[i].time>=target){from=this.frames[i-1];to=this.frames[i];break;}
    const amount=Math.max(0,Math.min(1,(target-from.time)/Math.max(1,to.time-from.time)));
    return to.players.map(player=>{
      const found=from.players.find(candidate=>candidate.id===player.id),prior=found??player;
      const displacement=Math.hypot(...player.feet.map((value,i)=>value-prior.feet[i]));
      if(!found||player.respawns!==undefined&&prior.respawns!==undefined&&player.respawns!==prior.respawns||displacement>16)return player;
      return {id:player.id,nickname:player.nickname,feet:player.feet.map((value,i)=>prior.feet[i]+(value-prior.feet[i])*amount) as [number,number,number]};
    });
  }
}
