#!/usr/bin/env node
import fs from 'node:fs/promises';
const args=process.argv.slice(2);const cmd=args.shift()||'help';
function opt(name,def){const i=args.indexOf(name);return i>=0?args[i+1]:def}
const base=(opt('--server',process.env.TRACEDECK_URL||'http://localhost:4177')).replace(/\/$/,'');
const key=opt('--key',process.env.TRACEDECK_KEY||'td_local_dev');
async function request(path,options={}){const r=await fetch(base+path,{...options,headers:{'x-tracedeck-key':key,...(options.headers||{})}});if(!r.ok)throw new Error(`${r.status} ${(await r.text()).slice(0,500)}`);return r}
async function json(path,options){return (await request(path,options)).json()}
async function main(){
  if(cmd==='help'){console.log(`TraceDeck CLI\n\nCommands:\n  health\n  list\n  inspect <captureId>\n  analyze <captureId>\n  share <captureId>\n  playwright <captureId> [--out file]\n  export <captureId> [--out file]\n  import <capture.json>\n\nOptions: --server URL --key PROJECT_KEY`);return}
  if(cmd==='health'){console.log(JSON.stringify(await json('/api/health'),null,2));return}
  if(cmd==='list'){console.log(JSON.stringify(await json('/api/captures'),null,2));return}
  const id=args[0];
  if(cmd==='inspect'){console.log(JSON.stringify((await json('/api/captures/'+encodeURIComponent(id))).capture,null,2));return}
  if(cmd==='analyze'){console.log(JSON.stringify(await json(`/api/captures/${encodeURIComponent(id)}/analyze`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),null,2));return}
  if(cmd==='share'){console.log(JSON.stringify(await json(`/api/captures/${encodeURIComponent(id)}/share`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),null,2));return}
  if(cmd==='playwright'){const out=opt('--out',`${id}.spec.ts`);await fs.writeFile(out,await (await request(`/api/captures/${encodeURIComponent(id)}/playwright`)).text());console.log(out);return}
  if(cmd==='export'){const out=opt('--out',`${id}.trace.zip`);await fs.writeFile(out,Buffer.from(await (await request(`/api/captures/${encodeURIComponent(id)}/export`)).arrayBuffer()));console.log(out);return}
  if(cmd==='import'){const file=args[0];const zip=/\.(trace\.)?zip$/i.test(file);const body=await fs.readFile(file);const r=await request('/api/captures/import',{method:'POST',headers:{'content-type':zip?'application/zip':'application/json'},body:zip?body:body.toString('utf8')});console.log(JSON.stringify(await r.json(),null,2));return}
  throw new Error('Unknown command. Run `node tools/cli/tracedeck.mjs help`.')
}
main().catch(e=>{console.error('TraceDeck CLI:',e.message);process.exitCode=1});
