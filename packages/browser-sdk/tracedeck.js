/* Apache-2.0 — TraceDeck browser SDK with Mobile WebView & Web Vitals Telemetry */
(function(global){
  const script=document.currentScript; const inferred=script?.src?new URL(script.src).origin:'';
  const session=new URLSearchParams(location.search).get('tracedeck_session');
  const isMobileWebView=Boolean(global.Capacitor || global.Cordova || global.AndroidBridge || /wv|Android.*Version\/[\d.]+/i.test(navigator.userAgent));
  const state={
    serverUrl:inferred,
    projectKey:'',
    metadata:{ isMobileWebView, platform: isMobileWebView ? 'mobile-webview' : 'web' },
    identity:{},
    featureFlags:{},
    queue:[],
    flushTimer:null
  };
  const SECRET=/authorization|cookie|api[-_]?key|password|passwd|secret|access[-_]?token|refresh[-_]?token/i;
  function clean(value,key='',depth=0){if(SECRET.test(key))return '[REDACTED]';if(depth>5)return '[DEPTH]';if(typeof value==='string')return value.length>5000?value.slice(0,5000)+'…':value;if(value==null||typeof value==='number'||typeof value==='boolean')return value;if(value instanceof Error)return{name:value.name,message:value.message,stack:String(value.stack||'').slice(0,8000)};if(Array.isArray(value))return value.slice(0,50).map(v=>clean(v,'',depth+1));if(typeof value==='object'){const o={};for(const [k,v] of Object.entries(value).slice(0,100))o[k]=clean(v,k,depth+1);return o}return String(value)}
  function emit(kind,data,level){const event={kind,data:clean(data),level,at:Date.now(),url:location.href};try{global.postMessage({__tracedeck:'sdk',type:'app',data:event,level,at:event.at},'*')}catch{} if(session){state.queue.push(event);scheduleFlush()} return event}
  function scheduleFlush(){if(state.flushTimer)return;state.flushTimer=setTimeout(flush,500)}
  async function flush(){state.flushTimer=null;if(!session||!state.queue.length||!state.serverUrl)return;const batch=state.queue.splice(0,100);try{const r=await fetch(state.serverUrl.replace(/\/$/,'')+'/api/live-sessions/'+encodeURIComponent(session)+'/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({events:batch,environment:{userAgent:navigator.userAgent,language:navigator.language,isMobileWebView,viewport:{width:innerWidth,height:innerHeight},screen:{width:screen.width,height:screen.height},timezone:Intl.DateTimeFormat().resolvedOptions().timeZone},metadata:{...state.metadata,featureFlags:state.featureFlags},identity:state.identity})});if(!r.ok)throw new Error('ingest failed')}catch{state.queue.unshift(...batch);if(state.queue.length>1000)state.queue.splice(0,state.queue.length-1000);setTimeout(scheduleFlush,2000)}}
  function randomHex(bytes){const arr=new Uint8Array(bytes);if(global.crypto?.getRandomValues)global.crypto.getRandomValues(arr);else for(let i=0;i<bytes;i++)arr[i]=Math.floor(Math.random()*256);return Array.from(arr,b=>b.toString(16).padStart(2,'0')).join('')}
  function createTraceContext(){const traceId=randomHex(16),spanId=randomHex(8);return {traceparent:`00-${traceId}-${spanId}-01`,traceId,spanId}}

  // PerformanceObserver for Core Web Vitals and Long Tasks (>50ms)
  try {
    if (typeof PerformanceObserver !== 'undefined') {
      const perfObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'longtask') {
            emit('perf:longtask', { duration: Math.round(entry.duration), startTime: Math.round(entry.startTime), name: entry.name }, entry.duration > 100 ? 'warn' : 'info');
          } else if (entry.entryType === 'layout-shift') {
            if (!entry.hadRecentInput && entry.value > 0.05) {
              emit('perf:cls', { score: Number(entry.value.toFixed(4)), hadRecentInput: entry.hadRecentInput });
            }
          }
        }
      });
      perfObs.observe({ entryTypes: ['longtask', 'layout-shift'] });
    }
  } catch {}

  // Touch gesture and mobile orientation listeners (Workdesk In/Out integration)
  if (typeof addEventListener !== 'undefined') {
    addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      if (t) emit('touch:start', { x: Math.round(t.clientX), y: Math.round(t.clientY), touchCount: e.touches.length });
    }, { passive: true });
    addEventListener('orientationchange', () => {
      emit('device:orientation', { angle: global.screen?.orientation?.angle ?? global.orientation, type: global.screen?.orientation?.type });
    }, { passive: true });
  }

  const api={
    init(options={}){if(options.serverUrl)state.serverUrl=options.serverUrl;if(options.projectKey)state.projectKey=options.projectKey;emit('sdk.init',{version:'0.2.0',isMobileWebView});return api},
    identify(identity={}){state.identity=clean(identity);emit('identify',state.identity);return api},
    metadata(metadata={}){state.metadata={...state.metadata,...clean(metadata)};emit('metadata',metadata);return api},
    tag(key,value){state.metadata[key]=clean(value,key);emit('metadata',{[key]:value});return api},
    setFeatureFlags(flags={}){state.featureFlags={...state.featureFlags,...clean(flags)};emit('feature_flags',state.featureFlags);return api},
    recordState(storeName,snapshot={}){emit('state:snapshot',{store:String(storeName),snapshot:clean(snapshot)});return api},
    log(message,data={}){emit('log',{message,...clean(data)});return api},
    error(error,data={}){emit('error',{error:clean(error),...clean(data)},'error');return api},
    mask(target){const nodes=typeof target==='string'?document.querySelectorAll(target):[target];for(const node of nodes)node?.setAttribute?.('data-tracedeck-mask','');return api},
    secret(){return '[REDACTED]'},
    traceContext(){return createTraceContext()},
    traceparent(){return createTraceContext().traceparent},
    domMutation(data={}){emit('dom',{kind:'mutation',...clean(data)});return api},
    snapshotDom(target='body',maxChars=4000){
      try{
        const el=typeof target==='string'?document.querySelector(target):target;
        if(!el)return api;
        const clone=el.cloneNode(true);
        for(const s of clone.querySelectorAll('script,style,noscript'))s.remove();
        for(const inp of clone.querySelectorAll('input,textarea,select,[data-tracedeck-mask]')){
          if(inp.type==='password'||inp.hasAttribute('data-tracedeck-mask'))inp.value='[REDACTED]';
        }
        const html=(clone.outerHTML||'').slice(0,maxChars);
        emit('dom',{kind:'snapshot',selector:typeof target==='string'?target:target.tagName?.toLowerCase(),html});
      }catch{}
      return api;
    },
    flush
  };
  addEventListener('error',e=>api.error(e.error||e.message,{source:e.filename,line:e.lineno,column:e.colno}));
  addEventListener('unhandledrejection',e=>api.error(e.reason||'Unhandled promise rejection'));
  global.TraceDeck=api;
  if(session)api.init({serverUrl:inferred});
})(typeof window !== 'undefined' ? window : globalThis);
