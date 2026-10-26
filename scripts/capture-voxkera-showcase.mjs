/** Actual browser captures, with owned servers and recorded provenance. No generated mockups. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer, preview } from 'vite';
import { chromium } from 'playwright';
import gate from './png-visual-gate.cjs';
const tower=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const engine=path.resolve(tower,'../Voxkera');
const output=path.join(engine,'docs/media/showcase');fs.mkdirSync(output,{recursive:true});
const manifest={capturedAt:new Date().toISOString(),backend:'WebGL / SwiftShader',viewport:{width:1600,height:900},captures:[]};
const installed='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser=await chromium.launch({headless:true,executablePath:process.env.TOWER_CHROME||(process.platform==='win32'&&fs.existsSync(installed)?installed:undefined),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
let lab,example;
const errors=[];
try {
  const page=await browser.newPage({viewport:manifest.viewport});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('requestfailed',request=>errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
  async function frames(diagnostics) {
    const start=await page.evaluate(name=>window[name]().frames,diagnostics);
    await page.waitForFunction(({name,start})=>{const d=window[name]?.();return d&&d.ready&&d.frames>start+5&&d.activeMeshes>1;},{name:diagnostics,start},{timeout:60_000});
  }
  async function capture(filename,title,workspace,diagnostics,packageApis) {
    if(workspace===engine)await page.locator('aside').evaluate(element=>{element.scrollTop=0;});
    await frames(diagnostics);
    const box=await page.locator('canvas').boundingBox(),canvas=await page.locator('canvas').screenshot();
    const visual=gate.visualGate(canvas,box);
    const bytes=await page.screenshot({path:path.join(output,filename),animations:'disabled'});
    const stats=await page.evaluate(name=>window[name](),diagnostics);
    manifest.captures.push({filename,title,testedWorkspace:workspace,url:page.url(),packageApis,visual,stats,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
    console.log(`CAPTURE ${filename}: ${visual.foreground} non-background canvas pixels`);
  }
  example=await preview({root:path.join(engine,'examples/character'),configFile:false,logLevel:'silent',preview:{host:'127.0.0.1',port:0,strictPort:true,open:false}});
  await page.goto(`http://127.0.0.1:${example.httpServer.address().port}/`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.body.dataset.characterReady==='warden');
  await page.locator('#character-play').uncheck();
  await page.locator('#character-clip').selectOption('salute');
  await page.locator('#character-time').fill('0.5');await page.locator('#character-time').dispatchEvent('input');
  await page.locator('#character-socket').selectOption('weapon');await page.locator('#character-equip').click();
  await page.waitForFunction(()=>document.body.dataset.equipmentReady==='rune-sword');
  await capture('character-attachments.png','Character recipe, articulated pose and socket-mounted equipment',engine,'__voxkeraDiagnostics',['engine-recipe','voxel-core','voxel-babylon']);
  await page.locator('#character-fixture').selectOption('lantern-beetle');
  await page.waitForFunction(()=>document.body.dataset.characterReady==='lantern-beetle');
  await capture('character-creature.png','Non-humanoid character recipe and independent material regions',engine,'__voxkeraDiagnostics',['engine-recipe','voxel-core','voxel-babylon']);
  await page.goto('about:blank');
  lab=await createServer({root:path.join(tower,'packages/voxel-lab'),configFile:false,logLevel:'silent',server:{host:'127.0.0.1',port:0,strictPort:true,open:false,fs:{allow:[tower]}}});await lab.listen();
  await page.goto(`http://127.0.0.1:${lab.httpServer.address().port}/#material`,{waitUntil:'networkidle'});
  await page.locator('#material-layout').waitFor();await page.locator('#material-layout').selectOption('court');
  await capture('materials-courtyard.png','Procedural masonry, recessed joints, light and emissive regions',tower,'__labDiagnostics',['voxel-core','voxel-babylon']);
  await page.locator('#tab-ritual').click();
  await page.waitForFunction(()=>document.body.dataset.sceneReady==='ritual'&&window.__ritualReady);
  await capture('scene-kit-ritual.png','Instanced scene kit with PBR materials, emitters and shadows; Tower-authored fixture',tower,'__labDiagnostics',['engine-scene','scene-babylon','voxel-babylon']);
  await page.locator('#tab-greedy').click();await page.locator('#greedy-mode').waitFor();
  await page.locator('#greedy-model').selectOption('tower:arcane');
  // Frame the normalized one-unit model through the actual orbit-camera input.
  await page.mouse.move(600,420);
  for(let step=0;step<4;step++){await page.mouse.wheel(0,-600);await page.waitForTimeout(100);}
  await capture('greedy-meshing.png','Greedy meshing and voxel statistics; Tower-authored model',tower,'__labDiagnostics',['voxel-core','voxel-babylon']);
  assert.deepEqual(errors,[],'Capture console/network/runtime errors');
  fs.writeFileSync(path.join(output,'lab-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
} catch(error) {
  fs.writeFileSync(path.join(output,'capture-errors.json'),JSON.stringify({error:String(error),errors},null,2));throw error;
} finally {await browser.close();await lab?.close();if(example)await new Promise(resolve=>example.httpServer.close(resolve));}
