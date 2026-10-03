#!/usr/bin/env node
const base=(process.env.TRACEDECK_URL||'http://localhost:4177').replace(/\/$/,'');const key=process.env.TRACEDECK_KEY||'td_local_dev';
const events=[
  {type:'action',ts:520,data:{action:'click',selector:'#checkout',label:'Checkout'}},
  {type:'network',ts:760,data:{phase:'request',method:'POST',url:'https://demo.local/api/checkout'}},
  {type:'network',ts:1410,data:{phase:'response',method:'POST',url:'https://demo.local/api/checkout',status:500,durationMs:650}},
  {type:'console',ts:1430,level:'error',data:{message:'PaymentIntent is undefined at submitPayment (checkout.js:214)'}},
  {type:'action',ts:2100,data:{action:'click',selector:'#retry',label:'Retry payment'}}
];
const payload={title:'Demo: checkout payment fails',description:'The Pay button returns an error after the order review step.',url:'https://demo.local/checkout',source:'api',durationMs:2800,environment:{browser:'Chromium',os:process.platform,viewport:{width:1440,height:900}},metadata:{build:'demo-abc123',tenant:'sandbox',featureFlags:{newCheckout:true}},events};
const r=await fetch(base+'/api/captures',{method:'POST',headers:{'content-type':'application/json','x-tracedeck-key':key},body:JSON.stringify(payload)});if(!r.ok)throw new Error(await r.text());const d=await r.json();
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#071018"/><rect x="90" y="70" width="1020" height="535" rx="22" fill="#0d1c28" stroke="#28445a"/><text x="140" y="145" fill="#eaf6ff" font-family="Arial" font-size="34" font-weight="700">Checkout</text><text x="140" y="205" fill="#89a7bc" font-family="Arial" font-size="22">Order #TD-1042 · $129.00</text><rect x="140" y="280" width="920" height="90" rx="12" fill="#2b131a" stroke="#743441"/><text x="175" y="335" fill="#ff8794" font-family="Arial" font-size="24">Payment failed — please try again.</text><rect x="140" y="430" width="250" height="62" rx="12" fill="#287dde"/><text x="212" y="470" fill="white" font-family="Arial" font-size="22">Retry payment</text></svg>`;
const up=await fetch(d.artifactUpload,{method:'POST',headers:{'content-type':'image/svg+xml','x-artifact-kind':'screenshot','x-artifact-name':'checkout-error.svg'},body:svg});if(!up.ok)throw new Error(await up.text());console.log(`${base}/app/?capture=${d.capture.id}`);
