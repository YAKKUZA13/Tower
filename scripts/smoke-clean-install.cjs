/** Verifies this working tree as an independent artifact consumer, outside its parent. */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'tower-clean-artifacts-'));
const output=path.join(root,'artifacts/voxkera-migration');fs.mkdirSync(output,{recursive:true});
if(!process.env.npm_execpath)throw new Error('Run npm run smoke:clean-install');
const commands=[];let ok=false;
try {
  for(const name of ['package.json','package-lock.json','client','server','shared','packages','scripts','vendor']) {
    const from=path.join(root,name),to=path.join(sandbox,name);
    fs.cpSync(from,to,{recursive:true,filter:file=>!path.relative(from,file).split(path.sep).some(part=>['node_modules','dist','.git','artifacts'].includes(part)||part.startsWith('.env')||part.endsWith('.log'))});
  }
  assert.ok(!fs.existsSync(path.join(sandbox,'packages/voxel-core')));
  for(const args of [
    ['ci','--ignore-scripts','--no-audit','--no-fund'],
    ['run','typecheck'],['--workspace','shared','run','build'],
    ['run','smoke:content'],['run','smoke:rts'],['run','smoke:rts:browser'],
    ['run','build'],['--workspace','@tower/voxel-lab','run','build'],
  ]) {
    const start=Date.now(),result=spawnSync(process.execPath,[process.env.npm_execpath,...args],{cwd:sandbox,encoding:'utf8',windowsHide:true,timeout:240_000,env:{...process.env,BROWSER:'none'}});
    const log=`clean-${commands.length}.log`;fs.writeFileSync(path.join(output,log),(result.stdout??'')+'\n'+(result.stderr??''));
    commands.push({command:'npm '+args.join(' '),exitCode:result.status,durationMs:Date.now()-start,log});
    if(result.status!==0)throw new Error(`${args.join(' ')} failed; see ${path.join(output,log)}\n${result.error??''}`);
    console.log(`PASS isolated Tower: npm ${args.join(' ')}`);
  }
  ok=true;
} finally {
  fs.writeFileSync(path.join(output,'clean-install-report.json'),JSON.stringify({ok,testedWorkspace:sandbox,engineSourceCopied:false,siblingCheckoutCopied:false,commands},null,2)+'\n');
  if(ok&&process.env.KEEP_TOWER_CLEAN!=='1'){
    const actual=fs.realpathSync(sandbox);assert.equal(path.dirname(actual),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(actual).startsWith('tower-clean-artifacts-'));assert.ok(!fs.lstatSync(actual).isSymbolicLink());
    fs.rmSync(actual,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  } else console.log(`Clean install retained: ${sandbox}`);
}
