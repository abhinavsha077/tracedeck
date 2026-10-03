#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { validateZip } from '../apps/server/lib/zip.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));const port=43000+(process.pid%1000);const data=await fs.mkdtemp(path.join(os.tmpdir(),'tracedeck-smoke-'));const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['apps/server/server.mjs'],{cwd:root,env:{...process.env,TRACEDECK_HOST:'127.0.0.1',TRACEDECK_PORT:String(port),TRACEDECK_PUBLIC_URL:base,TRACEDECK_DATA_DIR:data},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',d=>stderr+=d);
async function wait(){for(let i=0;i<60;i++){try{const r=await fetch(base+'/api/health');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw new Error('server did not start: '+stderr)}
try{
  await wait();
  let r=await fetch(base+'/api/captures',{method:'POST',headers:{'content-type':'application/json','x-tracedeck-key':'td_local_dev'},body:JSON.stringify({title:'Smoke capture',url:'https://example.test',durationMs:1000,events:[{type:'action',ts:100,data:{action:'click',selector:'#x',label:'X'}}]})});if(!r.ok)throw new Error('capture creation failed');let d=await r.json();const id=d.capture.id;
  r=await fetch(d.artifactUpload,{method:'POST',headers:{'content-type':'image/svg+xml','x-artifact-kind':'screenshot','x-artifact-name':'smoke.svg'},body:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>'});if(!r.ok)throw new Error('artifact upload failed');
  const html=await (await fetch(base+`/app/?capture=${id}`)).text();if(!html.includes('TraceDeck'))throw new Error('web app shell did not serve');
  const rec=await (await fetch(base+'/api/recording-links',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Smoke report'})})).json();const recHtml=await (await fetch(base+'/record/'+rec.link.token)).text();if(!recHtml.includes('Report issue'))throw new Error('recording-link UI did not serve');
  const exp=await fetch(base+`/api/captures/${id}/export`);const zipBuf=Buffer.from(await exp.arrayBuffer());const zip=path.join(data,'capture.trace.zip');await fs.writeFile(zip,zipBuf);const v=validateZip(zipBuf);if(!v.valid)throw new Error('Exported zip is invalid: '+v.errors.join(', '));
  console.log('Smoke test passed: API, web UI, recording-link UI, artifact serving and export are functional.');
}finally{child.kill('SIGTERM');await new Promise(r=>setTimeout(r,100));await fs.rm(data,{recursive:true,force:true}).catch(()=>{});}
