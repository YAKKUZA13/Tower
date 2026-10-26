const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
require('./check-voxkera-artifacts.cjs');
const root=path.resolve(__dirname,'..'),sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'tower-voxkera-consumer-'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'vendor/voxkera/manifest.json'),'utf8'));
const rootPackage=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const rootDependencies={...rootPackage.dependencies,...rootPackage.devDependencies};
const specs=manifest.packages.map(p=>rootDependencies[p.name].startsWith('file:')?path.join(root,'vendor/voxkera',p.filename):`${p.name}@${rootDependencies[p.name]}`);
if(!process.env.npm_execpath)throw new Error('Run npm run smoke:engine:consumer');
function run(args){const result=spawnSync(process.execPath,args,{cwd:sandbox,encoding:'utf8',windowsHide:true,timeout:180_000});if(result.status!==0)throw new Error(result.stdout+'\n'+result.stderr+(result.error??''));return result.stdout;}
let ok=false;
try {
  fs.writeFileSync(path.join(sandbox,'package.json'),JSON.stringify({name:'tower-vendored-engine-consumer',private:true,type:'module'}));
  run([process.env.npm_execpath,'install','--ignore-scripts','--no-audit','--no-fund','--save-exact',...specs,'@babylonjs/core@7.54.3','typescript@6.0.3']);
  for(const p of manifest.packages)assert.ok(!fs.lstatSync(path.join(sandbox,'node_modules',p.name)).isSymbolicLink());
  for(const [from,to]of [['voxkera-pack-runtime.mjs','runtime.mjs'],['voxkera-pack-types.mts','types.mts'],['voxkera-pack-pure-types.mts','pure-types.mts']])fs.copyFileSync(path.join(__dirname,'fixtures',from),path.join(sandbox,to));
  console.log(run(['runtime.mjs']).trim());
  for(const [mode,skip,file]of [['NodeNext','false','pure-types.mts'],['Bundler','true','types.mts']]) {
    run([path.join(sandbox,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck',skip,'--module',mode==='NodeNext'?'NodeNext':'ESNext','--moduleResolution',mode,'--target','ES2022','--lib','ES2022,DOM,DOM.Iterable',file]);
    console.log(`PASS vendored types: ${mode}, skipLibCheck=${skip}`);
  }
  ok=true;console.log('PASS six pinned Tower engine packages in an isolated consumer, no engine sources or tsx');
} finally {
  if(ok&&process.env.KEEP_ENGINE_CONSUMER!=='1') {
    const actual=fs.realpathSync(sandbox),parent=fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('tower-voxkera-consumer-'));assert.ok(!fs.lstatSync(sandbox).isSymbolicLink());
    fs.rmSync(actual,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  } else console.log(`Consumer retained: ${sandbox}`);
}
