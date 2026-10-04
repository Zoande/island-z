import './style.css';
import { GENERATOR_VERSION, parseWorldConfig, type WorldDescriptor } from '../shared/config';
import { WorldGenerator } from '../shared/world';
import { CHARACTER } from '../shared/character';
import {rockPoints} from '../shared/rocks';
import { PlayerCamera } from './camera';
import { playerCollider } from './player-colliders';
import { IslandRenderer } from './renderer';
import { TerrainStream } from './streaming';
import {qualityDescriptions,type Quality} from './quality';
import {BuildingController} from './building';

const canvas=document.querySelector<HTMLCanvasElement>('#world')!;
const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=`
  <div class="masthead"><div class="mark">IZ</div><div><div class="brand">ISLAND Z</div><div class="subtitle">FIRST PERSON / ISLAND EXPLORER</div></div></div>
  <div class="status-pill"><span class="dot"></span><span id="status">Connecting</span></div>
  <section class="panel collapsed" aria-label="Settings"><button class="panel-head" aria-expanded="false"><span>Settings & controls</span><span id="collapse">+</span></button>
    <div class="panel-body"><hr class="rule"/>
    <div class="meta-row"><label>Frame rate</label><span id="fps" class="value">—</span></div>
    <div class="field"><label for="sun">Sun elevation <span id="sun-value">48°</span></label><input id="sun" type="range" min="12" max="80" value="48" aria-label="Sun elevation"/></div>
    <div class="meta-row field"><label for="quality">Render quality</label><select id="quality"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select></div>
    <p id="quality-description" class="setting-note">${qualityDescriptions.medium}</p>
    <div class="controls"><span><kbd>W A S D</kbd>Move / swim</span><span><kbd>SPACE</kbd>Jump / swim up</span><span><kbd>SHIFT</kbd>Sprint / dive</span><span><kbd>MOUSE</kbd>Look / steer</span><span><kbd>ESC</kbd>Release mouse</span></div>
    </div></section>
  <div class="caption"><div id="biome" class="biome">Coastal grassland</div></div>
  <div class="vitals" aria-label="Player vitals"><div class="vital-label"><span>Oxygen</span><span id="oxygen-time">60s</span></div><div id="oxygen" class="oxygen" role="progressbar" aria-label="Oxygen" aria-valuemin="0" aria-valuemax="60">${Array.from({length:6},()=>'<i class="bubble"></i>').join('')}</div><div class="vital-label"><span>Stamina</span><span id="stamina-state"></span></div><div id="stamina" class="stamina" role="progressbar" aria-label="Stamina" aria-valuemin="0" aria-valuemax="100"><i></i></div></div>
  <div id="respawn-note" class="respawn-note" role="status"></div>
  <div class="building-hud"><div id="build-hint" class="build-hint" role="status"></div><div id="build-controls" class="build-controls" hidden>Left click place · Wheel fine rotate · R turn 90°</div><nav id="hotbar" class="hotbar" aria-label="Building hotbar"></nav></div>
  <div class="play-hint">Click the landscape to explore</div><div class="reticle"></div>
  <div class="overlay" id="overlay"><div class="eyebrow">A world from a seed</div><h1 id="overlay-title">Finding the island</h1><p id="message">Connecting to the world server…</p><div class="loading-line" id="loading-line"></div><button id="retry" hidden>Retry</button></div>`;
const get=(id:string)=>document.getElementById(id)!;
const overlay=get('overlay');
let renderer:IslandRenderer|undefined,stream:TerrainStream|undefined,camera:PlayerCamera|undefined,building:BuildingController|undefined;
let animation=0,attempt=0,failed=false;
const events=new AbortController();
function fail(message:string) {
  if(failed)return;failed=true;cancelAnimationFrame(animation);
  get('overlay-title').textContent='The viewer needs attention';get('message').textContent=message;
  get('loading-line').hidden=true;get('retry').hidden=false;overlay.classList.remove('hidden');get('status').textContent='Paused';
  if(document.pointerLockElement===canvas)document.exitPointerLock();
}
function dispose() {cancelAnimationFrame(animation);building?.dispose();camera?.dispose();stream?.dispose();renderer?.dispose();building=undefined;camera=undefined;stream=undefined;renderer=undefined;}
async function start() {
  const currentAttempt=++attempt;dispose();failed=false;overlay.classList.remove('hidden');
  get('overlay-title').textContent='Finding the island';get('retry').hidden=true;get('loading-line').hidden=false;
    const progress=(message:string)=>{if(currentAttempt===attempt)get('message').textContent=message;};
  try {
    progress('Connecting to the world server…');
    let response:Response;
    try {response=await fetch('/api/world',{signal:AbortSignal.timeout(6000),cache:'no-store'});}
    catch {throw new Error('Cannot reach the world server. Start npm run server in another terminal, then retry.');}
    if(!response.ok)throw new Error('The world server did not return a world. Start npm run server and check its terminal output.');
    const descriptor=await response.json()as WorldDescriptor,config=parseWorldConfig(descriptor);
    if(descriptor.generatorVersion!==GENERATOR_VERSION)throw new Error('Client and server generator versions differ. Restart both development processes and refresh.');
    const world=new WorldGenerator(config);
    renderer=new IslandRenderer(canvas,config,world);renderer.onFatal=fail;
    const r=renderer;
    if(new URLSearchParams(location.search).has('profile'))r.profiler.start();
    camera=new PlayerCamera(canvas,{surface:(x,z)=>r.collisionSurface(x,z),colliders:(x,z)=>r.playerColliders(x,z),water:(x,z)=>world.surfaceWater(x,z,performance.now()/1000)});
    // Start at a dry, gentle coast, with room around nearby trunks and shrubs.
    const spawnX=config.islandSizeMeters*.08;
    let inner=0,outer=config.islandSizeMeters*.5;
    const shoreOffset=Math.min(140,config.islandSizeMeters*.04);
    for(let i=0;i<28;i++) {
      const middle=(inner+outer)/2;if(world.coastDistance(spawnX,middle)>shoreOffset)inner=middle;else outer=middle;
    }
    const shoreZ=(inner+outer)/2,nearby=world.props(spawnX-32,shoreZ-32,64,false).flatMap(p=>{const c=playerCollider(p,p.kind==='rock'?rockPoints(config.seed,p.variant):undefined);return c?[c]:[];});
    let spawn:[number,number]=[spawnX,shoreZ];
    for(let i=0;i<100;i++) {
      const angle=i*2.399963,radius=i?Math.sqrt(i)*2:0,x=spawnX+Math.cos(angle)*radius,z=shoreZ+Math.sin(angle)*radius;
      const surface=world.sample(x,z),water=world.water.sample(x,z);
      if(surface.normal[1]<.95||surface.height<.5||water&&water.level>surface.height)continue;
      if(nearby.some(c=>Math.hypot(x-c.x,z-c.z)<c.radius+CHARACTER.radius+.4))continue;
      spawn=[x,z];break;
    }
    camera.spawn(spawn[0],world.height(...spawn),spawn[1]);camera.pitch=-.04;
    await renderer.initialize(progress);if(currentAttempt!==attempt||failed)return;
    r.quality=(get('quality')as HTMLSelectElement).value as 'low'|'medium'|'high';r.sunElevation=Number((get('sun')as HTMLInputElement).value);
    building=new BuildingController(camera,world,r);progress('Loading saved builds');await building.initialize();if(currentAttempt!==attempt||failed)return;
    stream=new TerrainStream(config,r.profiler.enabled);stream.update(camera.position[0],camera.position[2],r.distance);
    get('status').textContent='Preparing';progress('Preparing the shoreline…');
    const c=camera,s=stream,b=building;
    if(import.meta.env.DEV)(window as any).__island={renderer:r,camera:c,player:c.character,stream:s,world,descriptor,building:b,perf:r.profiler,get failed(){return failed;}};
    let last=performance.now(),lastStream=-Infinity,lastUI=0,fps=0,respawns=0,noteUntil=0;
    const frame=(now:number)=>{
      if(failed||currentAttempt!==attempt)return;
      try {
        const interval=now-last,dt=interval/1000;last=now;r.profiler.begin(interval);
        let stage=r.profiler.mark();c.update(dt);r.profiler.endStage('player',stage);stage=r.profiler.mark();fps=fps*.9+1/Math.max(dt,.001)*.1;
        b.update(dt);r.profiler.endStage('building',stage);stage=r.profiler.mark();
        if(now-lastStream>350) {s.update(c.position[0],c.position[2],r.distance);lastStream=now;}
        r.profiler.endStage('streaming',stage);
        if(s.error)throw new Error(s.error);
        r.render(c,s,now/1000);
        const player=c.character;
        if(player.respawns!==respawns){respawns=player.respawns;noteUntil=now+4500;get('respawn-note').textContent='Out of oxygen — returned to shore';}
        if(now>noteUntil)get('respawn-note').textContent='';
        get('oxygen').setAttribute('aria-valuenow',player.oxygen.toFixed(1));get('oxygen-time').textContent=`${Math.ceil(player.oxygen)}s`;
        document.querySelectorAll<HTMLElement>('.bubble').forEach((bubble,i)=>bubble.style.setProperty('--fill',String(Math.max(0,Math.min(1,player.oxygen/10-i)))));
        get('stamina').style.setProperty('--fill',String(player.stamina/100));get('stamina').setAttribute('aria-valuenow',player.stamina.toFixed(1));
        get('stamina-state').textContent=player.exhausted?'Exhausted':player.swimming?'Swimming':'';
        document.querySelector('.vitals')!.classList.toggle('low-oxygen',player.oxygen<15);
        if(c.character.ready&&!failed)overlay.classList.add('hidden');
        if(now-lastUI>300) {
          lastUI=now;get('status').textContent=c.character.ready?'Exploring':'Preparing';get('fps').textContent=`${Math.round(fps)} fps`;
          const sample=world.sample(c.position[0],c.position[2]),water=world.water.sample(c.position[0],c.position[2]);
          get('biome').textContent=water&&water.bank>.6?water.kind==='lake'?'Inland lake':'Flowing stream'
            :sample.height<0?'Ocean shore':sample.height<7?'Sandy coast':sample.weights[3]>.45?'Rocky highlands':sample.forest>.5?'Temperate forest':'Open grassland';
        }
        if(r.profiler.enabled)r.profiler.finish(r.resources);animation=requestAnimationFrame(frame);
      }catch(error){fail(error instanceof Error?error.message:String(error));}
    };
    animation=requestAnimationFrame(frame);
  }catch(error){if(currentAttempt===attempt)fail(error instanceof Error?error.message:String(error));}
}
get('retry').addEventListener('click',()=>void start(),{signal:events.signal});
document.querySelector('.panel-head')!.addEventListener('click',()=>{
  const collapsed=document.querySelector('.panel')!.classList.toggle('collapsed');
  document.querySelector('.panel-head')!.setAttribute('aria-expanded',String(!collapsed));get('collapse').textContent=collapsed?'+':'−';
},{signal:events.signal});
get('sun').addEventListener('input',e=>{const angle=Number((e.target as HTMLInputElement).value);if(renderer)renderer.sunElevation=angle;get('sun-value').textContent=`${angle}°`;},{signal:events.signal});
get('quality').addEventListener('change',e=>{const quality=(e.target as HTMLSelectElement).value as Quality;if(renderer)renderer.quality=quality;get('quality-description').textContent=qualityDescriptions[quality];},{signal:events.signal});
document.addEventListener('pointerlockchange',()=>app.classList.toggle('locked',document.pointerLockElement===canvas),{signal:events.signal});
window.addEventListener('pagehide',()=>{dispose();events.abort();},{signal:events.signal});
if(import.meta.hot)import.meta.hot.dispose(()=>{attempt++;dispose();events.abort();});
void start();
