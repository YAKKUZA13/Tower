/** Serve the production build strictly below a project prefix, without SPA fallbacks. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import gate from './png-visual-gate.cjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dist=path.join(root,'client/dist');
const prefix=process.env.TOWER_BASE||'/tower-test/';
assert.ok(prefix.startsWith('/')&&prefix.endsWith('/')&&prefix!=='/','Use a project base, such as /tower-test/');
assert.ok(fs.readFileSync(path.join(dist,'index.html'),'utf8').includes(prefix+'assets/'),'Build first with the same TOWER_BASE');
const requests=[],errors=[];
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm'};
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');requests.push(url.pathname);
  if(!url.pathname.startsWith(prefix)){res.writeHead(404);res.end('Outside project base');return;}
  const relative=decodeURIComponent(url.pathname.slice(prefix.length))||'index.html';
  const file=path.resolve(dist,relative);
  if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,installed='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
let browser;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.TOWER_CHROME||(process.platform==='win32'&&fs.existsSync(installed)?installed:undefined),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1600,height:900}});
  await page.addInitScript(()=>{localStorage.setItem('authToken','stale-account');localStorage.setItem('authUser',JSON.stringify({userId:'old',login:'old',username:'Old account',defaultRole:'player'}));});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('requestfailed',request=>errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
  page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith(origin+'/'))errors.push(`External/backend request: ${request.url()}`);});
  const captures=[];fs.mkdirSync(path.join(root,'artifacts/pages'),{recursive:true});
  for(const [index,map]of ['rts-2p-crossroads','rts-3p-trident','rts-4p-quadrants'].entries()) {
    await page.goto(origin+prefix+(index?'?map='+map:''),{waitUntil:'networkidle'});
    await page.waitForFunction(()=>parseInt(document.querySelector('.hp-text')?.textContent||'0')>0,null,{timeout:60_000});
    assert.equal(await page.locator('.auth-shell').count(),0,'Pages must start RTS without login');
    assert.equal(await page.locator('.app-nav').getByText('Co-op лобби').count(),0);
    await page.waitForTimeout(1200);
    const canvas=page.locator('.rts-canvas'),box=await canvas.boundingBox(),bytes=await canvas.screenshot();
    const visual=gate.visualGate(bytes,box);fs.writeFileSync(path.join(root,'artifacts/pages',`${map}.png`),bytes);
    captures.push({map,visual});console.log(`PASS Pages production: ${map}, ${visual.foreground} visible canvas pixels`);
  }
  await page.getByRole('button',{name:'RTS соло',exact:true}).click();
  await page.locator('.rts-lobby').waitFor();
  await page.locator('.rts-lobby').getByRole('button',{name:'Назад'}).click();
  await page.waitForFunction(()=>parseInt(document.querySelector('.hp-text')?.textContent||'0')>0,null,{timeout:60_000});
  await page.waitForLoadState('networkidle');
  assert.ok(requests.includes(prefix+'catalog/manifest.json'),'Catalog must resolve below repository prefix');
  assert.ok(requests.some(p=>p.startsWith(prefix+'recipes/')),'Recipe assets must resolve below repository prefix');
  assert.deepEqual(errors,[],'Pages console/network/runtime checks');
  fs.writeFileSync(path.join(root,'artifacts/pages/report.json'),JSON.stringify({ok:true,testedWorkspace:root,base:prefix,server:'strict static file server; no API or Vite fallback',captures,requests,errors},null,2)+'\n');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
