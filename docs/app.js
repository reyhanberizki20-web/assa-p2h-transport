'use strict';
/* FleetCheck R3.6. JSON transport with HTML form fallback, verified cloud save. */
const $ = (id) => document.getElementById(id);
const ITEMS = window.MASTER_P2H.items;
const P2H_SCHEMA = 'P2H-27-V1';
const MASTER = window.FLEETCHECK_MASTER;
const OTHER = '__other__';
const APAR_ROW = 20; // Item 09 in the original Master P2H.
/* Keep dropdown master values separate from optional, manually typed values. */
function selectedMasterValue(id) {
 const result = value(id) === OTHER ? value(id+'-other') : value(id);
 return ['c-plate','p-plate'].includes(id) ? result.toUpperCase().replace(/\s+/g,' ').trim() : result;
}
function syncOtherInput(id) {
 const isOther = value(id)===OTHER;
 const wrapper = $(id+'-other-wrap');
 const input = $(id+'-other');
 wrapper.hidden = !isOther;
 input.disabled = !isOther;
 input.required = isOther;
 if(!isOther)input.value='';
 $(id).setAttribute('aria-expanded',String(isOther));
}
function initReferenceDropdowns() {
 if(!MASTER || !Array.isArray(MASTER.personRoles) || !Array.isArray(MASTER.roles) || !Array.isArray(MASTER.plates))
   throw new Error('Master dropdown belum dimuat. Pastikan master-options.js tersedia.');
 const groups = {
  'p-person': MASTER.personRoles.map(p=>p.name),
  'c-driver': MASTER.personRoles.map(p=>p.name),
  'p-role': MASTER.roles,
  'c-plate': MASTER.plates,
  'p-plate': MASTER.plates
 };
 for(const [id, entries] of Object.entries(groups)) {
  const select=$(id);
  // Preserve the placeholder, then render choices from the local master.
  select.replaceChildren(new Option(select.options[0]?.textContent||'-- Pilih --',''));
  for(const name of entries)select.add(new Option(name,name));
  select.add(new Option('Others - Isi manual',OTHER));
  select.value='';
  select.addEventListener('change',()=>syncOtherInput(id));
  syncOtherInput(id);
 }
 $('p-person').addEventListener('change',()=>{
  const chosen=MASTER.personRoles.find(p=>p.name===selectedMasterValue('p-person'));
  $('p-role').value=chosen?.role||'';
  syncOtherInput('p-role');
 });
 for(const id of ['c-plate-other','p-plate-other'])$(id).addEventListener('blur',()=>{
  $(id).value=$(id).value.toUpperCase().replace(/\s+/g,' ').trim();
 });
}

const state = {
  view: 'p2h', step: 1, pPhotos: {}, cPhotos: {}, camera: null,
  stream: null, signatureSigned: false, signing: false, active: false,
  pId: null, cId: null, pSaved: false, cSaved: false, lastPdf: null, historyRecords: [], historyPage: 1, historyPages: 1, historyTotal: 0, historySelected: new Set(), historyReady: false, historyKey: '', bulkCancelled: false, deletionTarget: null
};
const safe = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const value = (id) => ($(id).value || '').trim();
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3500);}
function alertError(message){const el=$('global-alert');el.textContent=message;el.hidden=false;el.scrollIntoView({behavior:'smooth',block:'center'});}
function clearError(){$('global-alert').hidden=true;}
function dateStr(d = new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function timeStr(d = new Date()){return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
function uid(prefix){const d=new Date();const token=(globalThis.crypto?.randomUUID?.() || String(Math.random()).slice(2)).replace(/-/g,'').slice(0,10).toUpperCase();return `${prefix}-${dateStr(d).replace(/-/g,'')}-${token}`;}
function setBusy(busy,label){state.active=busy;for(const id of ['submit-p2h','submit-clean','history-refresh'])$(id).disabled=busy;validateDeleteDialog();updateHistoryControls();if(busy)toast(label||'Memproses...');}
function setView(which){
 if(state.active)return;closeCamera();state.view=which;clearError();
 if(which==='p2h'&&state.pSaved)resetP2H();
 if(which==='clean'&&state.cSaved)resetClean();
 if(which!=='history'){clearTimeout(state.searchTimer);clearHistoryDownload();clearHistorySelection();}
 $('save-result').hidden=true;$('p2h-view').hidden=which!=='p2h';
 $('clean-view').hidden=which!=='clean';$('history-view').hidden=which!=='history';
 for(const b of document.querySelectorAll('.nav'))b.classList.toggle('active',b.dataset.view===which);
 const cfg={p2h:['Pemeriksaan P2H','FORM INSPEKSI','Pemeriksaan kelayakan & perlengkapan container dan truck vendor.'],clean:['Kebersihan Truck','FORM KEBERSIHAN','Empat evidence kamera langsung termasuk Sterico Trap sebelum dan sesudah.'],history:['Riwayat Form','ARSIP DIGITAL','Cari hasil pengisian, unduh ulang PDF atau hapus dengan double verification.']}[which];
 $('page-title').textContent=cfg[0];$('page-eyebrow').textContent=cfg[1];$('page-subtitle').textContent=cfg[2];
 if(which==='history')loadHistory(1,true);window.scrollTo({top:0,behavior:'smooth'});
}
function setStep(n){state.step=n;for(let i=1;i<=3;i++){$(`p2h-step-${i}`).hidden=i!==n;}for(const s of document.querySelectorAll('.stepper [data-step]')){const sn=Number(s.dataset.step);s.classList.toggle('current',sn===n);s.classList.toggle('done',sn<n);}if(n===3)$('sign-name').textContent=selectedMasterValue('p-person')+' • '+selectedMasterValue('p-role');clearError();window.scrollTo({top:0,behavior:'smooth'});}
function renderChecklist(){const frag=[];let prev='';for(let idx=0;idx<ITEMS.length;idx++){const item=ITEMS[idx];if(item.section!==prev){prev=item.section;frag.push(`<div class="check-section">${safe(item.section)}</div>`);}const req=item.point?`<span class="check-tag">Titik ${item.point} • Foto Wajib</span>`:'';frag.push(`<div class="check-row" data-row="${item.row}"><div class="check-row-top"><span class="check-num">${String(idx+1).padStart(2,'0')}</span><div class="check-name">${safe(item.row===APAR_ROW?'Alat Pemadam Api (APAR)':item.label)}</div>${req}</div>${item.row===APAR_ROW?`<div class="apar-date-field fields-grid"><label for="p-apar-expiry">Expired Date (APAR)<input id="p-apar-expiry" type="date" aria-describedby="apar-date-help"><small id="apar-date-help">Wajib jika OK. Jika NOK dan tanggal tidak diketahui, isi keterangan.</small></label></div>`:''}<div class="check-controls" role="group" aria-label="Status ${safe(item.label)}"><label class="radio-label"><input type="radio" name="st-${item.row}" value="ok">OK</label><label class="radio-label nok"><input type="radio" name="st-${item.row}" value="nok">NOK</label></div><input class="check-note" data-note="${item.row}" maxlength="72" placeholder="Keterangan NOK wajib diisi" hidden><div class="photo-row"><button type="button" class="btn-photo" data-photo="${item.row}">📷 Ambil Foto</button><span class="photo-status" data-photo-status="${item.row}">${item.point?'Foto wajib': 'Wajib jika NOK / opsional jika OK'}</span><img class="photo-thumb" data-thumb="${item.row}" hidden alt="Pratinjau foto evidence"></div></div>`);} $('p2h-checklist').innerHTML=frag.join('');
  for(const el of document.querySelectorAll('.check-row')) {const row=Number(el.dataset.row);el.querySelectorAll('input[type=radio]').forEach(inp=>inp.addEventListener('change',()=>{const nok=el.querySelector('input[value=nok]').checked;el.classList.toggle('is-nok',nok);el.querySelector('.check-note').hidden=!nok;if(row===APAR_ROW)$('p-apar-expiry').required=!nok;updatePhotoRow(row);}));}
  for(const btn of document.querySelectorAll('[data-photo]'))btn.addEventListener('click',()=>{const item=ITEMS.find(i=>i.row===Number(btn.dataset.photo));openCamera('p2h',item.row,item.label);});
}
function updatePhotoRow(row){const image=state.pPhotos[row],item=ITEMS.find(i=>i.row===row),nok=document.querySelector(`input[name="st-${row}"][value="nok"]`).checked;const txt=document.querySelector(`[data-photo-status="${row}"]`),thumb=document.querySelector(`[data-thumb="${row}"]`),button=document.querySelector(`[data-photo="${row}"]`);if(image){thumb.src=image.dataUrl;thumb.hidden=false;txt.textContent=`✓ Foto ${image.capturedAt}`;txt.style.color='#047857';button.textContent='↻ Ulangi Foto';} else{thumb.hidden=true;txt.textContent=item.point?'Foto wajib':(nok?'Foto wajib karena NOK':'Foto opsional');txt.style.color='';button.textContent='📷 Ambil Foto';}}
function renderClean(){
 const arr=window.FleetPdf.cleanAreas;
 $('clean-photogrid').innerHTML=arr.map((x,i)=>{
 const p=state.cPhotos[x.key];
 return `<div class="photo-card"><b>${String(i+1).padStart(2,'0')}. ${safe(x.label)} *</b>${p?`<img class="photo-big" src="${p.dataUrl}" alt="Foto bukti pembersihan"><small>${safe(p.capturedAt)}</small>`:'<span style="font-size:34px">📷</span><small>Belum ada foto - wajib</small>'}<button class="btn-photo" type="button" data-clean-photo="${x.key}">${p?'↻ Ulangi Foto':'📷 Buka Kamera Langsung'}</button></div>`;
 }).join('');
 for(const btn of document.querySelectorAll('[data-clean-photo]'))btn.onclick=()=>openCamera('clean',btn.dataset.cleanPhoto,btn.closest('.photo-card').querySelector('b').textContent);
}
function gatherP2H(){const d={checklist_version:P2H_SCHEMA,person_name:selectedMasterValue('p-person'),role:selectedMasterValue('p-role'),truck:value('p-truck'),container:value('p-container'),plate:selectedMasterValue('p-plate'),apar_expiry_date:value('p-apar-expiry'),kilometer:value('p-km'),inspection_date:value('p-date'),inspection_time:value('p-time'),additional_notes:value('p-notes'),checks:{}};for(const item of ITEMS){const status=document.querySelector(`input[name="st-${item.row}"]:checked`)?.value||'';d.checks[item.row]={number:item.number,label:item.label,status,note:document.querySelector(`[data-note="${item.row}"]`).value.trim()};}d.checks[APAR_ROW].expiry_date=d.apar_expiry_date;return d;}
function validCalendarDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;}
function validateP2H(d){for(const [field,label] of [['person_name','Nama pembuat'],['role','Peran pembuat'],['truck','Truck'],['container','Container'],['plate','Nomor polisi'],['kilometer','Kilometer'],['inspection_date','Tanggal'],['inspection_time','Jam']])if(!d[field])throw new Error(label+' wajib diisi.');for(const item of ITEMS){const s=d.checks[item.row];if(!['ok','nok'].includes(s.status))throw new Error('Checklist belum diisi: '+item.label);if(item.row===APAR_ROW){if(s.status==='ok'&&!d.apar_expiry_date)throw new Error('Expired Date APAR wajib diisi jika hasil OK.');if(d.apar_expiry_date&&!validCalendarDate(d.apar_expiry_date))throw new Error('Expired Date APAR tidak valid.');}if(s.status==='nok'&&!s.note)throw new Error('Keterangan NOK wajib: '+item.label);if((item.point||s.status==='nok')&&!state.pPhotos[item.row])throw new Error('Foto evidence wajib: '+item.label);}return true;}
function validateClean(){
 if(!selectedMasterValue('c-driver') || !selectedMasterValue('c-plate') || !value('c-date'))throw new Error('Isi nama driver, nomor polisi, dan tanggal. Pilihan Others harus diisi manual.');
 for(const a of window.FleetPdf.cleanAreas)if(!state.cPhotos[a.key])throw new Error('Foto wajib: '+a.title+'. Buka kamera langsung.');
}
function reviewP2H(){const d=gatherP2H();validateP2H(d);const fields=[['Pembuat',d.person_name],['Peran',d.role],['No. Polisi',d.plate],['Truck',d.truck],['Container',d.container],['Kilometer',d.kilometer],['Tanggal / Jam',`${d.inspection_date} • ${d.inspection_time}`],['Foto Evidence',`${Object.keys(state.pPhotos).length} foto`]];const rows=ITEMS.map((item,i)=>{const s=d.checks[item.row],has=!!state.pPhotos[item.row];return `<tr><td>${i+1}</td><td>${safe(item.row===APAR_ROW?'Alat Pemadam Api (APAR)':item.label)}${item.row===APAR_ROW?`<small style="display:block;color:#334155">Expired Date: ${safe(d.apar_expiry_date?d.apar_expiry_date.split('-').reverse().join('/'):'Tidak diketahui')}</small>`:''}${s.note?`<small style="display:block;color:#64748b">${safe(s.note)}</small>`:''}</td><td><span class="pill ${s.status}">${s.status.toUpperCase()}</span></td><td>${has?'📷 Ya':'—'}</td></tr>`;}).join('');const photosPreview=ITEMS.filter(item=>state.pPhotos[item.row]).map(item=>{const p=state.pPhotos[item.row];return `<div class="review-photo"><img src="${p.dataUrl}" alt="Foto ${safe(item.label)}"><div><b>${safe(item.point?'Item '+item.number+' / Titik '+item.point:'Item '+item.number+' - '+item.label)}</b><small>${safe(p.capturedAt)} • ${safe(d.checks[item.row].status.toUpperCase())}</small></div></div>`;}).join('');$('review-p2h').innerHTML=`<div class="review-meta">${fields.map(([a,b])=>`<div class="review-field"><small>${a}</small><b>${safe(b)}</b></div>`).join('')}</div><div style="overflow-x:auto"><table class="review-table"><thead><tr><th>No.</th><th>Pemeriksaan</th><th>Status</th><th>Foto</th></tr></thead><tbody>${rows}</tbody></table></div><div class="section-title"><div><span>📷</span><b>Review Foto Evidence (${Object.keys(state.pPhotos).length})</b></div></div><div class="review-gallery">${photosPreview}</div>${d.additional_notes?`<div class="notice"><span>📝</span><div><b>Catatan</b><p>${safe(d.additional_notes)}</p></div></div>`:''}`;setStep(2);}
function resetP2H(){
 if(state.active)return;
 state.pPhotos={};state.pId=null;state.pSaved=false;state.lastPdf=null;
 for(const id of ['p-person','p-role','p-plate']){$(id).value='';syncOtherInput(id);}
 for(const id of ['p-truck','p-container','p-km','p-notes'])$(id).value='';
 $('p-date').value=dateStr();$('p-time').value=timeStr();
 renderChecklist();clearSignature();setStep(1);$('save-result').hidden=true;$('p2h-view').hidden=false;
}
function resetClean(){
 if(state.active)return;
 state.cPhotos={};state.cId=null;state.cSaved=false;
 for(const id of ['c-driver','c-plate']){$(id).value='';syncOtherInput(id);}
 $('c-type').selectedIndex=0;$('c-date').value=dateStr();renderClean();
 $('save-result').hidden=true;$('clean-view').hidden=false;clearError();
}
async function openCamera(kind,key,label){
 if(state.active)return;clearError();
 let clearFollowing=[];
 if(kind==='clean'){
  const areas=window.FleetPdf.cleanAreas,index=areas.findIndex(a=>a.key===key);
  if(index<0){alertError('Jenis foto tidak dikenal.');return;}
  const missing=areas.slice(0,index).find(a=>!state.cPhotos[a.key]);
  if(missing){alertError('Ambil foto '+missing.label+' terlebih dahulu.');return;}
  clearFollowing=areas.slice(index+1).map(a=>a.key).filter(k=>state.cPhotos[k]);
  if(clearFollowing.length&&!confirm('Mengulang foto ini akan mengosongkan foto setelahnya agar urutan dokumentasi tetap benar. Lanjutkan?'))return;
 }
 closeCamera();state.camera={kind,key,label,clearFollowing};$('camera-label').textContent=label;$('camera-meta').textContent='';$('camera-modal').hidden=false;try{if(!navigator.mediaDevices?.getUserMedia)throw new Error('Browser tidak mendukung kamera langsung. Buka melalui HTTPS (GitHub Pages) atau localhost.');state.stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}}});$('camera-video').srcObject=state.stream;await $('camera-video').play();}catch(err){closeCamera();alertError('Kamera tidak bisa dibuka: '+(err.message||err.name)+'. Izinkan akses kamera dan gunakan HTTPS.');}}
function closeCamera(){if(state.stream){for(const t of state.stream.getTracks())t.stop();state.stream=null;}$('camera-video').srcObject=null;$('camera-modal').hidden=true;state.camera=null;}
function captureCamera(){const c=state.camera,v=$('camera-video');if(!c||!v.videoWidth)throw new Error('Kamera belum siap.');const ratio=Math.min(1,1280/v.videoWidth,960/v.videoHeight);const w=Math.round(v.videoWidth*ratio),h=Math.round(v.videoHeight*ratio);const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.drawImage(v,0,0,w,h);
  const d=new Date();const ts=d.toLocaleString('id-ID',{hour12:false});const plate=(c.kind==='p2h'?selectedMasterValue('p-plate'):selectedMasterValue('c-plate')).toUpperCase().slice(0,28);ctx.fillStyle='rgba(10,17,34,0.80)';ctx.fillRect(0,h-39,w,39);ctx.fillStyle='#fff';ctx.font=`bold ${Math.max(12,Math.round(w/90))}px Arial`;ctx.fillText(`FleetCheck • ${plate||'KENDARAAN'} • ${c.kind==='p2h'?'P2H '+(ITEMS.find(i=>i.row===Number(c.key))?.number||c.key):String(c.label).slice(0,45)}`,12,h-23);ctx.font=`${Math.max(10,Math.round(w/110))}px Arial`;ctx.fillText(`Waktu perangkat: ${ts}`,12,h-8);
  let dataUrl=canvas.toDataURL('image/jpeg',.68);for(const quality of [.60,.52,.45,.38,.32]){if(dataUrl.length<420000)break;dataUrl=canvas.toDataURL('image/jpeg',quality);}if(dataUrl.length>450000)throw new Error('Foto terlalu besar untuk dikirim. Coba arahkan ulang kamera.');const item={dataUrl,capturedAt:ts,label:c.label};if(c.kind==='p2h'){state.pPhotos[c.key]=item;updatePhotoRow(Number(c.key));}else{for(const key of c.clearFollowing||[])delete state.cPhotos[key];state.cPhotos[c.key]=item;renderClean();}closeCamera();toast('Foto diambil langsung dari kamera.');}
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
// Only accept HTTPS Apps Script Web App endpoints on Google's actual host.
// The copied URL can be scoped to a Workspace domain or account. Whitespace
// and a trailing slash are harmless configuration typos, not a new endpoint.
function getBackendUrl(){
 const raw=window.FLEETCHECK_CONFIG?.backendUrl;
 if(typeof raw!=='string'||!raw.trim()||raw.includes('PASTE_GOOGLE_APPS_SCRIPT_EXEC_URL_HERE'))return '';
 try{
  const url=new URL(raw.trim());
  if(url.origin!=='https://script.google.com'||url.username||url.password||url.hash)return '';
  const path=url.pathname.replace(/\/+$/,'');
  const valid=/^\/(?:macros(?:\/u\/\d+)?|u\/\d+\/macros|a\/[a-z0-9.-]+\/macros|a\/macros\/[a-z0-9.-]+)\/s\/[A-Za-z0-9_-]+\/exec$/i.test(path);
  if(!valid)return '';
  url.pathname=path;
  return url.href;
 }catch(_){return '';}
}
function backendReady(){return !!getBackendUrl();}
const API_VERSION='R3.3.3';
function checkReply(data,txId){
 if(data?.type!=='FLEETCHECK_RESULT'||data.txId!==txId)throw new Error('Respons backend tidak sesuai request.');
 if(data.apiVersion!==API_VERSION){
  const actual=typeof data.apiVersion==='string'&&/^[A-Za-z0-9._-]{1,40}$/.test(data.apiVersion)?data.apiVersion:'tidak dilaporkan';
  throw new Error(`Versi API backend: ${actual}; diperlukan ${API_VERSION}. Admin: buka URL /exec yang sama dengan config.js, cek versi, lalu update Code.gs dan Deploy > Manage deployments > Edit > New version. Jangan reset form.`);
 }
 if(!data.ok)throw new Error(data.error||'Permintaan gagal.');
 return data;
}
async function postGAS(payload){
 const backendUrl=getBackendUrl();
 if(!backendUrl)throw new Error('URL Google Apps Script /exec belum benar di config.js. Admin: salin Web app URL dari Deploy > Manage deployments, lalu perbarui docs/config.js di GitHub.');
 const txId=uid('TX'),request={...payload,txId,origin:location.origin,clientApiVersion:API_VERSION},body=JSON.stringify(request);
 if(body.length>28000000)throw new Error('Ukuran data melebihi 28 MB. Kurangi ukuran evidence tanpa menghapus foto wajib.');
 // A simple text/plain request avoids a preflight. Apps Script ContentService
 // redirects to googleusercontent.com; browser follows it. Some browsers or
 // policies reject the cross-origin response; fallback retains the same record ID.
 const controller=new AbortController();let timer=setTimeout(()=>controller.abort(),160000),response;
 try{
  const res=await fetch(backendUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body,redirect:'follow',credentials:'omit',signal:controller.signal});
  if(res.ok){try{response=await res.json();}catch(_){} }
 }catch(e){if(controller.signal.aborted)throw new Error('Server belum memberi konfirmasi. Cek Riwayat atau Executions, lalu coba ulang tanpa reset form (ID sama).');}
 finally{clearTimeout(timer);}
 if(response?.type==='FLEETCHECK_RESULT'&&response.txId===txId)return checkReply(response,txId);
 return postGASFrame(request,body,txId,backendUrl);
}
function postGASFrame(request,body,txId,backendUrl){return new Promise((resolve,reject)=>{
 const frame=$('backend-frame');const originRegex=/^https:\/\/(?:[a-z0-9-]+\.)*googleusercontent\.com$|^https:\/\/script\.google\.com$/i;let timer;
 const finish=(err,data)=>{clearTimeout(timer);window.removeEventListener('message',onMessage);try{frame.src='about:blank';}catch(_){}if(err)reject(err);else resolve(data);};
 const onMessage=(e)=>{if(!originRegex.test(e.origin)||e.data?.type!=='FLEETCHECK_RESULT'||e.data.txId!==txId)return;try{finish(null,checkReply(e.data,txId));}catch(err){finish(err);}};
 window.addEventListener('message',onMessage);timer=setTimeout(()=>finish(new Error('Tidak menerima konfirmasi server. Periksa URL /exec, izin Web App, SITE_ORIGIN, dan Apps Script Executions. Cek Riwayat sebelum mencoba ulang.')),160000);
 const form=document.createElement('form');form.method='POST';form.action=backendUrl;form.target=frame.name;form.enctype='application/x-www-form-urlencoded';form.style.display='none';const input=document.createElement('input');input.name='payload';input.value=body;form.appendChild(input);document.body.appendChild(form);try{form.submit();}catch(err){finish(err);}finally{form.remove();}
 });}
async function checkCloudReady(requireP2H=false){
 const health=await postGAS({action:'health'});
 if(requireP2H && (health.p2hChecklistVersion!==P2H_SCHEMA || window.MASTER_P2H.schemaVersion!==P2H_SCHEMA || ITEMS.length!==27))throw new Error('Checklist P2H 27 item belum sinkron. Admin: update Code.gs ke Build R3.6 atau R3.5 dan deploy New version, lalu pastikan GitHub memuat master-map.js terbaru.');
 if(!health.storageReady)throw new Error('Storage belum siap. Admin: jalankan setupStorage dan verifyStorage di Apps Script.');
 if(!health.publicSubmit)throw new Error('Admin belum mengaktifkan PUBLIC_SUBMIT=true di Script Properties.');
 if(!health.publicHistory)throw new Error('Admin belum mengaktifkan PUBLIC_HISTORY=true; PDF tidak dapat diunduh kembali.');
}
async function sha256Bytes(bytes){
 if(!globalThis.crypto?.subtle)return null;
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
}
function archiveBytes(data){
 if(!data.pdfBase64)throw new Error('PDF arsip kosong.');
 const bytes=dataBytes('data:application/pdf;base64,'+data.pdfBase64);
 if(bytes.length<5||String.fromCharCode(...bytes.subarray(0,5))!=='%PDF-')throw new Error('Berkas arsip bukan PDF yang valid.');
 return bytes;
}
async function archivedPdf(data){
 const bytes=archiveBytes(data),actual=await sha256Bytes(bytes);
 if(actual&&data.pdfSha256&&actual!==data.pdfSha256)throw new Error('Checksum unduhan PDF tidak cocok.');
 return bytes;
}
async function showVerifiedSave(result,recordId,bytes,title){
 if(!result.storageVerified||result.recordId!==recordId||!result.fileName||!result.pdfSha256)throw new Error('Server belum memverifikasi baris database dan PDF Drive.');
 const links=[];
 let downloadError='';
 try{
  const hash=await sha256Bytes(bytes);
  const verifiedBytes=hash&&hash===result.pdfSha256?bytes:await archivedPdf(await postGAS({action:'downloadPdf',recordId}));
  links.push(downloadable(verifiedBytes,result.fileName));
 }catch(e){downloadError=' PDF tersimpan, tetapi unduhan langsung belum berhasil; buka Riwayat Form untuk mencoba lagi.';}
 const history=document.createElement('button');history.type='button';history.className='btn btn-ghost';history.textContent='Buka Riwayat Form';history.onclick=()=>setView('history');links.push(history);
 showResult(title,`Dokumen ${recordId} telah diverifikasi di Google Sheets & Drive. PDF asli tersimpan dalam Riwayat Form.${result.alreadySaved?' Laporan ini sudah tersimpan pada percobaan sebelumnya; tidak dibuat duplikat.':''}${downloadError}`,links);
}
function localPdfFileName(person,date){
 const clean=(String(person).normalize('NFKC').replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').trim().replace(/^[=+\-@']+/g,'').slice(0,65)||'Pembuat');
 return `${clean}_${date.slice(8,10)}-${date.slice(5,7)}-${date.slice(0,4)}.pdf`;
}
function downloadable(bytes,filename){
 const blob=new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=filename;a.className='btn btn-ghost';a.textContent='⬇ Unduh PDF';
 // Revoke when the link is replaced; do not expire an on-screen link before the user taps it.
 return a;
}
function showResult(title,message,links=[]){
 $('p2h-view').hidden=true;$('clean-view').hidden=true;$('history-view').hidden=true;
 $('save-result').hidden=false;$('result-title').textContent=title;$('result-message').textContent=message;
 const target=$('result-links');for(const a of target.querySelectorAll('a[href^="blob:"]'))URL.revokeObjectURL(a.href);target.replaceChildren();
 for(const link of links){if(link.nodeType)target.appendChild(link);else{const a=document.createElement('a');a.href=link.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=link.label;target.appendChild(a);}}
 clearError();window.scrollTo({top:0,behavior:'smooth'});
}
async function submitP2H(){
 if(state.active)return;let data,sign;
 try{data=gatherP2H();validateP2H(data);sign=signaturePNG();}catch(e){return alertError(e.message);}
 setBusy(true,'Membuat PDF P2H dengan 4 evidence per halaman...');
 try{
  await checkCloudReady(true);
  if(!state.pId)state.pId=uid('P2H');
  const bytes=await makeP2HPdf(data,sign,state.pId);
  toast('Menyimpan P2H, foto dan PDF ke Google...');
  const payload={action:'saveP2H',recordId:state.pId,data,
   photos:Object.fromEntries(Object.entries(state.pPhotos).map(([k,p])=>[k,{dataUrl:p.dataUrl,capturedAt:p.capturedAt,label:p.label}])),
   signature:sign,pdfDataUrl:await bytesToDataURL(bytes,'application/pdf')};
  const result=await postGAS(payload);
  await showVerifiedSave(result,state.pId,bytes,'P2H Berhasil Disimpan');state.pSaved=true;
 }catch(e){alertError('Gagal menyimpan: '+e.message+' — Jawaban dan foto belum di-reset.');}
 finally{setBusy(false);}
}
async function submitClean(){
 if(state.active)return;
 try{validateClean();}catch(e){return alertError(e.message);}
 setBusy(true,'Membuat PDF Kebersihan Truck 4 foto...');
 try{
  await checkCloudReady();
  if(!state.cId)state.cId=uid('CLEAN');
  const data={driver:selectedMasterValue('c-driver'),plate:selectedMasterValue('c-plate'),type:value('c-type'),date:value('c-date')};
  const bytes=await makeCleanPdf(data,state.cId);
  toast('Mengirim 4 foto dan PDF Kebersihan Truck...');
  const payload={action:'saveClean',recordId:state.cId,data,
   photos:Object.fromEntries(Object.entries(state.cPhotos).map(([k,p])=>[k,{dataUrl:p.dataUrl,capturedAt:p.capturedAt,label:p.label}])),
   pdfDataUrl:await bytesToDataURL(bytes,'application/pdf')};
  const result=await postGAS(payload);
  await showVerifiedSave(result,state.cId,bytes,'Kebersihan Truck Tersimpan');state.cSaved=true;
 }catch(e){alertError('Gagal menyimpan: '+e.message+' — Jawaban dan foto belum di-reset.');}
 finally{setBusy(false);}
}
function historyFilters(){return {search:value('history-search'),dateFrom:value('history-date-from'),dateTo:value('history-date-to'),formType:value('history-form-type')};}
function historyFilterKey(){return JSON.stringify(historyFilters());}
function validateHistoryFilters(f){if((f.dateFrom&&!validCalendarDate(f.dateFrom))||(f.dateTo&&!validCalendarDate(f.dateTo)))throw new Error('Filter tanggal tidak valid.');if(f.dateFrom&&f.dateTo&&f.dateFrom>f.dateTo)throw new Error('Tanggal mulai tidak boleh melebihi tanggal akhir.');}
function clearHistoryDownload(){
 const area=$('history-download-link');for(const a of area.querySelectorAll('a[href^="blob:"]'))URL.revokeObjectURL(a.href);area.replaceChildren();$('history-download-ready').hidden=true;
}
function clearHistorySelection(){state.historySelected.clear();clearHistoryDownload();updateHistoryControls();}
function updateHistoryControls(){
 const selected=state.historySelected,ready=state.historyReady&&state.historyKey===historyFilterKey(),usable=ready&&!state.active;
 for(const id of ['history-search','history-date-from','history-date-to','history-form-type','history-reset'])$(id).disabled=state.active;
 const all=$('history-select-all');all.disabled=!usable||state.historyTotal===0;all.checked=!!state.historySelectingAll||(ready&&state.historyTotal>0&&selected.size===state.historyTotal&&state.historyRecords.every(r=>selected.has(r.recordId)));all.indeterminate=ready&&selected.size>0&&!all.checked;
 $('history-selected-count').textContent=`${selected.size} dari ${state.historyTotal} laporan dipilih`;
 $('history-bulk-download').textContent=`⬇ Download Terpilih (${selected.size})`;$('history-bulk-download').disabled=!usable||!selected.size;
 $('history-clear-selection').disabled=state.active||!selected.size;
 $('history-prev').disabled=!usable||state.historyPage<=1;$('history-next').disabled=!usable||state.historyPage>=state.historyPages;
 for(const c of $('history-table-body').querySelectorAll('[data-select-id]')){c.checked=selected.has(c.dataset.selectId);c.disabled=!usable;c.closest('tr').classList.toggle('is-selected',c.checked);}
 for(const b of $('history-table-body').querySelectorAll('[data-download-id],[data-view-id],[data-delete-id]'))b.disabled=!usable||b.dataset.hasPdf==='false';
}
function renderHistory(){
 const records=state.historyRecords;
 $('history-table-body').innerHTML=records.length?records.map(r=>`<tr><td class="history-check-cell"><input type="checkbox" data-select-id="${safe(r.recordId)}" aria-label="Pilih ${safe(r.fileName)} (${safe(r.recordId)})"></td><td>${safe(r.date.split('-').reverse().join('/'))}<small>${safe(r.recordId)}</small></td><td>${safe(r.type)}</td><td>${safe(r.person)}</td><td>${safe(r.plate)}</td><td>${safe(r.fileName)}</td><td class="history-action-cell"><button type="button" class="row-action view" data-view-id="${safe(r.recordId)}" data-has-pdf="${!!r.hasPdf}">View</button><button type="button" class="row-action" data-download-id="${safe(r.recordId)}" data-has-pdf="${!!r.hasPdf}">⬇ Download</button><button type="button" class="row-action delete" data-delete-id="${safe(r.recordId)}">🗑 Hapus</button></td></tr>`).join(''):'<tr><td colspan="7">Tidak ada riwayat yang cocok.</td></tr>';
 for(const c of $('history-table-body').querySelectorAll('[data-select-id]'))c.onchange=()=>{if(state.active||!state.historyReady)return;if(c.checked)state.historySelected.add(c.dataset.selectId);else state.historySelected.delete(c.dataset.selectId);clearHistoryDownload();updateHistoryControls();};
 for(const b of document.querySelectorAll('[data-view-id]'))b.onclick=()=>viewHistoryPdf(b.dataset.viewId);
 for(const b of document.querySelectorAll('[data-download-id]'))b.onclick=()=>downloadFromHistory(b.dataset.downloadId);
 for(const b of document.querySelectorAll('[data-delete-id]'))b.onclick=()=>openDeleteDialog(b.dataset.deleteId);
 updateHistoryControls();
}
function resetHistoryRows(){state.historyReady=false;state.historyKey='';state.historyRecords=[];state.historyPage=1;state.historyPages=1;state.historyTotal=0;state.historySelected.clear();renderHistory();$('history-page-info').textContent='Halaman 1 / 1';}
function applyHistoryResult(data,key){
 if(data.historyFilterVersion!==1)throw new Error('Filter riwayat memerlukan backend R3.6. Update Code.gs dan Deploy New version.');
 state.historyRecords=data.records||[];state.historyPage=data.page||1;state.historyPages=data.pages||1;state.historyTotal=data.total||0;state.historyReady=true;state.historyKey=key;
 $('history-page-info').textContent=`Halaman ${state.historyPage} / ${state.historyPages}`;
 $('history-status').textContent=`${state.historyTotal} laporan aktif ditemukan. Ditampilkan maksimal 75 laporan per halaman.`;renderHistory();
}
async function loadHistory(page=1,reset=false){
 if(state.active||state.view!=='history')return;clearTimeout(state.searchTimer);clearHistoryDownload();clearError();
 const filters=historyFilters(),key=JSON.stringify(filters);if(reset||key!==state.historyKey){resetHistoryRows();page=1;}
 if(!backendReady()){resetHistoryRows();$('history-status').textContent='Riwayat cloud tersedia setelah URL Apps Script dikonfigurasi.';return;}
 try{validateHistoryFilters(filters);}catch(e){resetHistoryRows();alertError(e.message);$('history-status').textContent='Periksa rentang tanggal.';return;}
 setBusy(true,'Mengambil Riwayat Form...');
 try{const data=await postGAS({action:'listRecords',page,...filters});applyHistoryResult(data,key);}
 catch(e){resetHistoryRows();alertError('Riwayat gagal dimuat: '+e.message);$('history-status').textContent='Gagal mengambil arsip. Periksa koneksi atau konfigurasi backend.';}
 finally{setBusy(false);}
}
function historyFilterChanged(debounce=false){
 if(state.active)return;clearTimeout(state.searchTimer);clearHistoryDownload();resetHistoryRows();clearError();$('history-status').textContent='Memuat hasil filter baru...';
 if(debounce)state.searchTimer=setTimeout(()=>loadHistory(1,true),350);else loadHistory(1,true);
}
async function selectAllHistory(){
 if(state.active||!state.historyReady||state.historyKey!==historyFilterKey())return;
 clearHistoryDownload();if(!$('history-select-all').checked){clearHistorySelection();return;}
 const filters=historyFilters(),key=JSON.stringify(filters);state.historySelectingAll=true;setBusy(true,'Memilih semua hasil filter...');clearError();
 try{
  const data=await postGAS({action:'listRecords',page:state.historyPage,...filters,selectAll:true});
  if(data.historyFilterVersion!==1||!Array.isArray(data.selectionIds)||new Set(data.selectionIds).size!==data.total)throw new Error('Daftar pilihan dari backend tidak lengkap. Muat riwayat kembali.');
  state.historySelected=new Set(data.selectionIds);applyHistoryResult(data,key);
 }catch(e){state.historySelected.clear();alertError('Tidak berhasil memilih semua: '+e.message);}
 finally{state.historySelectingAll=false;setBusy(false);}
}
async function fetchHistoryPdf(id){
 const data=await postGAS({action:'downloadPdf',recordId:id});
 if(data.recordId!==id)throw new Error('ID PDF tidak sesuai dengan dokumen yang dipilih.');
 if(!/^[a-f0-9]{64}$/i.test(String(data.pdfSha256||'')))throw new Error('Checksum PDF arsip tidak tersedia.');
 const bytes=await archivedPdf(data);
 const name=window.FleetHistoryZip?.safePdfName(data.fileName||id+'.pdf')||data.fileName||id+'.pdf';
 return {id,name,bytes};
}
function showHistoryDownload(blob,name,count){
 clearHistoryDownload();const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.className='btn btn-ghost';a.textContent=count===1?'⬇ Unduh PDF':'⬇ Unduh ZIP ('+count+' PDF)';
 $('history-download-title').textContent=count===1?'PDF dari Google Drive siap diunduh.':`ZIP berisi ${count} PDF dari Google Drive siap diunduh.`;
 $('history-download-text').textContent='Tekan tombol di bawah untuk menyimpan file ke perangkat.';
 $('history-download-link').replaceChildren(a);$('history-download-ready').hidden=false;$('history-download-ready').scrollIntoView({behavior:'smooth',block:'nearest'});toast('Arsip siap. Tekan tombol unduh.');
}
async function downloadFromHistory(id){
 if(state.active||!state.historyReady||state.historyKey!==historyFilterKey())return;clearHistoryDownload();clearError();setBusy(true,'Mengunduh PDF dari Google Drive...');
 try{const file=await fetchHistoryPdf(id);showHistoryDownload(new Blob([file.bytes],{type:'application/pdf'}),file.name,1);}
 catch(e){alertError('Tidak berhasil mengunduh PDF: '+e.message);}
 finally{setBusy(false);}
}
function historyZipName(filters){const kind={P2H:'P2H',CLEAN:'Kebersihan_Truck'}[filters.formType]||'All_Form';const period=(filters.dateFrom||filters.dateTo)?`${filters.dateFrom?filters.dateFrom.split('-').reverse().join('-'):'Awal'}_sd_${filters.dateTo?filters.dateTo.split('-').reverse().join('-'):'Akhir'}`:'All_Date';return `Riwayat_${kind}_${period}.zip`;}
async function bulkDownloadHistory(){
 if(state.active||!state.historyReady||state.historyKey!==historyFilterKey()||!state.historySelected.size)return;
 const ids=[...state.historySelected],filters=historyFilters();clearHistoryDownload();clearError();
 if(ids.length===1){await downloadFromHistory(ids[0]);return;}
 const zip=window.FleetHistoryZip;if(!zip){alertError('Komponen ZIP belum dimuat. Admin: update history-zip.js dan refresh website.');return;}
 if(ids.length>zip.MAX_FILES){alertError(`Pilihan ${ids.length} laporan melebihi batas ${zip.MAX_FILES} PDF per ZIP. Persempit filter dan unduh per kelompok.`);return;}
 const entries=[];let total=0,current='';state.bulkCancelled=false;
 $('history-bulk-progress').hidden=false;$('history-bulk-cancel').disabled=false;$('history-bulk-meter').max=ids.length;$('history-bulk-meter').value=0;
 $('history-bulk-status').textContent=`Menyiapkan 0 / ${ids.length} PDF...`;setBusy(true,'Menyiapkan ZIP...');
 try{
  for(let i=0;i<ids.length;i++){
   if(state.bulkCancelled)throw new Error('Proses dibatalkan.');current=ids[i];$('history-bulk-status').textContent=`Mengambil PDF ${i+1} / ${ids.length}...`;
   const file=await fetchHistoryPdf(current);if(state.bulkCancelled)throw new Error('Proses dibatalkan.');
   total+=file.bytes.length;if(total>zip.MAX_BYTES)throw new Error('Total PDF melebihi batas aman 100 MiB. Persempit filter tanggal dan unduh per kelompok.');
   entries.push(file);$('history-bulk-meter').value=i+1;
  }
  if(state.bulkCancelled)throw new Error('Proses dibatalkan.');current='';$('history-bulk-status').textContent=`Mengemas ${entries.length} PDF ke ZIP...`;
  const archive=zip.pack(entries);showHistoryDownload(archive,historyZipName(filters),ids.length);
 }catch(e){if(state.bulkCancelled)toast('Unduhan dibatalkan; tidak ada ZIP dibuat.');else alertError(`ZIP belum dibuat${current?' (dokumen '+current+')':''}: ${e.message} Tidak ada file yang diabaikan. Coba ulang atau sesuaikan pilihan.`);}
 finally{$('history-bulk-progress').hidden=true;entries.length=0;state.bulkCancelled=false;setBusy(false);}
}
// Preview uses the exact stored PDF, never re-generates a report. PDF.js is
// lazy-loaded solely for rendering; a local Blob/native viewer is the fallback.
const PDFJS_ROOT='https://cdn.jsdelivr.net/npm/pdfjs-dist@5.5.207/';
let pdfjsPromise=null,historyPreview=null;
function loadPdfJs(){if(!pdfjsPromise)pdfjsPromise=import(PDFJS_ROOT+'legacy/build/pdf.min.mjs').then(lib=>{lib.GlobalWorkerOptions.workerSrc=PDFJS_ROOT+'legacy/build/pdf.worker.min.mjs';return lib;}).catch(e=>{pdfjsPromise=null;throw e;});return pdfjsPromise;}
function cleanupHistoryPreview(){
 const p=historyPreview;historyPreview=null;if(p){clearTimeout(p.loadTimer);try{p.task?.cancel();}catch(_){}try{Promise.resolve(p.loading?.destroy()).catch(()=>{});}catch(_){}URL.revokeObjectURL(p.url);}
 const frame=$('history-preview-frame');frame.removeAttribute('src');frame.hidden=true;const canvas=$('history-preview-canvas');canvas.width=1;canvas.height=1;canvas.hidden=true;
 $('history-preview-open').removeAttribute('href');$('history-preview-download').removeAttribute('href');$('history-preview-nav').hidden=true;$('history-preview-zoom').hidden=true;
}
function previewFallback(p){if(historyPreview!==p)return;$('history-preview-nav').hidden=true;$('history-preview-zoom').hidden=true;$('history-preview-canvas').hidden=true;const frame=$('history-preview-frame');frame.src=p.url;frame.hidden=false;$('history-preview-status').textContent='Penampil PDF bawaan browser. Jika halaman tidak tampil lengkap, tekan Buka PDF untuk melihat arsip asli di tab baru.';}
function syncPreviewControls(p){if(historyPreview!==p)return;const busy=p.rendering; $('history-preview-page').textContent=`Halaman ${p.page} / ${p.doc.numPages}`;$('history-preview-prev').disabled=busy||p.page<=1;$('history-preview-next').disabled=busy||p.page>=p.doc.numPages;$('history-preview-minus').disabled=busy||p.zoom<=.5;$('history-preview-plus').disabled=busy||p.zoom>=3;$('history-preview-fit').disabled=busy;}
async function renderPreviewPage(p){
 if(historyPreview!==p||!p.doc||p.rendering)return;p.rendering=true;syncPreviewControls(p);$('history-preview-status').textContent='Merender halaman PDF...';
 try{
  const page=await p.doc.getPage(p.page);if(historyPreview!==p)return;
  const base=page.getViewport({scale:1}),body=$('history-preview-body'),canvas=$('history-preview-canvas');
  const fit=Math.max(.15,Math.min(2,(body.clientWidth-28)/base.width)),viewport=page.getViewport({scale:fit*p.zoom});
  const pixelScale=Math.min(window.devicePixelRatio||1,2,Math.sqrt(8000000/(viewport.width*viewport.height)));
  canvas.width=Math.max(1,Math.floor(viewport.width*pixelScale));canvas.height=Math.max(1,Math.floor(viewport.height*pixelScale));canvas.style.width=Math.round(viewport.width)+'px';canvas.style.height=Math.round(viewport.height)+'px';canvas.hidden=false;
  p.task=page.render({canvas,canvasContext:canvas.getContext('2d'),viewport,transform:pixelScale!==1?[pixelScale,0,0,pixelScale,0,0]:null});await p.task.promise;
  if(historyPreview===p){$('history-preview-status').textContent=`PDF asli • ${p.doc.numPages} halaman • Zoom ${Math.round(p.zoom*100)}%`;body.scrollTop=0;body.scrollLeft=0;}
 }catch(e){if(historyPreview===p)previewFallback(p);}
 finally{p.rendering=false;if(historyPreview===p)syncPreviewControls(p);}
}
async function viewHistoryPdf(id){
 if(state.active||!state.historyReady||state.historyKey!==historyFilterKey())return;clearError();setBusy(true,'Memuat PDF asli dari Google Drive...');let file;
 try{file=await fetchHistoryPdf(id);}catch(e){alertError('Tidak berhasil membuka PDF: '+e.message);return;}finally{setBusy(false);}
 cleanupHistoryPreview();const url=URL.createObjectURL(new Blob([file.bytes],{type:'application/pdf'})),p={url,page:1,zoom:1,doc:null,loading:null,task:null,rendering:false};historyPreview=p;
 const dialog=$('history-preview-modal');$('history-preview-title').textContent=file.name;$('history-preview-status').textContent='Memuat penampil PDF...';const open=$('history-preview-open'),download=$('history-preview-download');open.href=url;download.href=url;download.download=file.name;dialog.showModal();
 try{
  const lib=await Promise.race([loadPdfJs(),new Promise((_,reject)=>{p.loadTimer=setTimeout(()=>reject(new Error('Penampil PDF belum tersedia.')),20000);})]);clearTimeout(p.loadTimer);if(historyPreview!==p)return;
  p.loading=lib.getDocument({data:file.bytes,isEvalSupported:false,useWasm:false,cMapUrl:PDFJS_ROOT+'cmaps/',cMapPacked:true,standardFontDataUrl:PDFJS_ROOT+'standard_fonts/'});p.doc=await Promise.race([p.loading.promise,new Promise((_,reject)=>{p.loadTimer=setTimeout(()=>reject(new Error('PDF belum selesai dimuat.')),25000);})]);clearTimeout(p.loadTimer);if(historyPreview!==p)return;
  $('history-preview-nav').hidden=false;$('history-preview-zoom').hidden=false;await renderPreviewPage(p);
 }catch(e){clearTimeout(p.loadTimer);try{Promise.resolve(p.loading?.destroy()).catch(()=>{});}catch(_){}previewFallback(p);}
}
function changePreview(pageDelta,zoom){const p=historyPreview;if(!p?.doc||p.rendering)return;if(pageDelta)p.page=Math.max(1,Math.min(p.doc.numPages,p.page+pageDelta));if(zoom!==undefined)p.zoom=Math.max(.5,Math.min(3,zoom));renderPreviewPage(p);}
function openDeleteDialog(id){
 if(state.active||!state.historyReady||state.historyKey!==historyFilterKey())return;const row=state.historyRecords.find(r=>r.recordId===id);if(!row)return;
 if(!window.confirm(`Tahap 1/2 — Anda yakin ingin menghapus dari riwayat?\n\n${row.type}\n${row.person} | ${row.date}\n${row.fileName}\n\nBaris laporan dan evidence akan dihapus dari Google Sheets. PDF dan foto masuk Trash Google Drive. Jejak audit tetap tersimpan.`))return;
 state.deletionTarget=row;
 $('delete-desc').textContent=`Dokumen: ${row.fileName} | ${row.plate} | ID ${row.recordId}`;
 $('delete-actor').value='';$('delete-phrase').value='';$('delete-access-code').value='';$('delete-error').hidden=true;$('delete-confirm').disabled=true;$('delete-modal').hidden=false;$('delete-actor').focus();
}
function closeDeleteDialog(){if(state.active)return;state.deletionTarget=null;$('delete-access-code').value='';$('delete-error').hidden=true;$('delete-modal').hidden=true;}
function validateDeleteDialog(){
 $('delete-confirm').disabled=state.active || !$('delete-actor').value.trim() || !$('delete-access-code').value.trim() || $('delete-phrase').value.trim()!=='HAPUS';
}
async function confirmDeleteFromHistory(){
 const row=state.deletionTarget;if(!row||state.active||!value('delete-actor')||!value('delete-access-code')||value('delete-phrase')!=='HAPUS')return;
 const actor=value('delete-actor'),code=value('delete-access-code');let deleted=false;$('delete-error').hidden=true;
 setBusy(true,'Menghapus laporan dan evidence dari database...');
 try{
  await postGAS({action:'health'}); // Reject mismatched API before destructive request.
  const result=await postGAS({action:'deleteRecord',recordId:row.recordId,confirmRecordId:row.recordId,confirmText:'HAPUS',actorName:actor,accessCode:code});
  if(result.recordId!==row.recordId||!result.deleted||!result.deletionVerified)throw new Error('Server belum mengonfirmasi penghapusan database. Coba lagi dengan dokumen yang sama.');
  clearHistoryDownload();state.historyRecords=state.historyRecords.filter(x=>x.recordId!==row.recordId);state.historySelected.delete(row.recordId);state.deletionTarget=null;$('delete-modal').hidden=true;
  state.historyTotal=Math.max(0,state.historyTotal-1);state.historyPages=Math.max(1,Math.ceil(state.historyTotal/75));deleted=true;renderHistory();
  $('history-status').textContent=`${state.historyTotal} laporan aktif. Dokumen ${row.recordId} dihapus dari database.`;
  toast('Laporan dan evidence terhapus dari Sheets. Folder masuk Trash Drive. Audit tetap ada.');
 }catch(e){$('delete-error').textContent='Gagal menghapus: '+e.message;$('delete-error').hidden=false;}
 finally{$('delete-access-code').value='';setBusy(false);}
 if(deleted)await loadHistory(Math.min(state.historyPage,state.historyPages));
}
function init(){
 initReferenceDropdowns();renderChecklist();renderClean();$('p-date').value=dateStr();$('p-time').value=timeStr();$('c-date').value=dateStr();
 for(const n of document.querySelectorAll('.nav'))n.onclick=()=>setView(n.dataset.view);
 $('go-review').onclick=()=>{try{reviewP2H();}catch(e){alertError(e.message);}};
 $('back-form').onclick=()=>setStep(1);$('go-sign').onclick=()=>setStep(3);$('back-review').onclick=()=>setStep(2);
 $('clear-sign').onclick=clearSignature;
 $('new-p2h').onclick=()=>{if(state.active)return;if(confirm('Kosongkan form P2H dan seluruh foto yang sudah diambil?'))resetP2H();};
 $('new-clean').onclick=()=>{if(state.active)return;if(confirm('Kosongkan form Kebersihan Truck dan seluruh foto yang sudah diambil?'))resetClean();};
 $('submit-p2h').onclick=submitP2H;$('submit-clean').onclick=submitClean;
 $('result-new').onclick=()=>{if(state.view==='p2h')resetP2H();else resetClean();};
 $('history-search').oninput=()=>historyFilterChanged(true);
 for(const id of ['history-date-from','history-date-to','history-form-type'])$(id).onchange=()=>historyFilterChanged();
 $('history-reset').onclick=()=>{if(state.active)return;for(const id of ['history-search','history-date-from','history-date-to','history-form-type'])$(id).value='';historyFilterChanged();};
 $('history-refresh').onclick=()=>loadHistory(1,true);$('history-prev').onclick=()=>loadHistory(state.historyPage-1);$('history-next').onclick=()=>loadHistory(state.historyPage+1);
 $('history-select-all').onchange=selectAllHistory;$('history-clear-selection').onclick=clearHistorySelection;$('history-bulk-download').onclick=bulkDownloadHistory;
 $('history-bulk-cancel').onclick=()=>{state.bulkCancelled=true;$('history-bulk-cancel').disabled=true;$('history-bulk-status').textContent='Membatalkan setelah permintaan berjalan selesai...';};
 $('history-preview-close').onclick=()=>$('history-preview-modal').close();$('history-preview-modal').addEventListener('close',cleanupHistoryPreview);
 $('history-preview-prev').onclick=()=>changePreview(-1);$('history-preview-next').onclick=()=>changePreview(1);
 $('history-preview-minus').onclick=()=>changePreview(0,(historyPreview?.zoom||1)-.25);$('history-preview-plus').onclick=()=>changePreview(0,(historyPreview?.zoom||1)+.25);$('history-preview-fit').onclick=()=>changePreview(0,1);
 updateHistoryControls();
 $('delete-cancel').onclick=closeDeleteDialog;
 $('delete-actor').oninput=validateDeleteDialog;$('delete-access-code').oninput=validateDeleteDialog;$('delete-phrase').oninput=validateDeleteDialog;
 $('delete-confirm').onclick=confirmDeleteFromHistory;
 $('camera-close').onclick=closeCamera;
 $('camera-capture').onclick=()=>{try{captureCamera();}catch(e){alertError(e.message);}};
 window.addEventListener('pagehide',closeCamera);
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.camera)closeCamera();});
 if(!backendReady())toast('Penyimpanan belum terhubung: periksa URL Apps Script pada config.js.');
}

init();
