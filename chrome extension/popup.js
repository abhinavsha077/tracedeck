const $=q=>document.querySelector(q); let activeTab=null, recording=false, paused=false, elapsedMs=0, timerInterval=null;
function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
async function send(message){return chrome.runtime.sendMessage(message)}
function fmtTimer(ms=0){const s=Math.floor(Math.max(0,ms)/1000);return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
function startTimer(initialMs=0){stopTimer();elapsedMs=initialMs;$('#record-timer').textContent=fmtTimer(elapsedMs);$('#record-timer').style.display='block';timerInterval=setInterval(()=>{if(!paused){elapsedMs+=500;$('#record-timer').textContent=fmtTimer(elapsedMs)}},500)}
function stopTimer(){if(timerInterval){clearInterval(timerInterval);timerInterval=null}$('#record-timer').style.display='none'}

async function init(){
  [activeTab]=await chrome.tabs.query({active:true,currentWindow:true});
  const cfg=await chrome.storage.sync.get({serverUrl:'http://localhost:4177',projectKey:'td_local_dev',destination:'server'});
  if(cfg.destination==='local'){$('#server').innerHTML='<span class="ok">● Local-only</span><br>No server upload';}else{try{const r=await fetch(cfg.serverUrl.replace(/\/$/,'')+'/api/health'); $('#server').innerHTML=r.ok?`<span class="ok">● Connected</span><br>${cfg.serverUrl}`:`Not connected · ${r.status}`}catch{$('#server').textContent='Not connected · open Settings'}}
  const st=await send({type:'STATUS',tabId:activeTab?.id});
  recording=Boolean(st?.recording);
  paused=Boolean(st?.paused);
  if(recording)startTimer(st?.elapsedMs||0);
  renderState();
}

function renderState(){
  const recBtn=$('#record'), pauseBtn=$('#pause'), stateEl=$('#record-state'), timerEl=$('#record-timer');
  if(!recording){
    stopTimer();
    recBtn.textContent='Start tab recording';
    recBtn.className='btn primary';
    pauseBtn.style.display='none';
    timerEl.style.display='none';
    stateEl.innerHTML='<span class="badge-status ready">Ready</span> Ready to capture';
  }else if(paused){
    recBtn.textContent='Stop & save recording';
    recBtn.className='btn danger';
    pauseBtn.textContent='Resume';
    pauseBtn.className='btn primary';
    pauseBtn.style.display='block';
    timerEl.style.display='block';
    timerEl.textContent=fmtTimer(elapsedMs);
    stateEl.innerHTML='<span class="badge-status paused">Paused</span> Recording paused';
  }else{
    recBtn.textContent='Stop & save recording';
    recBtn.className='btn danger';
    pauseBtn.textContent='Pause';
    pauseBtn.className='btn warning';
    pauseBtn.style.display='block';
    timerEl.style.display='block';
    stateEl.innerHTML='<span class="badge-status live">● REC</span> Recording tab';
  }
}

$('#pause').onclick=async()=>{
  if(!activeTab||!recording)return;
  $('#result').textContent=paused?'Resuming…':'Pausing…';
  try{
    if(paused){
      const r=await send({type:'RESUME_RECORDING',tabId:activeTab.id});
      if(!r?.ok)throw new Error(r?.error||'Could not resume recording');
      paused=false;renderState();$('#result').textContent='Recording resumed.';
    }else{
      const r=await send({type:'PAUSE_RECORDING',tabId:activeTab.id});
      if(!r?.ok)throw new Error(r?.error||'Could not pause recording');
      paused=true;renderState();$('#result').textContent='Recording paused.';
    }
  }catch(e){$('#result').textContent=e.message}
};

$('#record').onclick=async()=>{
  if(!activeTab)return;
  $('#result').textContent='Working…';
  try{
    if(!recording){
      const r=await send({type:'START_RECORDING',tabId:activeTab.id,title:activeTab.title,url:activeTab.url});
      if(!r?.ok)throw new Error(r?.error||'Could not start recording');
      recording=true;paused=false;startTimer(0);renderState();$('#result').textContent='Recording started. Reproduce the issue, then stop.';
    }else{
      const r=await send({type:'STOP_RECORDING',tabId:activeTab.id});
      if(!r?.ok)throw new Error(r?.error||'Could not save recording');
      recording=false;paused=false;stopTimer();renderState();
      if(r.fallback)$('#result').innerHTML=`<span style="color:#ffd166">⚠ ${escapeHtml(r.warning||'Upload failed, saved locally')}</span>`;
      else if(r.local)$('#result').textContent='Saved local .trace.zip bundle.';
      else $('#result').innerHTML=`Saved <a target="_blank" style="color:#81bfff" href="${r.url}">${r.captureId}</a>`;
    }
  }catch(e){$('#result').textContent=e.message}
};

$('#screenshot').onclick=async()=>{if(!activeTab)return;$('#result').textContent='Capturing…';const r=await send({type:'SCREENSHOT',tabId:activeTab.id,title:activeTab.title,url:activeTab.url});$('#result').textContent=r?.ok?'Screenshot saved.':r?.error||'Capture failed';if(r?.url)chrome.tabs.create({url:r.url})};

$('#fullpage').onclick=async()=>{if(!activeTab)return;$('#result').textContent='Requesting full-page capture…';const granted=await chrome.permissions.request({permissions:['debugger']});if(!granted){$('#result').textContent='Debugger permission is required for full-page screenshots.';return}const r=await send({type:'FULLPAGE_SCREENSHOT',tabId:activeTab.id,title:activeTab.title,url:activeTab.url});$('#result').textContent=r?.ok?'Full-page screenshot saved.':r?.error||'Capture failed';if(r?.url)chrome.tabs.create({url:r.url})};

$('#desktop').onclick=async()=>{if(!activeTab)return;$('#result').textContent='Choose a screen, window, or tab…';chrome.desktopCapture.chooseDesktopMedia(['screen','window','tab','audio'],activeTab,async streamId=>{if(!streamId){$('#result').textContent='Capture cancelled.';return}const r=await send({type:'START_DESKTOP_RECORDING',tabId:activeTab.id,title:activeTab.title,url:activeTab.url,streamId});if(!r?.ok){$('#result').textContent=r?.error||'Could not start screen recording';return}recording=true;paused=false;startTimer(0);renderState();$('#result').textContent='Screen/window recording started. Use Stop to upload.'})};

$('#replay').onclick=async()=>{if(!activeTab)return;$('#result').textContent='Saving recent evidence…';const r=await send({type:'INSTANT_REPLAY',tabId:activeTab.id,title:activeTab.title,url:activeTab.url});$('#result').textContent=r?.ok?'Recent context saved.':r?.error||'Capture failed';if(r?.url)chrome.tabs.create({url:r.url})};

$('#options').onclick=()=>chrome.runtime.openOptionsPage(); init();
