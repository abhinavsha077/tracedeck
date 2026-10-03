/* Minimal STORE-mode ZIP writer for local-only TraceDeck bundles. */
(()=>{
  const table=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
  function updateCrc(c,bytes){for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return c>>>0}
  async function crc32(blob){let c=0xffffffff;const reader=blob.stream().getReader();for(;;){const {done,value}=await reader.read();if(done)break;c=updateCrc(c,value)}return (c^0xffffffff)>>>0}
  function dos(date=new Date()){const y=Math.max(1980,date.getFullYear());return{time:(date.getHours()<<11)|(date.getMinutes()<<5)|Math.floor(date.getSeconds()/2),day:((y-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate()}}
  function u16(view,off,v){view.setUint16(off,v,true)} function u32(view,off,v){view.setUint32(off,v>>>0,true)}
  function bytesHeader(size){const b=new Uint8Array(size);return{b,v:new DataView(b.buffer)}}
  async function make(files){const enc=new TextEncoder(),locals=[],centrals=[];let offset=0;
    for(const f of files){const name=enc.encode(String(f.name).replace(/\\/g,'/'));const blob=f.blob instanceof Blob?f.blob:new Blob([f.blob]);const crc=await crc32(blob);const dt=dos(f.date);const lh=bytesHeader(30+name.length);u32(lh.v,0,0x04034b50);u16(lh.v,4,20);u16(lh.v,6,0);u16(lh.v,8,0);u16(lh.v,10,dt.time);u16(lh.v,12,dt.day);u32(lh.v,14,crc);u32(lh.v,18,blob.size);u32(lh.v,22,blob.size);u16(lh.v,26,name.length);u16(lh.v,28,0);lh.b.set(name,30);locals.push(lh.b,blob);
      const ch=bytesHeader(46+name.length);u32(ch.v,0,0x02014b50);u16(ch.v,4,20);u16(ch.v,6,20);u16(ch.v,8,0);u16(ch.v,10,0);u16(ch.v,12,dt.time);u16(ch.v,14,dt.day);u32(ch.v,16,crc);u32(ch.v,20,blob.size);u32(ch.v,24,blob.size);u16(ch.v,28,name.length);u16(ch.v,30,0);u16(ch.v,32,0);u16(ch.v,34,0);u16(ch.v,36,0);u32(ch.v,38,0);u32(ch.v,42,offset);ch.b.set(name,46);centrals.push(ch.b);offset+=lh.b.length+blob.size
    }
    const centralStart=offset,centralSize=centrals.reduce((n,b)=>n+b.length,0),end=bytesHeader(22);u32(end.v,0,0x06054b50);u16(end.v,4,0);u16(end.v,6,0);u16(end.v,8,files.length);u16(end.v,10,files.length);u32(end.v,12,centralSize);u32(end.v,16,centralStart);u16(end.v,20,0);return new Blob([...locals,...centrals,end.b],{type:'application/zip'})
  }
  self.TraceDeckZip={make};
})();
