'use strict';
/* FleetCheck R3. GitHub Pages owns camera capture & PDF creation.
   Apps Script receives a normal HTML FORM POST (rather than cross-origin fetch),
   then confirms completion with a target-origin-checked postMessage response. */
const $ = (id) => document.getElementById(id);
const ITEMS = window.MASTER_P2H.items;
const state = {
  view: 'p2h', step: 1, pPhotos: {}, cPhotos: {}, camera: null,
  stream: null, signatureSigned: false, signing: false, active: false,
  pId: null, cId: null, lastPdf: null, historyRecords: [], historyPage: 1, historyPages: 1, historyTotal: 0, deletionTarget: null
};
const safe = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const value = (id) => ($(id).value || '').trim();
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3500);}
function alertError(message){const el=$('global-alert');el.textContent=message;el.hidden=false;el.scrollIntoView({behavior:'smooth',block:'center'});}
function clearError(){$('global-alert').hidden=true;}
function dateStr(d = new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function timeStr(d = new Date()){return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
function uid(prefix){const d=new Date();const token=(globalThis.crypto?.randomUUID?.() || String(Math.random()).slice(2)).replace(/-/g,'').slice(0,10).toUpperCase();return `${prefix}-${dateStr(d).replace(/-/g,'')}-${token}`;}
function setBusy(busy,label){state.active=busy;for(const id of ['submit-p2h','submit-clean','history-refresh'])$(id).disabled=busy;validateDeleteDialog();if(busy)toast(label||'Memproses...');}
function setView(which){
 if(state.active)return;closeCamera();state.view=which;clearError();
 $('save-result').hidden=true;$('p2h-view').hidden=which!=='p2h';
 $('clean-view').hidden=which!=='clean';$('history-view').hidden=which!=='history';
 for(const b of document.querySelectorAll('.nav'))b.classList.toggle('active',b.dataset.view===which);
 const cfg={p2h:['Pemeriksaan P2H','FORM INSPEKSI','Pemeriksaan kelayakan & perlengkapan container dan truck vendor.'],clean:['Kebersihan Truck','FORM KEBERSIHAN','Empat evidence kamera langsung termasuk Sterico Trap sebelum dan sesudah.'],history:['Riwayat Form','ARSIP DIGITAL','Cari hasil pengisian, unduh ulang PDF atau hapus dengan double verification.']}[which];
 $('page-title').textContent=cfg[0];$('page-eyebrow').textContent=cfg[1];$('page-subtitle').textContent=cfg[2];
 if(which==='history')loadHistory();window.scrollTo({top:0,behavior:'smooth'});
}
function setStep(n){state.step=n;for(let i=1;i<=3;i++){$(`p2h-step-${i}`).hidden=i!==n;}for(const s of document.querySelectorAll('.stepper [data-step]')){const sn=Number(s.dataset.step);s.classList.toggle('current',sn===n);s.classList.toggle('done',sn<n);}if(n===3)$('sign-name').textContent=value('p-person')+' • '+value('p-role');clearError();window.scrollTo({top:0,behavior:'smooth'});}
function renderChecklist(){const frag=[];let prev='';for(let idx=0;idx<ITEMS.length;idx++){const item=ITEMS[idx];if(item.section!==prev){prev=item.section;frag.push(`<div class="check-section">${safe(item.section)}</div>`);}const req=item.point?`<span class="check-tag">Titik ${item.point} • Foto Wajib</span>`:'';frag.push(`<div class="check-row" data-row="${item.row}"><div class="check-row-top"><span class="check-num">${String(idx+1).padStart(2,'0')}</span><div class="check-name">${safe(item.label)}</div>${req}</div><div class="check-controls" role="group" aria-label="Status ${safe(item.label)}"><label class="radio-label"><input type="radio" name="st-${item.row}" value="ok">OK</label><label class="radio-label nok"><input type="radio" name="st-${item.row}" value="nok">NOK</label></div><input class="check-note" data-note="${item.row}" maxlength="72" placeholder="Keterangan NOK wajib diisi" hidden><div class="photo-row"><button type="button" class="btn-photo" data-photo="${item.row}">📷 Ambil Foto</button><span class="photo-status" data-photo-status="${item.row}">${item.point?'Foto wajib': 'Wajib jika NOK / opsional jika OK'}</span><img class="photo-thumb" data-thumb="${item.row}" hidden alt="Pratinjau foto evidence"></div></div>`);} $('p2h-checklist').innerHTML=frag.join('');
  for(const el of document.querySelectorAll('.check-row')) {const row=Number(el.dataset.row);el.querySelectorAll('input[type=radio]').forEach(inp=>inp.addEventListener('change',()=>{const nok=el.querySelector('input[value=nok]').checked;el.classList.toggle('is-nok',nok);el.querySelector('.check-note').hidden=!nok;updatePhotoRow(row);}));}
  for(const btn of document.querySelectorAll('[data-photo]'))btn.addEventListener('click',()=>{const item=ITEMS.find(i=>i.row===Number(btn.dataset.photo));openCamera('p2h',item.row,item.label);});
}
function updatePhotoRow(row){const image=state.pPhotos[row],item=ITEMS.find(i=>i.row===row),nok=document.querySelector(`input[name="st-${row}"][value="nok"]`).checked;const txt=document.querySelector(`[data-photo-status="${row}"]`),thumb=document.querySelector(`[data-thumb="${row}"]`),button=document.querySelector(`[data-photo="${row}"]`);if(image){thumb.src=image.dataUrl;thumb.hidden=false;txt.textContent=`✓ Foto ${image.capturedAt}`;txt.style.color='#047857';button.textContent='↻ Ulangi Foto';} else{thumb.hidden=true;txt.textContent=item.point?'Foto wajib':(nok?'Foto wajib karena NOK':'Foto opsional');txt.style.color='';button.textContent='📷 Ambil Foto';}}
function renderClean(){
 const arr=[{key:'sterico_before',label:'Sterico Trap - SEBELUM Pembersihan'},
 {key:'inside',label:'Bukti Hasil Pembersihan Dalam Kontainer'},
 {key:'door',label:'Bukti Hasil Pembersihan Luar Pintu Kontainer'},
 {key:'sterico_after',label:'Sterico Trap - SESUDAH Pembersihan'}];
 $('clean-photogrid').innerHTML=arr.map((x,i)=>{
 const p=state.cPhotos[x.key];
 return `<div class="photo-card"><b>${String(i+1).padStart(2,'0')}. ${safe(x.label)} *</b>${p?`<img class="photo-big" src="${p.dataUrl}" alt="Foto bukti pembersihan"><small>${safe(p.capturedAt)}</small>`:'<span style="font-size:34px">📷</span><small>Belum ada foto - wajib</small>'}<button class="btn-photo" type="button" data-clean-photo="${x.key}">${p?'↻ Ulangi Foto':'📷 Buka Kamera Langsung'}</button></div>`;
 }).join('');
 for(const btn of document.querySelectorAll('[data-clean-photo]'))btn.onclick=()=>openCamera('clean',btn.dataset.cleanPhoto,btn.closest('.photo-card').querySelector('b').textContent);
}
function gatherP2H(){const d={person_name:value('p-person'),role:value('p-role'),truck:value('p-truck'),container:value('p-container'),plate:value('p-plate'),kilometer:value('p-km'),inspection_date:value('p-date'),inspection_time:value('p-time'),additional_notes:value('p-notes'),checks:{}};for(const item of ITEMS){const status=document.querySelector(`input[name="st-${item.row}"]:checked`)?.value||'';d.checks[item.row]={status,note:document.querySelector(`[data-note="${item.row}"]`).value.trim()};}return d;}
function validateP2H(d){for(const [field,label] of [['person_name','Nama pembuat'],['truck','Truck'],['container','Container'],['plate','Nomor polisi'],['kilometer','Kilometer'],['inspection_date','Tanggal'],['inspection_time','Jam']])if(!d[field])throw new Error(label+' wajib diisi.');for(const item of ITEMS){const s=d.checks[item.row];if(!['ok','nok'].includes(s.status))throw new Error('Checklist belum diisi: '+item.label);if(s.status==='nok'&&!s.note)throw new Error('Keterangan NOK wajib: '+item.label);if((item.point||s.status==='nok')&&!state.pPhotos[item.row])throw new Error('Foto evidence wajib: '+item.label);}return true;}
function validateClean(){
 for(const id of ['c-driver','c-plate','c-date'])if(!value(id))throw new Error('Isi nama driver, nomor polisi, dan tanggal.');
 for(const a of window.FleetPdf.cleanAreas)if(!state.cPhotos[a.key])throw new Error('Foto wajib: '+a.title+'. Buka kamera langsung.');
}
function reviewP2H(){const d=gatherP2H();validateP2H(d);const fields=[['Pembuat',d.person_name],['Peran',d.role],['No. Polisi',d.plate],['Truck',d.truck],['Container',d.container],['Kilometer',d.kilometer],['Tanggal / Jam',`${d.inspection_date} • ${d.inspection_time}`],['Foto Evidence',`${Object.keys(state.pPhotos).length} foto`]];const rows=ITEMS.map((item,i)=>{const s=d.checks[item.row],has=!!state.pPhotos[item.row];return `<tr><td>${i+1}</td><td>${safe(item.label)}${s.note?`<small style="display:block;color:#64748b">${safe(s.note)}</small>`:''}</td><td><span class="pill ${s.status}">${s.status.toUpperCase()}</span></td><td>${has?'📷 Ya':'—'}</td></tr>`;}).join('');const photosPreview=ITEMS.filter(item=>state.pPhotos[item.row]).map(item=>{const p=state.pPhotos[item.row];return `<div class="review-photo"><img src="${p.dataUrl}" alt="Foto ${safe(item.label)}"><div><b>${safe(item.point?'Titik '+item.point:item.label)}</b><small>${safe(p.capturedAt)} • ${safe(d.checks[item.row].status.toUpperCase())}</small></div></div>`;}).join('');$('review-p2h').innerHTML=`<div class="review-meta">${fields.map(([a,b])=>`<div class="review-field"><small>${a}</small><b>${safe(b)}</b></div>`).join('')}</div><div style="overflow-x:auto"><table class="review-table"><thead><tr><th>No.</th><th>Pemeriksaan</th><th>Status</th><th>Foto</th></tr></thead><tbody>${rows}</tbody></table></div><div class="section-title"><div><span>📷</span><b>Review Foto Evidence (${Object.keys(state.pPhotos).length})</b></div></div><div class="review-gallery">${photosPreview}</div>${d.additional_notes?`<div class="notice"><span>📝</span><div><b>Catatan</b><p>${safe(d.additional_notes)}</p></div></div>`:''}`;setStep(2);}
function resetP2H(){if(state.active)return;state.pPhotos={};state.pId=null;state.lastPdf=null;for(const id of ['p-person','p-truck','p-container','p-plate','p-km','p-notes'])$(id).value='';$('p-role').value='Driver';$('p-date').value=dateStr();$('p-time').value=timeStr();renderChecklist();clearSignature();setStep(1);$('save-result').hidden=true;$('p2h-view').hidden=false;}
function resetClean(){if(state.active)return;state.cPhotos={};state.cId=null;for(const id of ['c-driver','c-plate'])$(id).value='';$('c-type').selectedIndex=0;$('c-date').value=dateStr();renderClean();$('save-result').hidden=true;$('clean-view').hidden=false;clearError();}
/* ONLY navigator.mediaDevices.getUserMedia: there is no file selector or gallery input. */
async function openCamera(kind,key,label){
 if(state.active)return;clearError();
 if(kind==='clean'){
  if(key!=='sterico_before'&&!state.cPhotos.sterico_before){alertError('Ambil foto Sterico Trap SEBELUM pembersihan terlebih dahulu.');return;}
  if(key==='sterico_after'&&(!state.cPhotos.inside||!state.cPhotos.door)){alertError('Selesaikan foto hasil dalam dan luar kontainer sebelum foto Sterico Trap SESUDAH.');return;}
  if(key==='sterico_before'&&(state.cPhotos.inside||state.cPhotos.door||state.cPhotos.sterico_after)){
   if(!confirm('Mengulang foto SEBELUM akan mengosongkan foto hasil dalam/luar dan SESUDAH agar urutan dokumentasi benar. Lanjutkan?'))return;
   delete state.cPhotos.inside;delete state.cPhotos.door;delete state.cPhotos.sterico_after;renderClean();
  }
  if((key==='inside'||key==='door')&&state.cPhotos.sterico_after){
   if(!confirm('Mengulang foto hasil pembersihan akan mengosongkan foto Sterico Trap SESUDAH. Lanjutkan?'))return;
   delete state.cPhotos.sterico_after;renderClean();
  }
 }
 closeCamera();state.camera={kind,key,label};$('camera-label').textContent=label;$('camera-meta').textContent='';$('camera-modal').hidden=false;try{if(!navigator.mediaDevices?.getUserMedia)throw new Error('Browser tidak mendukung kamera langsung. Buka melalui HTTPS (GitHub Pages) atau localhost.');state.stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}}});$('camera-video').srcObject=state.stream;await $('camera-video').play();}catch(err){closeCamera();alertError('Kamera tidak bisa dibuka: '+(err.message||err.name)+'. Izinkan akses kamera dan gunakan HTTPS.');}}
function closeCamera(){if(state.stream){for(const t of state.stream.getTracks())t.stop();state.stream=null;}$('camera-video').srcObject=null;$('camera-modal').hidden=true;state.camera=null;}
function captureCamera(){const c=state.camera,v=$('camera-video');if(!c||!v.videoWidth)throw new Error('Kamera belum siap.');const ratio=Math.min(1,1280/v.videoWidth,960/v.videoHeight);const w=Math.round(v.videoWidth*ratio),h=Math.round(v.videoHeight*ratio);const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.drawImage(v,0,0,w,h);
  const d=new Date();const ts=d.toLocaleString('id-ID',{hour12:false});const plate=(c.kind==='p2h'?value('p-plate'):value('c-plate')).toUpperCase().slice(0,28);ctx.fillStyle='rgba(10,17,34,0.80)';ctx.fillRect(0,h-39,w,39);ctx.fillStyle='#fff';ctx.font=`bold ${Math.max(12,Math.round(w/90))}px Arial`;ctx.fillText(`FleetCheck • ${plate||'KENDARAAN'} • ${c.kind==='p2h'?'P2H '+(ITEMS.find(i=>i.row===c.key)?.point||c.key):String(c.label).slice(0,45)}`,12,h-23);ctx.font=`${Math.max(10,Math.round(w/110))}px Arial`;ctx.fillText(`Waktu perangkat: ${ts}`,12,h-8);
  let dataUrl=canvas.toDataURL('image/jpeg',.68);for(const quality of [.60,.52,.42]){if(dataUrl.length<590000)break;dataUrl=canvas.toDataURL('image/jpeg',quality);}if(dataUrl.length>650000)throw new Error('Foto terlalu besar untuk dikirim. Coba arahkan ulang kamera.');const item={dataUrl,capturedAt:ts,label:c.label};if(c.kind==='p2h'){state.pPhotos[c.key]=item;updatePhotoRow(Number(c.key));}else{state.cPhotos[c.key]=item;renderClean();}closeCamera();toast('Foto diambil langsung dari kamera.');}
/* Signature canvas: transparent PNG and no upload. */
const sigCanvas=$('signature'),sigCtx=sigCanvas.getContext('2d');sigCtx.lineCap='round';sigCtx.lineJoin='round';sigCtx.strokeStyle='#0f172a';sigCtx.lineWidth=3;
function clearSignature(){sigCtx.clearRect(0,0,sigCanvas.width,sigCanvas.height);state.signatureSigned=false;}
function pointFromEvent(e){const r=sigCanvas.getBoundingClientRect();return {x:(e.clientX-r.left)*sigCanvas.width/Math.max(r.width,1),y:(e.clientY-r.top)*sigCanvas.height/Math.max(r.height,1)};}
sigCanvas.addEventListener('pointerdown',(e)=>{if(state.active)return;state.signing=true;sigCanvas.setPointerCapture(e.pointerId);const p=pointFromEvent(e);sigCtx.beginPath();sigCtx.moveTo(p.x,p.y);e.preventDefault();});
sigCanvas.addEventListener('pointermove',(e)=>{if(!state.signing)return;const p=pointFromEvent(e);sigCtx.lineTo(p.x,p.y);sigCtx.stroke();state.signatureSigned=true;e.preventDefault();});
for(const name of ['pointerup','pointercancel','lostpointercapture'])sigCanvas.addEventListener(name,()=>state.signing=false);
function signaturePNG(){if(!state.signatureSigned)throw new Error('Tanda tangan pembuat belum digambar.');const dat=sigCtx.getImageData(0,0,sigCanvas.width,sigCanvas.height).data;let minX=sigCanvas.width,minY=sigCanvas.height,maxX=0,maxY=0,ink=0;for(let y=0;y<sigCanvas.height;y++)for(let x=0;x<sigCanvas.width;x++){const a=dat[(y*sigCanvas.width+x)*4+3];if(a>85){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);ink++;}}if(ink<80)throw new Error('Tanda tangan terlalu kecil, mohon gambar ulang.');const pad=10;const crop=document.createElement('canvas');crop.width=maxX-minX+1+2*pad;crop.height=maxY-minY+1+2*pad;crop.getContext('2d').drawImage(sigCanvas,minX-pad,minY-pad,crop.width,crop.height,0,0,crop.width,crop.height);return crop.toDataURL('image/png');}
function pdfSafe(s){return String(s??'').normalize('NFKD').replace(/[^\x20-\x7e\xA0-\xFF]/g,'?');}
function widthFit(text,font,maxWidth,size=7,minSize=3.9){let n=size;while(n>minSize&&font.widthOfTextAtSize(text,n)>maxWidth)n-=.2;return n;}
function wrappedLines(text,font,size,maxWidth,maxLines){const out=[];let line='';for(const word of pdfSafe(text).split(/\s+/)){const candidate=line?line+' '+word:word;if(font.widthOfTextAtSize(candidate,size)>maxWidth&&line){out.push(line);line=word;}else line=candidate;}if(line)out.push(line);return out.slice(0,maxLines);}
function dataBytes(dataUrl){const part=dataUrl.split(',')[1];const bin=atob(part);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}
function fitImage(image,maxW,maxH){const scale=Math.min(maxW/image.width,maxH/image.height);return {width:image.width*scale,height:image.height*scale};}
async function makeP2HPdf(data,signUrl,recordId){
 return window.FleetPdf.p2h(data,signUrl,recordId,state.pPhotos);
}
async function makeCleanPdf(data,recordId){
 return window.FleetPdf.cleaning(data,state.cPhotos,recordId);
}
function bytesToDataURL(bytes,type){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(new Blob([bytes],{type}));});}
function backendReady(){const url=window.FLEETCHECK_CONFIG?.backendUrl||'';return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/.test(url);}
function postGAS(payload){return new Promise((resolve,reject)=>{if(!backendReady())return reject(new Error('URL Google Apps Script belum diset di config.js.'));const frame=$('backend-frame');const txId=uid('TX');payload.txId=txId;payload.origin=location.origin;const originRegex=/^https:\/\/(?:[a-z0-9-]+\.)*googleusercontent\.com$|^https:\/\/script\.google\.com$/i;let timer;const finish=(err,data)=>{clearTimeout(timer);window.removeEventListener('message',onMessage);try{frame.src='about:blank';}catch(_){}if(err)reject(err);else resolve(data);};const onMessage=(e)=>{if(!originRegex.test(e.origin)||e.data?.type!=='FLEETCHECK_RESULT'||e.data.txId!==txId)return;const d=e.data;if(!d.ok)finish(new Error(d.error||'Gagal menyimpan data.'));else finish(null,d);};window.addEventListener('message',onMessage);timer=setTimeout(()=>finish(new Error('Tidak menerima konfirmasi server. Cek Google Apps Script Executions / jangan submit dua kali sebelum mengecek Google Sheets.')),160000);
 const form=document.createElement('form');form.method='POST';form.action=window.FLEETCHECK_CONFIG.backendUrl;form.target=frame.name;form.enctype='application/x-www-form-urlencoded';form.style.display='none';const input=document.createElement('input');input.name='payload';input.value=JSON.stringify(payload);form.appendChild(input);document.body.appendChild(form);form.submit();form.remove();});}
function localPdfFileName(person,date){
 const clean=(String(person).normalize('NFKC').replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').trim().replace(/^[=+\-@']+/g,'').slice(0,65)||'Pembuat');
 return `${clean}_${date.slice(8,10)}-${date.slice(5,7)}-${date.slice(0,4)}.pdf`;
}
function downloadable(bytes,filename){
 const blob=new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=filename;a.className='btn btn-ghost';a.textContent='⬇ Unduh PDF';
 a.addEventListener('click',()=>setTimeout(()=>URL.revokeObjectURL(url),60000),{once:true});
 return a;
}
function showResult(title,message,links=[]){
 $('p2h-view').hidden=true;$('clean-view').hidden=true;$('history-view').hidden=true;
 $('save-result').hidden=false;$('result-title').textContent=title;$('result-message').textContent=message;
 const target=$('result-links');target.replaceChildren();
 for(const link of links){if(link.nodeType)target.appendChild(link);else{const a=document.createElement('a');a.href=link.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=link.label;target.appendChild(a);}}
 clearError();window.scrollTo({top:0,behavior:'smooth'});
}
async function submitP2H(){
 if(state.active)return;let data,sign;
 try{data=gatherP2H();validateP2H(data);sign=signaturePNG();}catch(e){return alertError(e.message);}
 setBusy(true,'Membuat PDF P2H dengan 4 evidence per halaman...');
 try{
  if(!state.pId)state.pId=uid('P2H');
  const bytes=await makeP2HPdf(data,sign,state.pId);
  if(!backendReady()){
   showResult('PDF P2H Siap Diunduh','Mode pratinjau lokal: belum tersimpan ke Google Drive/Sheets.',[downloadable(bytes,localPdfFileName(data.person_name,data.inspection_date))]);
   return;
  }
  const code=value('access-code');if(!code)throw new Error('Kode akses petugas wajib diisi sebelum menyimpan.');
  toast('Menyimpan P2H, foto dan PDF ke Google...');
  const payload={action:'saveP2H',recordId:state.pId,accessCode:code,data,
   photos:Object.fromEntries(Object.entries(state.pPhotos).map(([k,p])=>[k,{dataUrl:p.dataUrl,capturedAt:p.capturedAt,label:p.label}])),
   signature:sign,pdfDataUrl:await bytesToDataURL(bytes,'application/pdf')};
  const result=await postGAS(payload);
  showResult('P2H Berhasil Disimpan',`Dokumen ${result.recordId} masuk Riwayat Form. Jika file hilang dari HP, unduh ulang di Riwayat.`,
   [{label:'Lihat PDF di Google Drive',url:result.pdfUrl},downloadable(bytes,result.fileName||localPdfFileName(data.person_name,data.inspection_date))]);
 }catch(e){alertError('Gagal menyimpan: '+e.message+' — Jawaban dan foto belum di-reset.');}
 finally{setBusy(false);}
}
async function submitClean(){
 if(state.active)return;
 try{validateClean();}catch(e){return alertError(e.message);}
 setBusy(true,'Membuat PDF Kebersihan Truck 4 foto...');
 try{
  if(!state.cId)state.cId=uid('CLEAN');
  const data={driver:value('c-driver'),plate:value('c-plate'),type:value('c-type'),date:value('c-date')};
  const bytes=await makeCleanPdf(data,state.cId);
  if(!backendReady()){
   showResult('PDF Kebersihan Siap Diunduh','Mode pratinjau lokal: belum disimpan ke Google Sheets/Drive.',[downloadable(bytes,localPdfFileName(data.driver,data.date))]);
   return;
  }
  const code=value('access-code');if(!code)throw new Error('Kode akses petugas wajib diisi sebelum menyimpan.');
  toast('Mengirim 4 foto dan PDF Kebersihan Truck...');
  const payload={action:'saveClean',recordId:state.cId,accessCode:code,data,
   photos:Object.fromEntries(Object.entries(state.cPhotos).map(([k,p])=>[k,{dataUrl:p.dataUrl,capturedAt:p.capturedAt,label:p.label}])),
   pdfDataUrl:await bytesToDataURL(bytes,'application/pdf')};
  const result=await postGAS(payload);
  showResult('Kebersihan Truck Tersimpan',`Dokumen ${result.recordId} sudah menjadi PDF dengan 4 foto dan masuk Riwayat Form.`,
   [{label:'Lihat PDF di Google Drive',url:result.pdfUrl},downloadable(bytes,result.fileName||localPdfFileName(data.driver,data.date))]);
 }catch(e){alertError('Gagal menyimpan: '+e.message+' — Jawaban dan foto belum di-reset.');}
 finally{setBusy(false);}
}
function renderHistory(){
 const records=state.historyRecords;
 $('history-table-body').innerHTML=records.length?records.map(r=>`<tr><td>${safe(r.date.split('-').reverse().join('/'))}<small>${safe(r.recordId)}</small></td><td>${safe(r.type)}</td><td>${safe(r.person)}</td><td>${safe(r.plate)}</td><td>${safe(r.fileName)}</td><td><button class="row-action" data-download-id="${safe(r.recordId)}" ${r.hasPdf?'':'disabled'}>⬇ Download</button><button class="row-action delete" data-delete-id="${safe(r.recordId)}">🗑 Hapus</button></td></tr>`).join(''):'<tr><td colspan="6">Tidak ada riwayat yang cocok.</td></tr>';
 for(const b of document.querySelectorAll('[data-download-id]'))b.onclick=()=>downloadFromHistory(b.dataset.downloadId);
 for(const b of document.querySelectorAll('[data-delete-id]'))b.onclick=()=>openDeleteDialog(b.dataset.deleteId);
}
async function loadHistory(page=1){
 if(state.active)return;
 if(!backendReady()){$('history-status').textContent='Riwayat cloud tersedia setelah URL Apps Script dikonfigurasi.';state.historyRecords=[];renderHistory();return;}
 const code=value('access-code');
 if(!code){$('history-status').textContent='Isi kode akses petugas di panel kiri untuk membaca arsip.';state.historyRecords=[];renderHistory();return;}
 setBusy(true,'Mengambil Riwayat Form...');
 try{
  const data=await postGAS({action:'listRecords',accessCode:code,page,search:value('history-search')});
  state.historyRecords=data.records||[];state.historyPage=data.page||1;state.historyPages=data.pages||1;state.historyTotal=data.total||0;
  renderHistory();
  $('history-page-info').textContent=`Halaman ${state.historyPage} / ${state.historyPages}`;
  $('history-prev').disabled=state.historyPage<=1;$('history-next').disabled=state.historyPage>=state.historyPages;
  $('history-status').textContent=`${state.historyTotal} laporan aktif ditemukan. Ditampilkan maksimal 75 laporan per halaman.`;
 }catch(e){alertError('Riwayat gagal dimuat: '+e.message);$('history-status').textContent='Gagal mengambil arsip.';}
 finally{setBusy(false);}
}
async function downloadFromHistory(id){
 if(state.active)return;const row=state.historyRecords.find(r=>r.recordId===id);if(!row)return;
 setBusy(true,'Mengunduh PDF dari Google Drive...');
 try{
  const data=await postGAS({action:'downloadPdf',recordId:id,accessCode:value('access-code'),actorName:row.person});
  const binary=atob(data.pdfBase64),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  const a=downloadable(bytes,data.fileName||row.fileName);document.body.append(a);a.click();a.remove();toast('PDF arsip sudah diminta untuk diunduh.');
 }catch(e){alertError('Tidak berhasil mengunduh PDF: '+e.message);}
 finally{setBusy(false);}
}
function openDeleteDialog(id){
 if(state.active)return;const row=state.historyRecords.find(r=>r.recordId===id);if(!row)return;
 if(!window.confirm(`Tahap 1/2 — Anda yakin ingin menghapus dari riwayat?\n\n${row.type}\n${row.person} | ${row.date}\n${row.fileName}\n\nPDF dan foto akan dipindah ke Trash Google Drive, sementara audit tetap tersimpan.`))return;
 state.deletionTarget=row;
 $('delete-desc').textContent=`Dokumen: ${row.fileName} | ${row.plate} | ID ${row.recordId}`;
 $('delete-actor').value='';$('delete-phrase').value='';$('delete-confirm').disabled=true;$('delete-modal').hidden=false;$('delete-actor').focus();
}
function closeDeleteDialog(){if(state.active)return;state.deletionTarget=null;$('delete-modal').hidden=true;}
function validateDeleteDialog(){
 $('delete-confirm').disabled=state.active || !$('delete-actor').value.trim() || $('delete-phrase').value.trim()!=='HAPUS';
}
async function confirmDeleteFromHistory(){
 const row=state.deletionTarget;if(!row||state.active||!value('delete-actor')||value('delete-phrase')!=='HAPUS')return;
 const actor=value('delete-actor');$('delete-modal').hidden=true;
 setBusy(true,'Memindahkan dokumen ke Trash Google Drive...');
 try{
  await postGAS({action:'deleteRecord',recordId:row.recordId,confirmRecordId:row.recordId,confirmText:'HAPUS',actorName:actor,accessCode:value('access-code')});
  state.historyRecords=state.historyRecords.filter(x=>x.recordId!==row.recordId);state.deletionTarget=null;renderHistory();
  state.historyTotal=Math.max(0,state.historyTotal-1);
  $('history-status').textContent=`${state.historyTotal} laporan aktif. Dokumen ${row.recordId} dihapus dari arsip aktif (soft delete).`;
  toast('Dokumen dipindah ke Trash Drive. Audit tetap ada.');
 }catch(e){alertError('Gagal menghapus: '+e.message);}
 finally{setBusy(false);}
}
function init(){
 renderChecklist();renderClean();$('p-date').value=dateStr();$('p-time').value=timeStr();$('c-date').value=dateStr();
 for(const n of document.querySelectorAll('.nav'))n.onclick=()=>setView(n.dataset.view);
 $('go-review').onclick=()=>{try{reviewP2H();}catch(e){alertError(e.message);}};
 $('back-form').onclick=()=>setStep(1);$('go-sign').onclick=()=>setStep(3);$('back-review').onclick=()=>setStep(2);
 $('clear-sign').onclick=clearSignature;
 $('new-p2h').onclick=()=>{if(confirm('Kosongkan form P2H dan seluruh foto yang sudah diambil?'))resetP2H();};
 $('new-clean').onclick=()=>{if(confirm('Kosongkan form Kebersihan Truck dan seluruh foto yang sudah diambil?'))resetClean();};
 $('submit-p2h').onclick=submitP2H;$('submit-clean').onclick=submitClean;
 $('result-new').onclick=()=>{if(state.view==='p2h')resetP2H();else resetClean();};
 $('history-search').oninput=()=>{clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>loadHistory(1),500);};
 $('history-refresh').onclick=()=>loadHistory(1);$('history-prev').onclick=()=>loadHistory(state.historyPage-1);$('history-next').onclick=()=>loadHistory(state.historyPage+1);
 $('delete-cancel').onclick=closeDeleteDialog;
 $('delete-actor').oninput=validateDeleteDialog;$('delete-phrase').oninput=validateDeleteDialog;
 $('delete-confirm').onclick=confirmDeleteFromHistory;
 $('camera-close').onclick=closeCamera;
 $('camera-capture').onclick=()=>{try{captureCamera();}catch(e){alertError(e.message);}};
 window.addEventListener('pagehide',closeCamera);
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.camera)closeCamera();});
 if(!backendReady())toast('Mode pratinjau lokal: Google Apps Script belum dikonfigurasi.');
}

init();
