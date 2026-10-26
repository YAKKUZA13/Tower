/** Export the exact vendored artifacts. Engine source now belongs to Voxkera. */
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
require('./check-voxkera-artifacts.cjs');
const root=path.resolve(__dirname,'..');
const rootPackage=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(!rootPackage.devDependencies['@voxkera/voxel-core'].startsWith('file:'))throw new Error('Registry mode: use npm pack with the pinned package versions. vendor/voxkera is the archived fallback.');
if(process.argv.includes('--history'))throw new Error('Source history is no longer exported from Tower. Use the standalone Voxkera repository.');
if(process.argv.includes('--verify')) {
  const result=spawnSync(process.execPath,[path.join(__dirname,'smoke-engine-consumer.cjs')],{cwd:root,stdio:'inherit',windowsHide:true});
  if(result.status!==0)process.exit(result.status??1);
}
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
const output=fs.mkdtempSync(path.join(root,'artifacts','voxkera-artifacts-'));
fs.cpSync(path.join(root,'vendor/voxkera'),output,{recursive:true});
console.log(JSON.stringify({ok:true,output,source:'vendor/voxkera',packages:6,published:false},null,2));
