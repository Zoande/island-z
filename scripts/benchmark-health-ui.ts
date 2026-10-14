import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const port=4127,origin=`http://127.0.0.1:${port}`;
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'ignore'});
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try {
  for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
  const page=await browser.newPage();
  await page.route('**/health-benchmark',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body><div id="app"></div><script type="module">
    import {createBodyHUD} from '/client/body-diagram.ts';import {getTooltipManager} from '/client/tooltips.ts';import {healthyBody,applyDamage,advanceHealth} from '/shared/health.ts';
    const hud=createBodyHUD(document.querySelector('#app'));let body=applyDamage(healthyBody(),{part:'leftArm',amount:25,bleeding:'moderate'});
    const frames=Array.from({length:6000},()=>{body=advanceHealth(body,1/120);return body;});window.__healthBench={hud,frames,manager:getTooltipManager()};
  </script></body></html>`}));
  await page.goto(`${origin}/health-benchmark`);await page.waitForFunction(()=>!!window.__healthBench);
  const result=await page.evaluate(`(()=>{
    const {hud,frames,manager}=window.__healthBench;
    const run=(start,count)=>{const t=performance.now();for(let i=0;i<count;i++)hud.update(frames[(start+i)%frames.length]);return performance.now()-t;};
    for(let i=0;i<2;i++)run(0,300);
    const samples=Array.from({length:7},(_,i)=>run(i*700,700)/700);samples.sort((a,b)=>a-b);
    const anchor=hud.element.querySelector('[data-part="leftArm"]');anchor.focus();let repositions=0,signatures=0,priorSignature=manager.contentSignature;const originalReposition=manager.reposition.bind(manager),originalRender=manager.render.bind(manager);manager.reposition=function(){repositions++;return originalReposition();};manager.render=function(value){const changed=originalRender(value);if(manager.contentSignature!==priorSignature){signatures++;priorSignature=manager.contentSignature;}return changed;};
    const tooltip=document.querySelector('.game-tooltip');let priorText=tooltip.textContent,tooltipTextChanges=0;
    let layoutReads=0;const original=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){layoutReads++;return original.call(this);};
    for(let i=0;i<1200;i++){hud.update(frames[i%frames.length]);if(tooltip.textContent!==priorText){tooltipTextChanges++;priorText=tooltip.textContent;}}
    Element.prototype.getBoundingClientRect=original;
    return {medianMsPerUpdate:+samples[3].toFixed(5),updatesPerSecond:Math.round(1000/samples[3]),samplesMs:samples.map(x=>+x.toFixed(5)),activeTooltipLayoutReadsPer1200Updates:layoutReads,tooltipTextChanges,repositions,signatureChanges:signatures};
  })()`);
  console.log(JSON.stringify({benchmark:'real Chromium BodyHUD DOM updates; moderate bleed; active tooltip',...(result as Record<string,unknown>)}));
} finally {await browser?.close();vite.kill();await once(vite,'exit').catch(()=>{});}

declare global {interface Window {__healthBench:any}}
