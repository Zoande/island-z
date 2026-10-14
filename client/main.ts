import {apiURL} from './api';
import {MultiplayerClient} from './multiplayer';
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
import {DaylightClock,daylightLighting} from '../shared/daylight';
import {InventoryController} from './inventory';

const canvas=document.querySelector<HTMLCanvasElement>('#world')!;
const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=`
  <div class="masthead"><div class="mark">IZ</div><div><div class="brand">ISLAND Z</div><div class="subtitle">FIRST PERSON / ISLAND EXPLORER</div></div></div>
  <div class="status-pill" role="status" aria-live="polite" data-tooltip=" " data-tooltip-title="World connection" data-tooltip-detail="Connection status updates as the world loads or reconnects."><span class="dot"></span><span id="status">Connecting</span></div>
  <section class="panel collapsed" aria-label="Settings"><button class="panel-head" aria-expanded="false" aria-controls="settings-body" data-tooltip=" " data-tooltip-title="Settings & controls" data-tooltip-detail="Adjust the island lighting and render quality. Expand this panel to see movement controls."><span>Settings & controls</span><span id="collapse" aria-hidden="true">+</span></button>
    <div class="panel-body" id="settings-body"><hr class="rule"/>
    <div class="meta-row"><label>Frame rate</label><span id="fps" class="value">—</span></div>
    <div class="meta-row" id="network-debug" hidden><label>Network</label><span id="network-stats" class="value"></span></div>
    <div class="field"><label for="daylight-time">Time of day <span id="daylight-value">09:00</span></label><input id="daylight-time" type="range" min="0" max="23.983333" step="0.016666667" value="9" aria-label="Time of day" aria-describedby="daylight-help" data-tooltip=" " data-tooltip-title="Set the island time" data-tooltip-detail="Choose any time from midnight to 11:59 PM. Turn off the natural cycle to hold the selected lighting."/></div>
    <label class="cycle-toggle" data-tooltip=" " data-tooltip-title="Natural day/night cycle" data-tooltip-detail="The island completes a full day and night on its own. Turn this off to keep your chosen time."><input id="daylight-auto" type="checkbox" checked/> Natural day/night cycle</label>
    <div class="daylight-presets" aria-label="Time presets"><button type="button" data-hour="6.5" aria-label="Set time to dawn" data-tooltip=" " data-tooltip-title="Dawn" data-tooltip-detail="Set the island to 6:30 AM.">Dawn</button><button type="button" data-hour="12" aria-label="Set time to noon" data-tooltip=" " data-tooltip-title="Noon" data-tooltip-detail="Set the island to 12:00 PM.">Noon</button><button type="button" data-hour="0" aria-label="Set time to night" data-tooltip=" " data-tooltip-title="Night" data-tooltip-detail="Set the island to 12:00 AM.">Night</button></div>
    <p id="daylight-help" class="setting-note">3-hour day · 1½-hour night. Set a time or pause the cycle.</p>
    <div class="meta-row field"><label for="quality">Render quality</label><select id="quality" data-tooltip=" " data-tooltip-title="Render quality" data-tooltip-detail="${qualityDescriptions.low}"><option value="low" selected>Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
    <p id="quality-description" class="setting-note">${qualityDescriptions.low}</p>
    <div class="controls"><span><kbd>W A S D</kbd>Move / swim</span><span><kbd>SPACE</kbd>Jump / swim up</span><span><kbd>SHIFT</kbd>Sprint / dive</span><span><kbd>MOUSE</kbd>Look / steer</span><span><kbd>C</kbd>Tap crouch / stand · Hold crawl</span><span><kbd>ESC</kbd>Release mouse</span></div>
    </div></section>
  <div class="caption"><div id="biome" class="biome">Coastal grassland</div></div>
  <div class="vitals" aria-label="Player vitals"><div class="vital-label"><span>Oxygen</span><span id="oxygen-time">60s</span></div><div id="oxygen" class="oxygen" role="progressbar" aria-label="Oxygen" aria-valuemin="0" aria-valuemax="60" aria-valuetext="60 seconds available" data-tooltip=" " data-tooltip-title="Oxygen" data-tooltip-detail="Available breath while underwater. Reach the surface before it runs out.">${Array.from({length:6},()=>'<i class="bubble"></i>').join('')}</div><div class="vital-label"><span>Stamina</span><span id="stamina-state"></span></div><div id="stamina" class="stamina" role="progressbar" aria-label="Stamina" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100" aria-valuetext="100 percent" data-tooltip=" " data-tooltip-title="Stamina" data-tooltip-detail="Used while sprinting. Slow down to recover."><i></i></div></div>
  <div id="respawn-note" class="respawn-note" role="status" aria-live="assertive"></div>
  <div class="building-hud"><div id="build-hint" class="build-hint" role="status"></div><div id="build-controls" class="build-controls" hidden>Left click place · Wheel fine rotate · T turn 90°</div><nav id="hotbar" class="hotbar" aria-label="Building hotbar"></nav></div>
  <div class="play-hint">Click the landscape to explore</div><div class="reticle" aria-hidden="true"></div>
  <div class="overlay" id="overlay"><div class="eyebrow">A world from a seed</div><h1 id="overlay-title">Finding the island</h1><p id="message">Connecting to the world server…</p><div class="loading-line" id="loading-line"></div><button id="retry" hidden>Retry</button></div>`;
const get=(id:string)=>document.getElementById(id)!;
const vitalsUI={oxygen:get('oxygen'),oxygenTime:get('oxygen-time'),bubbles:[...document.querySelectorAll<HTMLElement>('.bubble')],stamina:get('stamina'),staminaState:get('stamina-state'),root:document.querySelector<HTMLElement>('.vitals')!};
get('network-debug').hidden=!new URLSearchParams(location.search).has('netdebug');
const overlay=get('overlay');
const clockNow=()=>Date.now()/1000;
const daylightStorage='island-z-daylight-v1';
let savedDaylight:unknown;try{savedDaylight=JSON.parse(localStorage.getItem(daylightStorage)??'null');}catch{}
const daylight=new DaylightClock(clockNow(),savedDaylight);
function saveDaylight(){try{localStorage.setItem(daylightStorage,JSON.stringify(daylight.snapshot(clockNow())));}catch{}}
function daylightUI() {
  const hour=daylight.hour(clockNow()),minutes=Math.floor(hour*60)%1440;
  get('daylight-value').textContent=`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')} · ${daylightLighting(hour).label}`;
  (get('daylight-time')as HTMLInputElement).value=String(hour);(get('daylight-auto')as HTMLInputElement).checked=daylight.automatic;
}
saveDaylight();daylightUI();
let renderer:IslandRenderer|undefined,stream:TerrainStream|undefined,camera:PlayerCamera|undefined,building:BuildingController|undefined;
let multiplayer:MultiplayerClient|undefined,inventory:InventoryController|undefined;
let animation=0,attempt=0,failed=false;
const events=new AbortController();
function fail(message:string) {
  if(failed)return;failed=true;cancelAnimationFrame(animation);
  get('overlay-title').textContent='The viewer needs attention';get('message').textContent=message;
  get('loading-line').hidden=true;get('retry').hidden=false;overlay.classList.remove('hidden');get('status').textContent='Paused';
  if(document.pointerLockElement===canvas)document.exitPointerLock();
}
function dispose() {cancelAnimationFrame(animation);inventory?.dispose();inventory=undefined;multiplayer?.dispose();multiplayer=undefined;building?.dispose();camera?.dispose();stream?.dispose();renderer?.dispose();building=undefined;camera=undefined;stream=undefined;renderer=undefined;}
async function start() {
  const currentAttempt=++attempt;dispose();failed=false;overlay.classList.remove('hidden');
  get('overlay-title').textContent='Finding the island';get('retry').hidden=true;get('loading-line').hidden=false;
    const progress=(message:string)=>{if(currentAttempt===attempt)get('message').textContent=message;};
  try {
    progress('Connecting to the world server…');
    let response:Response;
    try {response=await fetch(apiURL('/api/world'),{signal:AbortSignal.timeout(6000),cache:'no-store'});}
    catch {throw new Error('Cannot reach the world server. Start npm run server in another terminal, then retry.');}
    if(!response.ok)throw new Error('The world server did not return a world. Start npm run server and check its terminal output.');
    const descriptor=await response.json()as WorldDescriptor,config=parseWorldConfig(descriptor);
    if(descriptor.generatorVersion!==GENERATOR_VERSION)throw new Error('Client and server generator versions differ. Restart both development processes and refresh.');
    const world=new WorldGenerator(config);
    renderer=new IslandRenderer(canvas,config,world);renderer.onFatal=fail;
    const r=renderer;
    if(new URLSearchParams(location.search).has('profile'))r.profiler.start();
    camera=new PlayerCamera(canvas,{surface:(x,z)=>r.collisionSurface(x,z),colliders:(x,z)=>r.playerColliders(x,z),water:(x,z)=>world.surfaceWater(x,z,performance.now()/1000),solidMovement:undefined});
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
    r.quality=(get('quality')as HTMLSelectElement).value as 'low'|'medium'|'high';r.daylightHour=daylight.hour(clockNow());
    multiplayer=new MultiplayerClient(config,camera,r);progress('Joining the world');await multiplayer.ready;building=new BuildingController(camera,world,r,multiplayer.transport);building.network=multiplayer;multiplayer.attach(building);progress('Loading saved builds');await building.initialize();if(currentAttempt!==attempt||failed)return;
    const network=multiplayer,controller=building;
    controller.select(network.selectedSlot);
    inventory=new InventoryController(camera,{getInventory:()=>network.inventory,getSelected:()=>controller.selected,select:slot=>controller.select(slot),isConnected:()=>network.connected,
      craft:async(recipeId,stationId)=>{const result=await network.command('craft',{requestId:crypto.randomUUID(),recipeId,stationId});if(!result.ok)throw new Error(result.error??'Crafting could not be completed');return result;},
      move:async(from,to)=>{const result=await network.command('move',{requestId:crypto.randomUUID(),from,to});if(!result.ok)throw new Error(result.error??'Items could not be moved');return result;},
      bandage:async(part,from)=>{const result=await network.command('bandage',{requestId:crypto.randomUUID(),part,from});if(!result.ok)throw new Error(result.error??'Treatment could not be completed');return {ok:true};},
      onOpenChange:open=>{controller.menuOpen=open;controller.update(0);},
    });inventory.update(network.inventory,camera.character.health);
    stream=new TerrainStream(config,r.profiler.enabled);stream.update(camera.position[0],camera.position[2],r.distance);
    get('status').textContent='Preparing';progress('Preparing the shoreline…');
    const c=camera,s=stream,b=building;
    if(import.meta.env.DEV)(window as any).__island={renderer:r,camera:c,player:c.character,stream:s,world,descriptor,building:b,multiplayer,inventory,daylight,perf:r.profiler,get failed(){return failed;}};
    let last=performance.now(),lastStream=-Infinity,lastUI=0,fps=0,respawns=0,noteUntil=0;
    const frame=(now:number)=>{
      if(failed||currentAttempt!==attempt)return;
      try {
        const interval=now-last,dt=interval/1000;last=now;r.profiler.begin(interval);
        let stage=r.profiler.mark();multiplayer!.update();r.profiler.endStage('player',stage);stage=r.profiler.mark();fps=fps*.9+1/Math.max(dt,.001)*.1;
        b.update(dt);r.profiler.endStage('building',stage);stage=r.profiler.mark();
        inventory!.update(multiplayer!.inventory,c.character.health);
        if(now-lastStream>350) {s.update(c.position[0],c.position[2],r.distance);lastStream=now;}
        r.profiler.endStage('streaming',stage);
        if(s.error)throw new Error(s.error);
        r.daylightHour=daylight.hour(clockNow());r.render(c,s,multiplayer!.worldTime);
        const player=c.character;
        if(player.respawns!==respawns){respawns=player.respawns;noteUntil=now+4500;const cause=player.lastDeathCause;get('respawn-note').textContent=`${cause==='drowning'?'Drowned':cause==='fall'?'Fatal fall':cause==='bleeding'?'Bled out':'Fatal injury'} — returned to shore`;}
        if(now>noteUntil)get('respawn-note').textContent='';
        const oxygenMax=player.oxygenCapacity.toFixed(1),oxygen=player.oxygen.toFixed(1);if(vitalsUI.oxygen.getAttribute('aria-valuemax')!==oxygenMax)vitalsUI.oxygen.setAttribute('aria-valuemax',oxygenMax);if(vitalsUI.oxygen.getAttribute('aria-valuenow')!==oxygen)vitalsUI.oxygen.setAttribute('aria-valuenow',oxygen);
        const oxygenTime=`${Math.ceil(player.oxygen/(player.underwater?player.oxygenDrainRate:1))}s`;if(vitalsUI.oxygenTime.textContent!==oxygenTime)vitalsUI.oxygenTime.textContent=oxygenTime;const oxygenDescription=`${Math.ceil(player.oxygen/(player.underwater?player.oxygenDrainRate:1))} seconds of breath remaining`;if(vitalsUI.oxygen.getAttribute('aria-valuetext')!==oxygenDescription)vitalsUI.oxygen.setAttribute('aria-valuetext',oxygenDescription);
        const oxygenFill=player.oxygen/player.oxygenCapacity*6;vitalsUI.bubbles.forEach((bubble,i)=>{const fill=String(Math.max(0,Math.min(1,oxygenFill-i)));if(bubble.style.getPropertyValue('--fill')!==fill)bubble.style.setProperty('--fill',fill);});
        const staminaFill=String(player.stamina/100),stamina=player.stamina.toFixed(1);if(vitalsUI.stamina.style.getPropertyValue('--fill')!==staminaFill)vitalsUI.stamina.style.setProperty('--fill',staminaFill);if(vitalsUI.stamina.getAttribute('aria-valuenow')!==stamina)vitalsUI.stamina.setAttribute('aria-valuenow',stamina);const staminaDescription=`${Math.round(player.stamina)} percent`;if(vitalsUI.stamina.getAttribute('aria-valuetext')!==staminaDescription)vitalsUI.stamina.setAttribute('aria-valuetext',staminaDescription);
        const staminaState=player.exhausted?'Exhausted':player.swimming?'Swimming':'';if(vitalsUI.staminaState.textContent!==staminaState)vitalsUI.staminaState.textContent=staminaState;
        const lowOxygen=player.oxygen<player.oxygenCapacity*.25;if(vitalsUI.root.classList.contains('low-oxygen')!==lowOxygen)vitalsUI.root.classList.toggle('low-oxygen',lowOxygen);
        if(c.character.ready&&!failed)overlay.classList.add('hidden');
        if(now-lastUI>300) {
          daylightUI();
          lastUI=now;const statusText=!multiplayer!.connected?'Reconnecting':c.character.ready?'Exploring':'Preparing';if(get('status').textContent!==statusText)get('status').textContent=statusText;get('fps').textContent=`${Math.round(fps)} fps`;
          const net=multiplayer!.metrics;get('network-stats').textContent=`${Math.round(net.rtt)} ms / ${net.snapshotHz.toFixed(0)} Hz / ${net.correction.toFixed(2)} m`;
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
window.addEventListener('keydown',e=>{if(e.code!=='KeyE'||e.repeat||!inventory||failed)return;const target=e.target as HTMLElement;if(target.matches('input,textarea,select,[contenteditable="true"]'))return;e.preventDefault();if(inventory.isOpen)inventory.close();else inventory.open(building?.deskTarget?.id);},{signal:events.signal});
document.querySelector('.panel-head')!.addEventListener('click',()=>{
  const collapsed=document.querySelector('.panel')!.classList.toggle('collapsed');
  document.querySelector('.panel-head')!.setAttribute('aria-expanded',String(!collapsed));get('collapse').textContent=collapsed?'+':'−';
},{signal:events.signal});
get('daylight-time').addEventListener('input',e=>{daylight.setHour(Number((e.target as HTMLInputElement).value),clockNow());saveDaylight();daylightUI();},{signal:events.signal});
get('daylight-auto').addEventListener('change',e=>{daylight.setAutomatic((e.target as HTMLInputElement).checked,clockNow());saveDaylight();daylightUI();},{signal:events.signal});
document.querySelectorAll<HTMLButtonElement>('[data-hour]').forEach(button=>button.addEventListener('click',()=>{daylight.setHour(Number(button.dataset.hour),clockNow());saveDaylight();daylightUI();},{signal:events.signal}));
get('quality').addEventListener('change',e=>{const quality=(e.target as HTMLSelectElement).value as Quality;if(renderer)renderer.quality=quality;get('quality-description').textContent=qualityDescriptions[quality];get('quality').dataset.tooltipDetail=qualityDescriptions[quality];},{signal:events.signal});
document.addEventListener('pointerlockchange',()=>app.classList.toggle('locked',document.pointerLockElement===canvas),{signal:events.signal});
window.addEventListener('pagehide',()=>{dispose();events.abort();},{signal:events.signal});
if(import.meta.hot)import.meta.hot.dispose(()=>{attempt++;dispose();events.abort();});
void start();
