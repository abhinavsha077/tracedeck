const recordings=new Map(); const deepEvents=new Map();

async function settings(){return chrome.storage.sync.get({serverUrl:'http://localhost:4177',projectKey:'td_local_dev',deepDebug:false,destination:'server'})}
async function activeContext(tabId,since){try{return await chrome.tabs.sendMessage(tabId,{type:'GET_CONTEXT',since})}catch{return {events:[],environment:{},url:'',title:''}}}
function normalizeEvents(events,start){return (events||[]).filter(e=>e.at>=start).map(e=>({type:e.type,level:e.level,ts:Math.max(0,e.at-start),data:e.data||{}})).sort((a,b)=>a.ts-b.ts)}
function redactHeaders(headers={}){const out={};for(const [k,v] of Object.entries(headers||{}))out[k]=/authorization|cookie|set-cookie|api[-_]?key/i.test(k)?'[REDACTED]':String(v).slice(0,2000);return out}
async function ensureOffscreen(){if(await chrome.offscreen.hasDocument?.())return;await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['USER_MEDIA','BLOBS'],justification:'Record user-selected media and package or upload TraceDeck artifacts.'})}
function fileSafe(s='capture'){return String(s).toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'capture'}
async function collectPayload(tabId,base,start,end,source='extension'){
  const ctx=await activeContext(tabId,start);const de=deepEvents.get(tabId)||[];const events=normalizeEvents([...(ctx.events||[]),...de.filter(e=>e.at>=start&&e.at<=end)],start);
  const appMeta={};let identity={};for(const e of events){if(e.type==='app'&&e.data?.kind==='metadata')Object.assign(appMeta,e.data.data||{});if(e.type==='app'&&e.data?.kind==='identify')identity=e.data.data||{}}
  return {title:base.title||ctx.title||'TraceDeck capture',description:base.description||'',url:base.url||ctx.url||'',source,durationMs:Math.max(0,end-start),startedAt:new Date(start).toISOString(),environment:ctx.environment||{},metadata:{...appMeta,identity,extensionVersion:chrome.runtime.getManifest().version,deepDebug:de.length>0},events};
}
function localBundle(payload){return {schemaVersion:'1.0',capture:{...payload,source:'extension',createdAt:new Date().toISOString()},events:payload.events||[],comments:[],artifacts:[]}}
async function downloadLocal(payload,artifacts=[]){await ensureOffscreen();const r=await chrome.runtime.sendMessage({target:'offscreen',type:'OFFSCREEN_DOWNLOAD_BUNDLE',bundle:localBundle(payload),artifacts,filename:`tracedeck-${fileSafe(payload.title)}-${Date.now()}.trace.zip`});if(!r?.ok)throw new Error(r?.error||'Local bundle download failed');return r}
async function createCapture(tabId,base,start,end,source='extension'){
  const cfg=await settings();const payload=await collectPayload(tabId,base,start,end,source);
  const r=await fetch(cfg.serverUrl.replace(/\/$/,'')+'/api/captures',{method:'POST',headers:{'content-type':'application/json','x-tracedeck-key':cfg.projectKey},body:JSON.stringify(payload)});if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||`Server returned ${r.status}`);return {cfg,data:await r.json(),payload};
}
async function blobFromDataUrl(dataUrl){const r=await fetch(dataUrl);return r.blob()}
async function uploadArtifact(url,blob,kind,name){const r=await fetch(url,{method:'POST',headers:{'content-type':blob.type||'application/octet-stream','x-artifact-kind':kind,'x-artifact-name':name},body:blob});if(!r.ok)throw new Error(`Artifact upload failed (${r.status})`);return r.json()}

async function attachDebug(tabId){const cfg=await settings();if(!cfg.deepDebug)return false;const allowed=await chrome.permissions.contains({permissions:['debugger']});if(!allowed)return false;try{await chrome.debugger.attach({tabId},'1.3');await chrome.debugger.sendCommand({tabId},'Network.enable');await chrome.debugger.sendCommand({tabId},'Runtime.enable');deepEvents.set(tabId,[]);return true}catch{return false}}
async function detachDebug(tabId){try{await chrome.debugger.detach({tabId})}catch{}}
chrome.debugger?.onEvent?.addListener((source,method,params)=>{const tabId=source.tabId;if(!tabId||!deepEvents.has(tabId))return;const list=deepEvents.get(tabId),at=Date.now();if(method==='Network.requestWillBeSent'){const r=params.request||{};list.push({type:'network',at,data:{source:'cdp',phase:'request',requestId:params.requestId,url:r.url,method:r.method,headers:redactHeaders(r.headers),resourceType:params.type}})}else if(method==='Network.responseReceived'){const r=params.response||{};list.push({type:'network',at,data:{source:'cdp',phase:'response',requestId:params.requestId,url:r.url,status:r.status,statusText:r.statusText,mimeType:r.mimeType,protocol:r.protocol,headers:redactHeaders(r.headers),resourceType:params.type}})}else if(method==='Network.loadingFailed')list.push({type:'network',level:'error',at,data:{source:'cdp',phase:'failed',requestId:params.requestId,failed:true,error:params.errorText,canceled:params.canceled}});else if(method==='Runtime.exceptionThrown'){const d=params.exceptionDetails||{};list.push({type:'console',level:'exception',at,data:{source:'cdp',message:d.text||d.exception?.description||'Runtime exception',url:d.url,line:d.lineNumber,column:d.columnNumber}})}if(list.length>10000)list.splice(0,list.length-10000)});

chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{if(msg?.target==='offscreen')return false;(async()=>{try{
  if(msg.type==='STATUS'){
    const rec=recordings.get(msg.tabId);
    if(!rec){reply({recording:false});return}
    const now=Date.now(),elapsed=(rec.paused&&rec.pausedAt)?(rec.pausedAt-rec.start-(rec.totalPausedMs||0)):(now-rec.start-(rec.totalPausedMs||0));
    reply({recording:true,paused:Boolean(rec.paused),start:rec.start,elapsedMs:Math.max(0,elapsed)});
    return;
  }
  if(msg.type==='PAUSE_RECORDING'){
    const rec=recordings.get(msg.tabId);if(!rec)throw new Error('No active recording for this tab');
    if(rec.paused){reply({ok:true,state:'paused'});return}
    const r=await chrome.runtime.sendMessage({target:'offscreen',type:'OFFSCREEN_PAUSE'});
    if(!r?.ok)throw new Error(r?.error||'Failed to pause recording');
    rec.paused=true;rec.pausedAt=Date.now();
    reply({ok:true,state:'paused'});return;
  }
  if(msg.type==='RESUME_RECORDING'){
    const rec=recordings.get(msg.tabId);if(!rec)throw new Error('No active recording for this tab');
    if(!rec.paused){reply({ok:true,state:'recording'});return}
    const r=await chrome.runtime.sendMessage({target:'offscreen',type:'OFFSCREEN_RESUME'});
    if(!r?.ok)throw new Error(r?.error||'Failed to resume recording');
    if(rec.pausedAt){rec.totalPausedMs=(rec.totalPausedMs||0)+(Date.now()-rec.pausedAt);rec.pausedAt=null}
    rec.paused=false;
    reply({ok:true,state:'recording'});return;
  }
  if(msg.type==='START_RECORDING'||msg.type==='START_DESKTOP_RECORDING'){
    if(recordings.has(msg.tabId))throw new Error('This tab already has an active recording');await ensureOffscreen();let streamId=msg.streamId;if(msg.type==='START_RECORDING')streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:msg.tabId});const start=Date.now();await attachDebug(msg.tabId);const source=msg.type==='START_DESKTOP_RECORDING'?'desktop':'tab';const r=await chrome.runtime.sendMessage({target:'offscreen',type:'OFFSCREEN_START',streamId,source,tabId:msg.tabId});if(!r?.ok){await detachDebug(msg.tabId);throw new Error(r?.error||'Recorder failed to start')}recordings.set(msg.tabId,{start,title:source==='desktop'?`Screen recording: ${msg.title||'issue'}`:msg.title,url:msg.url,source,paused:false,pausedAt:null,totalPausedMs:0});try{await chrome.tabs.sendMessage(msg.tabId,{type:'RECORDING_STATE_CHANGE',recording:true,startTime:start})}catch{}reply({ok:true});return
  }
  if(msg.type==='STOP_RECORDING'){
    const rec=recordings.get(msg.tabId);if(!rec)throw new Error('No active recording for this tab');const end=Date.now(),cfg=await settings();try{if(cfg.destination==='local'){const payload=await collectPayload(msg.tabId,rec,rec.start,end);const r=await chrome.runtime.sendMessage({target:'offscreen',type:'OFFSCREEN_STOP_LOCAL',bundle:localBundle(payload),filename:`tracedeck-${fileSafe(payload.title)}-${Date.now()}.trace.zip`});if(!r?.ok)throw new Error(r?.error||'Local recording save failed');reply({ok:true,local:true})}else{try{const created=await createCapture(msg.tabId,rec,rec.start,end);const uploaded=await chrome.runtime.sendMessage({target:'offscreen',type:'OFFSCREEN_STOP',uploadUrl:created.data.artifactUpload});if(!uploaded?.ok)throw new Error(uploaded?.error||'Video upload failed');reply({ok:true,captureId:created.data.capture.id,url:`${created.cfg.serverUrl.replace(/\/$/,'')}/app/?capture=${created.data.capture.id}`})}catch(uploadErr){console.warn('Server upload failed, falling back to local download:',uploadErr);const payload=await collectPayload(msg.tabId,rec,rec.start,end);const r=await chrome.runtime.sendMessage({target:'offscreen',type:'OFFSCREEN_STOP_LOCAL',bundle:localBundle(payload),filename:`tracedeck-fallback-${fileSafe(payload.title)}-${Date.now()}.trace.zip`});if(!r?.ok)throw new Error(`Upload failed (${uploadErr.message}) and local fallback failed (${r?.error||'unknown'})`);reply({ok:true,local:true,fallback:true,warning:`Upload failed (${uploadErr.message}). Recording saved locally to Downloads.`})}}}catch(e){try{await chrome.runtime.sendMessage({target:'offscreen',type:'OFFSCREEN_ABORT'})}catch{}throw e}finally{recordings.delete(msg.tabId);await detachDebug(msg.tabId);deepEvents.delete(msg.tabId);try{await chrome.tabs.sendMessage(msg.tabId,{type:'RECORDING_STATE_CHANGE',recording:false})}catch{}}return
  }
  if(msg.type==='FULLPAGE_SCREENSHOT'){
    const end=Date.now(),start=end-30_000,cfg=await settings();let attached=deepEvents.has(msg.tabId);try{if(!attached)await chrome.debugger.attach({tabId:msg.tabId},'1.3');await chrome.debugger.sendCommand({tabId:msg.tabId},'Page.enable');const shot=await chrome.debugger.sendCommand({tabId:msg.tabId},'Page.captureScreenshot',{format:'png',captureBeyondViewport:true,fromSurface:true});const dataUrl=`data:image/png;base64,${shot.data}`;if(!attached)await chrome.debugger.detach({tabId:msg.tabId});if(cfg.destination==='local'){const payload=await collectPayload(msg.tabId,{...msg,title:`Full page: ${msg.title||'capture'}`},start,end);await downloadLocal(payload,[{name:'full-page.png',kind:'screenshot',contentType:'image/png',dataUrl}]);reply({ok:true,local:true});return}const created=await createCapture(msg.tabId,{...msg,title:`Full page: ${msg.title||'capture'}`},start,end);const binary=Uint8Array.from(atob(shot.data),c=>c.charCodeAt(0));await uploadArtifact(created.data.artifactUpload,new Blob([binary],{type:'image/png'}),'screenshot','full-page.png');reply({ok:true,captureId:created.data.capture.id,url:`${created.cfg.serverUrl.replace(/\/$/,'')}/app/?capture=${created.data.capture.id}`});return}catch(e){if(!attached)try{await chrome.debugger.detach({tabId:msg.tabId})}catch{}throw e}
  }
  if(msg.type==='SCREENSHOT'||msg.type==='INSTANT_REPLAY'){
    const end=Date.now(),start=end-(msg.type==='INSTANT_REPLAY'?120_000:30_000),cfg=await settings(),base=msg.type==='INSTANT_REPLAY'?{...msg,title:`Replay: ${msg.title||'recent activity'}`}:msg;const tab=await chrome.tabs.get(msg.tabId),dataUrl=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'}),name=msg.type==='INSTANT_REPLAY'?'replay-end.png':'screenshot.png';if(cfg.destination==='local'){const payload=await collectPayload(msg.tabId,base,start,end);await downloadLocal(payload,[{name,kind:'screenshot',contentType:'image/png',dataUrl}]);reply({ok:true,local:true});return}const created=await createCapture(msg.tabId,base,start,end);await uploadArtifact(created.data.artifactUpload,await blobFromDataUrl(dataUrl),'screenshot',name);reply({ok:true,captureId:created.data.capture.id,url:`${created.cfg.serverUrl.replace(/\/$/,'')}/app/?capture=${created.data.capture.id}`});return
  }
}catch(e){reply({ok:false,error:e.message})}})().catch(e=>reply({ok:false,error:e.message}));return true});
chrome.tabs.onRemoved.addListener(async tabId=>{if(recordings.has(tabId)){recordings.delete(tabId);try{await chrome.runtime.sendMessage({target:'offscreen',type:'OFFSCREEN_ABORT'})}catch{}await detachDebug(tabId);deepEvents.delete(tabId)}});
