const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),dir=path.resolve(root,'../Voxkera/docs/media/showcase');
const lab=JSON.parse(fs.readFileSync(path.join(dir,'lab-manifest.json'),'utf8'));
const pack=JSON.parse(fs.readFileSync(path.join(root,'vendor/voxkera/manifest.json'),'utf8'));
const bytes=fs.readFileSync(path.join(root,'artifacts/voxkera-migration/showcase-rts.log'));
const log=bytes[0]===0xff&&bytes[1]===0xfe?bytes.toString('utf16le'):bytes.toString('utf8');
assert.ok(log.includes('RTS browser interaction smoke passed'),'RTS capture regression must pass');
const titles={'rts-overview.png':'Tower RTS integration','rts-fortress.png':'Tower-owned procedural fortress','rts-meteor.png':'Meteor rendering','rts-frost.png':'Frost area effect'};
const captures=lab.captures.map(c=>({...c,source:c.testedWorkspace.endsWith('Voxkera')?'standalone example':'Tower Voxel Lab'}));
for(const [filename,title]of Object.entries(titles))captures.push({filename,title,source:'Tower RTS browser regression',testedWorkspace:root});
for(const capture of captures){
  const bytes=fs.readFileSync(path.join(dir,capture.filename));assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const hash=crypto.createHash('sha256').update(bytes).digest('hex');if(capture.sha256)assert.equal(hash,capture.sha256);
  Object.assign(capture,{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:hash});
}
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({capturedAt:lab.capturedAt,backend:lab.backend,mockups:false,packages:pack.packages.map(p=>({name:p.name,version:p.version,integrity:p.integrity})),captures},null,2)+'\n');
console.log(`PASS ${captures.length} actual browser captures with dimensions, SHA-256 and package provenance`);
