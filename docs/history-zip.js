'use strict';
/* Minimal ZIP STORE writer (UTF-8 filenames, CRC32, no third-party ZIP library).
 * PDF content is already compressed. Blob parts avoid concatenating all PDF bytes.
 * Bounded non-ZIP64 output; failed items never yield a partial download. */
(function(root){
 const MAX_BYTES=100*1024*1024,MAX_FILES=1000;
 const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 function crc32(bytes){let c=0xffffffff;for(let i=0;i<bytes.length;i++)c=(c>>>8)^table[(c^bytes[i])&255];return (c^0xffffffff)>>>0;}
 function safePdfName(input){
  let s=String(input||'Dokumen').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g,'_').replace(/[. ]+$/g,'').replace(/^[. ]+/g,'').trim();
  s=s.replace(/\.pdf$/i,'').slice(0,160).trim()||'Dokumen';
  if(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(s))s='_'+s;
  return s+'.pdf';
 }
 function uniqueName(input,used){const original=safePdfName(input),base=original.slice(0,-4);let name=original,i=2;while(used.has(name.toLowerCase()))name=base+'_'+String(i++).padStart(2,'0')+'.pdf';used.add(name.toLowerCase());return name;}
 function pack(entries){
  if(!entries.length||entries.length>MAX_FILES)throw Error('Pilih 1 sampai '+MAX_FILES+' PDF per unduhan. Persempit filter tanggal.');
  const parts=[],central=[],names=new Set(),encoder=new TextEncoder();let offset=0,centralSize=0;
  const now=new Date(),date=((Math.max(1980,Math.min(2107,now.getFullYear()))-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate(),time=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1);
  for(const entry of entries){
   const bytes=entry.bytes;if(!(bytes instanceof Uint8Array)||bytes.length<5||String.fromCharCode(...bytes.subarray(0,5))!=='%PDF-')throw Error('Berkas bukan PDF valid.');
   const name=encoder.encode(uniqueName(entry.name,names)),length=bytes.length,crc=crc32(bytes);
   const local=new Uint8Array(30+name.length),l=new DataView(local.buffer);l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x0800,true);l.setUint16(10,time,true);l.setUint16(12,date,true);l.setUint32(14,crc,true);l.setUint32(18,length,true);l.setUint32(22,length,true);l.setUint16(26,name.length,true);local.set(name,30);
   const header=new Uint8Array(46+name.length),h=new DataView(header.buffer);h.setUint32(0,0x02014b50,true);h.setUint16(4,20,true);h.setUint16(6,20,true);h.setUint16(8,0x0800,true);h.setUint16(12,time,true);h.setUint16(14,date,true);h.setUint32(16,crc,true);h.setUint32(20,length,true);h.setUint32(24,length,true);h.setUint16(28,name.length,true);h.setUint32(42,offset,true);header.set(name,46);
   offset+=local.length+length;centralSize+=header.length;if(offset+centralSize+22>MAX_BYTES)throw Error('Total ZIP melebihi batas aman 100 MiB. Persempit filter tanggal dan unduh per kelompok.');
   parts.push(local,bytes);central.push(header);
  }
  const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
  return new Blob([...parts,...central,end],{type:'application/zip'});
 }
 root.FleetHistoryZip=Object.freeze({pack,safePdfName,MAX_BYTES,MAX_FILES});
})(globalThis);
