const fs=require('node:fs');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');
async function main() {
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  const env={...process.env,BROWSER:'none'};
  const chrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if(!env.TOWER_CHROME)env.TOWER_CHROME=process.platform==='win32'&&fs.existsSync(chrome)?chrome:require('playwright').chromium.executablePath();
  const root=path.resolve(__dirname,'..');
  console.log(`RTS tested workspace: ${root}; owned port: ${port}`);
  const child=spawn(process.execPath,[path.join(__dirname,'smoke-rts-browser.cjs'),`http://127.0.0.1:${port}/?demo=rts&map=rts-2p-crossroads`],{cwd:root,env,stdio:'inherit',windowsHide:true});
  child.once('error',error=>{console.error(error);process.exitCode=1;});
  child.once('exit',code=>{process.exitCode=code??1;});
}
main().catch(error=>{console.error(error);process.exitCode=1;});
