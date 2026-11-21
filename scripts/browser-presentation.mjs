import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,firefox,webkit} from 'playwright';
const engine=process.env.BROWSER||'chromium';assert.ok(['chromium','firefox','webkit'].includes(engine));
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4182','--strictPort'],{stdio:'pipe'});
let browser;const results=[],measurements=[],errors=[];let current='startup';
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Preview timeout')),20000);server.stdout.on('data',b=>{if(b.toString().includes('4182')){clearTimeout(timer);resolve();}});server.on('error',reject);server.once('exit',code=>reject(Error('Preview exited '+code)));});
 const root='artifacts/presentation-'+engine;await mkdir(root,{recursive:true});browser=await ({chromium,firefox,webkit})[engine].launch({headless:true});
 const check=(value,label)=>{assert.ok(value,label);results.push(label);};
 for(const dpr of [1,2,3]){
  const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:dpr}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  current='fixture loading DPR '+dpr;await page.goto('http://127.0.0.1:4182/presentation-fixture.html');await page.waitForFunction(()=>window.fixture?.ready);
  const set=spec=>page.evaluate(spec=>window.fixture.setCase(spec),spec);
  let m=await set({});check(m.status==='sprite','DPR '+dpr+' loads PNG sprite');check(m.textures===1,'DPR '+dpr+' shared atlas registered once');check(m.canvas.width===960&&m.canvas.height===640,'DPR '+dpr+' logical canvas unchanged');
  for(const facing of ['n','ne','e','se','s','sw','w','nw']){m=await set({facing});check(m.pose.facing===facing&&m.body.flipX===['sw','w','nw'].includes(facing),'DPR '+dpr+' facing '+facing);check(m.body.originX===.5&&m.body.originY===.875,'DPR '+dpr+' pivot '+facing);check(m.pose.hand[0]===(m.body.flipX?18:46),'DPR '+dpr+' mirrored attachment '+facing);}
  for(const clip of ['idle','move','jump.takeoff','jump.ascent','jump.apex','jump.descent','land','ground.light_1','ground.light_2','ground.light_3','ground.heavy','ground.finisher','air.light','air.heavy','block.startup','block.hold','block.stun','block.release','guard.break','guard.recover','hit.react','hit.stun','knockback','special.power','special.dash','special.projectile','ko','victory']){
   m=await set({clip});check(m.status==='sprite'&&m.pose.clip===clip,'DPR '+dpr+' '+clip+' maps to sprite');check(m.body.originY===.875&&m.shadow.y===300,'DPR '+dpr+' stable anchor '+clip);
  }
  current='phase boundaries DPR '+dpr;
  for(const [clip,s,a,r] of [['ground.light_1',5,3,10],['ground.light_2',5,3,11],['ground.light_3',7,3,14],['ground.heavy',12,4,20],['ground.finisher',12,4,20],['air.light',7,4,14],['air.heavy',10,4,20],['special.power',15,4,24],['special.dash',9,8,22],['special.projectile',18,1,20]])for(const [frame,phase] of [[1,'startup'],[s,'startup'],[s+1,'active'],[s+a,'active'],[s+a+1,'recovery'],[s+a+r,'recovery']]){m=await set({clip,frame});check(m.pose.phase===phase,'DPR '+dpr+' '+clip+' frame '+frame+' '+phase);}
  const ground=await set({x:20,y:50}),air=await set({x:20,y:50,z:80,clip:'jump.ascent'});check(air.body.y===ground.body.y-80&&air.shadow.y===ground.shadow.y&&air.pose.depth===ground.pose.depth,'DPR '+dpr+' jump projection and depth');
  check(air.shadow.scale<ground.shadow.scale,'DPR '+dpr+' grounded shadow shrinks');
  await set({clip:'ground.heavy',frame:13});m=await set({clip:'hit.react'});check(m.pose.clip==='hit.react','DPR '+dpr+' interrupt replaces active attack');
  await set({clip:'victory',age:16});await page.screenshot({path:root+'/victory-dpr'+dpr+'.png'});
  const children=m.children;for(let i=0;i<3;i++){await page.evaluate(()=>window.fixture.restart());await page.waitForFunction(()=>window.fixture.ready);}
  m=await page.evaluate(()=>window.fixture.measure());check(m.children===children&&m.textures===1,'DPR '+dpr+' restart has no object/texture growth');
  check(await page.evaluate(()=>window.fixture.fillEffects())===32,'DPR '+dpr+' effects capped at 32');
  measurements.push({dpr,...await page.evaluate(()=>window.fixture.benchmark())});
  if(dpr===1){
   current='fallback demonstrations';
   await page.route('**/missing-manifest.json',route=>route.fulfill({status:404,body:'missing'}));let r=await page.evaluate(()=>window.fixture.load('/missing-manifest.json'));check(!r.ok,'missing manifest reports failure');m=await page.evaluate(()=>window.fixture.measure());check(m.status==='geometric'&&!m.body.visible,'missing manifest draws geometric fallback');await page.screenshot({path:root+'/fallback-missing-manifest.png'});
   await page.route('**/invalid-manifest.json',async route=>{const response=await page.request.get('http://127.0.0.1:4182/assets/characters/synthetic/v1/manifest.json'),m=await response.json();m.pivot=[0,0];await route.fulfill({json:m});});r=await page.evaluate(()=>window.fixture.load('/invalid-manifest.json'));check(!r.ok&&/pivot/.test(r.reason),'invalid manifest rejected before sprite use');
   await page.route('**/missing-page-manifest.json',async route=>{const response=await page.request.get('http://127.0.0.1:4182/assets/characters/synthetic/v1/manifest.json'),m=await response.json();m.id='missing-page';m.pages[0].image='missing-atlas.png';await route.fulfill({json:m});});await page.route('**/missing-atlas.png',route=>route.fulfill({status:404,body:'missing'}));r=await page.evaluate(()=>window.fixture.load('/missing-page-manifest.json'));check(!r.ok,'missing PNG page falls back');
   r=await page.evaluate(()=>window.fixture.load('/assets/characters/synthetic/v1/manifest.json'));check(r.ok,'valid assets restore sprite after fallback');await set({facing:'nw',clip:'special.power',frame:16});await page.screenshot({path:root+'/sprite-mirrored-power.png'});
   await page.evaluate(()=>window.fixture.missingFrame());m=await page.evaluate(()=>window.fixture.measure());check(m.status==='geometric','missing registered frame falls back');
  }
  await context.close();
 }
 current='shipped game integration';const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4182');await page.locator('canvas[data-character-asset="ready"]').waitFor();check((await page.locator('canvas').getAttribute('data-animations')).includes('idle'),'game uses manifest-driven idle sprites');await page.getByRole('button',{name:/Start Game/}).click();await page.waitForTimeout(3300);check(await page.locator('.match-ui').getAttribute('data-state')==='Fighting','sprite game retains countdown/input flow');await page.getByRole('button',{name:'Controls / Help',exact:true}).click();const paused=await page.locator('canvas').getAttribute('data-animations');await page.waitForTimeout(150);check(await page.locator('canvas').getAttribute('data-animations')===paused,'help freezes animation clock');await page.screenshot({path:root+'/game-help.png'});await context.close();
 check(errors.length===0,'no uncaught browser errors');await writeFile(root+'/results.json',JSON.stringify({engine,checks:results.length,results,measurements},null,2));console.log(engine+' presentation checks passed: '+results.length);console.log(JSON.stringify(measurements));
}catch(error){console.error('Failed at '+current,error);throw error;}finally{await browser?.close();server.kill();}
