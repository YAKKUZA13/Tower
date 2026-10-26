/** Build only the offline RTS client and shared contracts for static hosting. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.env.npm_execpath)throw new Error('Run npm run build:pages');
const base=process.env.TOWER_BASE||'./';
if(base!=='./'&&(!base.startsWith('/')||!base.endsWith('/')||base.startsWith('//')))throw new Error('TOWER_BASE must be ./ or /repository/');
for(const args of [['run','check:engine'],['--workspace','shared','run','build'],['--workspace','client','run','build','--','--mode','pages'],['run','check:bundle']]) {
  const result=spawnSync(process.execPath,[process.env.npm_execpath,...args],{cwd:root,env:{...process.env,TOWER_BASE:base},stdio:'inherit',windowsHide:true,timeout:180_000});
  if(result.status!==0)throw new Error(`Pages build failed: npm ${args.join(' ')}\n${result.error??''}`);
}
fs.writeFileSync(path.join(root,'client/dist/.nojekyll'),'');
console.log(`Static RTS ready: client/dist (base ${base}); no server or database build`);
