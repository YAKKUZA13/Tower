/** Tower consumes locked npm artifacts (vendored or registry), never engine sources. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const root=path.resolve(__dirname,'..'),vendor=path.join(root,'vendor/voxkera');
const names=['engine-recipe','engine-terrain','engine-scene','voxel-core','voxel-babylon','scene-babylon'];
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const manifest=read(path.join(vendor,'manifest.json'));
assert.equal(manifest.schemaVersion,1);
assert.deepEqual(manifest.packages.map(p=>p.name).sort(),names.map(n=>`@voxkera/${n}`).sort());
for(const entry of manifest.packages) {
  assert.equal(entry.filename,entry.name.replace('@','').replace('/','-')+'-'+entry.version+'.tgz');
  const bytes=fs.readFileSync(path.join(vendor,entry.filename));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),entry.sha256,`Changed ${entry.filename}`);
  assert.equal('sha512-'+crypto.createHash('sha512').update(bytes).digest('base64'),entry.integrity);
  assert.ok(entry.files.includes('dist/index.js')&&entry.files.includes('dist/index.d.ts'));
  assert.ok(entry.files.every(p=>!p.startsWith('src/')));
}
if(process.argv.includes('--tarballs-only')) {console.log('PASS six vendored tarballs: names, versions, SHA-256 and npm integrity');process.exit(0);}
const pkg=read(path.join(root,'package.json')),lock=read(path.join(root,'package-lock.json'));
const rootSpecs=manifest.packages.map(entry=>({...pkg.dependencies,...pkg.devDependencies})[entry.name]);
const vendored=rootSpecs.every(spec=>typeof spec==='string'&&spec.startsWith('file:'));
const registry=rootSpecs.every(spec=>typeof spec==='string'&&/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(spec));
assert.ok(vendored||registry,'Use one source for all six engine packages: tarballs or exact registry versions');
const expectedVersions=new Map(manifest.packages.map((entry,index)=>[entry.name,vendored?entry.version:rootSpecs[index]]));
for(const name of names) {
  assert.ok(!pkg.workspaces.includes(`packages/${name}`),`Engine is still a Tower workspace: ${name}`);
  assert.ok(!fs.existsSync(path.join(root,'packages',name,'src')),`Engine source remains in Tower: ${name}`);
}
const resolve=createRequire(path.join(root,'package.json')).resolve;
const resolved={};
for(const entry of manifest.packages) {
  const dir=path.join(root,'node_modules',entry.name),actual=fs.realpathSync(dir);
  assert.ok(!fs.lstatSync(dir).isSymbolicLink()&&actual===dir,`Source link/junction: ${entry.name}`);
  resolved[entry.name]=resolve(entry.name);
  assert.equal(resolved[entry.name],path.join(actual,'dist/index.js'));
  const m=read(path.join(dir,'package.json'));assert.equal(m.name,entry.name);assert.equal(m.version,expectedVersions.get(entry.name));assert.equal(m.types,'./dist/index.d.ts');assert.deepEqual(Object.keys(m.exports),['.']);
  for(const [dependency,version] of Object.entries(m.dependencies??{}))if(dependency.startsWith('@voxkera/'))assert.equal(version,expectedVersions.get(dependency));
  const records=Object.entries(lock.packages).filter(([key])=>key.endsWith(`/node_modules/${entry.name}`)||key===`node_modules/${entry.name}`);
  assert.equal(records.length,1,`Duplicate engine dependency ${entry.name}`);
  assert.ok(!records[0][1].link);
  if(vendored){assert.ok(records[0][1].resolved.startsWith('file:vendor/voxkera/'));assert.equal(records[0][1].integrity,entry.integrity);}
  else {assert.ok(records[0][1].resolved.startsWith('https://registry.npmjs.org/'));assert.equal(records[0][1].version,expectedVersions.get(entry.name));assert.ok(records[0][1].integrity?.startsWith('sha512-'));}
}
const babylon=Object.entries(lock.packages).filter(([key])=>key.endsWith('/node_modules/@babylonjs/core')||key==='node_modules/@babylonjs/core');
assert.equal(babylon.length,1,'Tower must share one Babylon core');assert.equal(babylon[0][1].version,'7.54.3');
for(const dir of ['',...pkg.workspaces]) {
  const m=read(path.join(root,dir,'package.json'));
  for(const [name,value] of Object.entries({...m.dependencies,...m.devDependencies})) {
    if(!name.startsWith('@voxkera/'))continue;
    const entry=manifest.packages.find(p=>p.name===name);assert.ok(entry,`Unknown engine package ${name}`);
    if(vendored){assert.ok(value.startsWith('file:')&&value.endsWith('.tgz'),`Not an artifact dependency: ${dir} ${name}`);assert.equal(path.resolve(root,dir,value.slice(5)),path.join(vendor,entry.filename));}
    else assert.equal(value,expectedVersions.get(name),`Use exact, consistent registry versions: ${dir} ${name}`);
  }
}
const ts=require('typescript');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>['node_modules','dist','public','.git'].includes(e.name)?[]:e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
let scanned=0;
for(const base of ['client','shared','server','packages','scripts'])for(const file of walk(path.join(root,base)).filter(f=>/\.(?:[cm]?[jt]s|vue)$/.test(f))) {
  scanned++;
  const source=fs.readFileSync(file,'utf8');
  for(const imp of ts.preProcessFile(source,true,true).importedFiles) {
    const spec=imp.fileName;
    assert.ok(!names.some(name=>spec===`@tower/${name}`||spec.startsWith(`@tower/${name}/`)),`${file}: stale engine import ${spec}`);
    if(spec.startsWith('@voxkera/'))assert.ok(manifest.packages.some(p=>p.name===spec),`${file}: engine deep import ${spec}`);
    if(spec.startsWith('.')) {
      const target=path.resolve(path.dirname(file),spec).split(path.sep).join('/');
      assert.ok(!names.some(name=>target.includes(`/packages/${name}/src`)||target.includes(`/packages/${name}/dist`))&&!target.startsWith(path.resolve(root,'../Voxkera').split(path.sep).join('/')+'/'),`${file}: engine source bypass ${spec}`);
    }
  }
}
console.log(`PASS six installed Voxkera packages (${vendored?'vendored tarballs':'npm registry'}), one Babylon, no engine workspaces/sources/links/deep imports (${scanned} files)`);
if(process.argv.includes('--json'))console.log(JSON.stringify({packages:resolved,babylon:babylon[0][1].version},null,2));
