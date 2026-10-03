#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]/'apps'/'web'
html=(root/'index.html').read_text().replace('<script type="module" src="/app/app.js"></script>','')
app=(root/'app.js').read_text()
payloads={
 '/api/health':{'ok':True,'version':'0.1.0'},
 '/api/config':{'projects':[{'id':'prj_1','name':'Default'}],'integrationStatus':{},'features':{}},
 '/api/captures':{'captures':[{'id':'cap_1','title':'Smoke capture','description':'','url':'https://example.test','source':'api','createdAt':'2026-09-21T00:00:00Z','durationMs':1000,'eventCount':1,'artifactCount':0,'errorCount':0,'failedRequestCount':0}]},
 '/api/recording-links':{'recordingLinks':[]}, '/api/webhooks':{'webhooks':[],'deliveries':[]},
 '/api/captures/cap_1':{'capture':{'id':'cap_1','title':'Smoke capture','description':'','url':'https://example.test','source':'api','createdAt':'2026-09-21T00:00:00Z','durationMs':1000,'environment':{},'metadata':{},'events':[{'type':'action','ts':100,'data':{'action':'click','selector':'#x','label':'X'}}],'artifacts':[],'comments':[],'shares':[]}}
}
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page()
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(html)
    page.evaluate("""(payloads)=>{window.fetch=async(input)=>{const u=typeof input==='string'?input:input.url;const path=u.startsWith('http')?new URL(u).pathname:u.split('?')[0];const data=payloads[path]||{error:'not mocked '+path};return new Response(JSON.stringify(data),{status:payloads[path]?200:404,headers:{'content-type':'application/json'}})}}""", payloads)
    page.add_script_tag(content=app, type='module')
    page.wait_for_selector('.capture-card', timeout=5000)
    page.locator('.capture-card').click()
    page.wait_for_selector('.detail-head h1', timeout=5000)
    assert page.locator('.detail-head h1').inner_text()=='Smoke capture'
    assert page.locator('.event-row').count()==1
    assert page.locator('#import-trace').count()==1
    # Exercise the browser-side STORE-mode ZIP writer used by local-only extension captures.
    page.add_script_tag(content=(Path(__file__).resolve().parents[1]/'apps'/'extension'/'zip.js').read_text())
    sig=page.evaluate("""async()=>{const b=await TraceDeckZip.make([{name:'capture.json',blob:new Blob(['{\"ok\":true}'])}]);const a=new Uint8Array(await b.arrayBuffer());return {size:b.size,sig:[...a.slice(0,4)]}}""")
    assert sig['size']>100 and sig['sig']==[0x50,0x4b,0x03,0x04]
    if errors: raise RuntimeError('; '.join(errors))
    browser.close()
print('UI smoke passed: dashboard rendering, trace import control, synchronized evidence UI, and browser ZIP packaging work in Chromium.')
