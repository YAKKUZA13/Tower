/** Explicit transport switch; never publishes or imports a sibling source checkout. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,''));
const args=process.argv.slice(2),mode=args[0],dry=args.includes('--dry-run');
assert.ok(['registry','vendor'].includes(mode),'Usage: npm run engine:source -- registry --version 0.1.0 [--dry-run], or vendor');
const versionIndex=args.indexOf('--version'),version=versionIndex<0?undefined:args[versionIndex+1];
if(mode==='registry')assert.ok(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version??''),'Supply an exact --version');
const manifest=read('vendor/voxkera/manifest.json'),pkg=read('package.json');
const updates=[];
for(const dir of ['',...pkg.workspaces]) {
  const file=dir?`${dir}/package.json`:'package.json',m=read(file);
  for(const field of ['dependencies','devDependencies'])for(const name of Object.keys(m[field]??{}))if(name.startsWith('@voxkera/')) {
    const entry=manifest.packages.find(p=>p.name===name);assert.ok(entry);
    const value=mode==='registry'?version:'file:'+path.relative(path.join(root,dir),path.join(root,'vendor/voxkera',entry.filename)).split(path.sep).join('/');
    updates.push({file,field,name,from:m[field][name],to:value});m[field][name]=value;
  }
}
console.log(JSON.stringify({mode,version,dryRun:dry,updates},null,2));
if(dry)process.exit(0);
if(!process.env.npm_execpath)throw new Error('Run through npm run engine:source');
function npm(args){const result=spawnSync(process.execPath,[process.env.npm_execpath,...args],{cwd:root,encoding:'utf8',windowsHide:true,timeout:180_000});if(result.status!==0)throw new Error(result.stderr+'\n'+result.stdout+(result.error??''));return result.stdout;}
// Fail before modifying manifests if any of the six versions is not published yet.
if(mode==='registry')for(const entry of manifest.packages)assert.equal(JSON.parse(npm(['view',`${entry.name}@${version}`,'version','--json','--registry=https://registry.npmjs.org/'])),version);
for(const file of [...new Set(updates.map(u=>u.file))]) {
  const m=read(file);for(const update of updates.filter(u=>u.file===file))m[update.field][update.name]=update.to;
  fs.writeFileSync(path.join(root,file),JSON.stringify(m,null,2)+'\n');
}
// The local tarball and registry can share a version. npm install otherwise
// retains the old resolved URL/integrity because that version still satisfies
// the new spec. Resolve only the engine records again, ignoring node_modules,
// then install the resulting lock exactly. Keep every other dependency pinned.
const lock=read('package-lock.json');
for(const key of Object.keys(lock.packages))if(manifest.packages.some(entry=>key===`node_modules/${entry.name}`||key.endsWith(`/node_modules/${entry.name}`)))delete lock.packages[key];
fs.writeFileSync(path.join(root,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');
process.stdout.write(npm(['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org/']));
process.stdout.write(npm(['ci','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org/']));
const check=spawnSync(process.execPath,[path.join(__dirname,'check-voxkera-artifacts.cjs')],{cwd:root,stdio:'inherit',windowsHide:true});
if(check.status!==0)process.exit(check.status??1);
