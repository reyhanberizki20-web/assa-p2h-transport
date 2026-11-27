'use strict';
/* FleetCheck R3.5 PDF layouts. Requires PDFLib 1.17.1 (loaded in index.html).
 * The original Master P2H is revised to 27 numbered items; header, vehicle
 * illustration and signature areas retain their original geometry.
 * Extra evidence pages: four images per page, 2 columns x 2 rows.
 */
window.FleetPdf = (() => {
  const C = (r,g,b) => window.PDFLib.rgb(r/255,g/255,b/255);
  let navy,slate,soft,gold,white,line,red;
  function preparePalette(){
    navy=C(22,34,53);slate=C(64,78,97);soft=C(241,245,249);
    gold=C(233,183,0);white=C(255,255,255);line=C(213,222,233);red=C(171,40,45);
  }
  // A single ordered photo master drives the form, validation and PDF grid.
  const cleanAreas = [
    {key:'sterico_before',title:'STERICO TRAP - SEBELUM PEMBERSIHAN',label:'Sterico Trap Sebelum Pembersihan'},
    {key:'inside',title:'HASIL PEMBERSIHAN DALAM KONTAINER',label:'Bukti Hasil Pembersihan Dalam Kontainer'},
    {key:'sterico_after',title:'STERICO TRAP - SESUDAH PEMBERSIHAN',label:'Sterico Trap Sesudah Pembersihan'},
    {key:'door',title:'HASIL PEMBERSIHAN LUAR PINTU KONTAINER',label:'Bukti Hasil Pembersihan Luar Pintu Kontainer'}
  ];
  const textSafe = value => String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7e\xA0-\xFF]/g,'?');
  const short = (v, max) => textSafe(v).replace(/\s+/g,' ').trim().slice(0,max || 300);
  const dateLabel = d => /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8,10)}/${d.slice(5,7)}/${d.slice(0,4)}` : short(d,20);
  function fontFit(text, font, maxWidth, maxSize=10, minSize=5) {
    let s=maxSize;
    while(s>minSize && font.widthOfTextAtSize(text,s)>maxWidth)s-=0.2;
    return s;
  }
  function wrapped(text,font,size,maxWidth,maxLines) {
    const lines=[];let current='';
    for(const word of short(text,600).split(/\s+/)) {
      const next=current?`${current} ${word}`:word;
      if(current && font.widthOfTextAtSize(next,size)>maxWidth){lines.push(current);current=word;}else current=next;
    }
    if(current)lines.push(current);
    return lines.slice(0,maxLines);
  }
  function fitImage(image,w,h){const s=Math.min(w/image.width,h/image.height);return {width:image.width*s,height:image.height*s};}
  function dataBytes(dataUrl){const bin=atob(String(dataUrl).split(',')[1]);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;}
  async function loadLogo(pdf){
    const response=await fetch('assa_logo_Hitam.png',{cache:'force-cache'});
    if(!response.ok)throw new Error('Logo resmi ASSA tidak ditemukan. Pastikan file assa_logo_Hitam.png di folder docs.');
    return pdf.embedPng(await response.arrayBuffer());
  }
  function drawLogo(page,logo,x,y,maxW,maxH){const size=fitImage(logo,maxW,maxH);page.drawImage(logo,{x:x+(maxW-size.width)/2,y:y+(maxH-size.height)/2,width:size.width,height:size.height});}
  function drawP2HHeader(page,logo,bold,normal){
    const w=page.getWidth(),h=page.getHeight();
    // Cover only the source's old top header; do not modify the form table below.
    page.drawRectangle({x:0,y:h-62,width:w,height:62,color:white});
    page.drawRectangle({x:0,y:h-7,width:w,height:7,color:gold});
    drawLogo(page,logo,22,h-57,105,49);
    page.drawRectangle({x:141,y:h-54,width:2.5,height:40,color:gold});
    page.drawText('FORM PEMERIKSAAN P2H',{x:154,y:h-29,font:bold,size:15.4,color:navy});
    page.drawText('Kelayakan & Perlengkapan Kondisi Container & Truck Vendor',{x:154,y:h-46,font:normal,size:8.3,color:slate});
    page.drawRectangle({x:w-171,y:h-43,width:148,height:27,color:navy});
    page.drawText('VEHICLE INSPECTION',{x:w-161,y:h-26,font:bold,size:9.1,color:white});
    page.drawText('ASSA LOGISTICS',{x:w-158,y:h-37,font:normal,size:7,color:C(217,225,236)});
    page.drawRectangle({x:0,y:h-63,width:w,height:1.3,color:navy});
  }
  function p2hEvidenceCard(page,entry,logo,font,bold,x,y,w,h,pdf) {
    page.drawRectangle({x,y,width:w,height:h,color:white,borderColor:line,borderWidth:0.9});
    page.drawRectangle({x,y:y+h-38,width:w,height:38,color:soft});
    const label=entry.item.point?`ITEM ${String(entry.item.number).padStart(2,'0')} / TITIK ${entry.item.point}  |  ${short(entry.item.label,90)}`:`ITEM ${String(entry.item.number).padStart(2,'0')}  |  ${short(entry.item.label,90)}`;
    page.drawText(label,{x:x+11,y:y+h-16,font:bold,size:fontFit(label,bold,w-23,9.5,5.8),color:navy});
    const status=`HASIL: ${entry.status.toUpperCase()}     WAKTU: ${short(entry.photo.capturedAt,36)}`;
    page.drawText(status,{x:x+11,y:y+h-31,font:font,size:7.1,color:entry.status==='nok'?red:slate});
    const note=entry.note?`CATATAN: ${short(entry.note,90)}`:'Bukti kamera langsung - waktu berdasarkan perangkat';
    page.drawText(note,{x:x+11,y:y+15,font:font,size:fontFit(note,font,w-23,7.3,5.2),color:entry.note?red:slate});
    return pdf.embedJpg(dataBytes(entry.photo.dataUrl)).then(img=>{
      const size=fitImage(img,w-20,h-63);
      const bottom=y+26,boxH=h-70;
      page.drawImage(img,{x:x+(w-size.width)/2,y:bottom+(boxH-size.height)/2,width:size.width,height:size.height});
    });
  }
  async function p2h(data,signatureData,recordId,photos){
    if(!window.PDFLib)throw new Error('Library PDF belum tersedia, cek koneksi internet.');
    preparePalette();
    const response=await fetch('master-p2h-27.pdf',{cache:'force-cache'});
    if(!response.ok)throw new Error('Template Master P2H tidak ditemukan.');
    const pdf=await PDFLib.PDFDocument.load(await response.arrayBuffer());
    const page=pdf.getPages()[0],H=page.getHeight(),W=page.getWidth();
    const font=await pdf.embedFont(PDFLib.StandardFonts.Helvetica),bold=await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const logo=await loadLogo(pdf);
    drawP2HHeader(page,logo,bold,font);
    const write=(v,x,top,maxWidth=160,size=7,min=4)=>{
      const str=short(v,300);if(!str)return;
      const fitted=Math.min(fontFit(str,font,maxWidth,size,min),maxWidth/Math.max(font.widthOfTextAtSize(str,1),.01));
      page.drawText(str,{x,y:H-top,font,size:fitted,color:navy});
    };
    write(`${data.person_name} (${data.role})`,86,87.08,276,8,5.5);write(data.truck,86,97.127,276,8,5.5);
    write(data.container,86,107.174,276,8,5.5);write(data.plate,86,117.22,276,8,5.5);
    write(data.kilometer,86,127.267,276,8,5.5);
    write(dateLabel(data.inspection_date),508,87.08,55,7.3,6);
    write(data.inspection_time,508,97.127,55,7.5,6);
    for(const item of window.MASTER_P2H.items){
      const check=data.checks[item.row],y=H-item.baselineTop;
      if(item.row===20){
        // Master P2H item 09: replace only the dotted placeholder, not its label,
        // parentheses, grid or other content. Coordinates from original PDF text.
        const dateText=data.apar_expiry_date?dateLabel(data.apar_expiry_date):'-';
        page.drawRectangle({x:114.704,y:y-1.7,width:35.028,height:7.4,color:white});
        const size=fontFit(dateText,font,34.428,6,4.5),tw=font.widthOfTextAtSize(dateText,size);
        page.drawText(dateText,{x:114.704+(35.028-tw)/2,y,font,size,color:navy});
      }
      page.drawText(check.status==='ok'?'v':'x',{x:402,y,font:bold,size:7,color:navy});
      if(check.note){
        let t=short(check.note,72),s=fontFit(t,font,122,5.6,3.4);
        while(t.length>1&&font.widthOfTextAtSize(t,s)>122)t=t.slice(0,-2)+'~';
        page.drawText(t,{x:439,y,font,size:s,color:navy});
      }
    }
    if(data.additional_notes){
      wrapped(data.additional_notes,font,8,310,9).forEach((line,i)=>page.drawText(line,{x:149,y:H-458-i*10.5,font,size:8,color:navy}));
    }
    // R3.5: one center axis for signature, actual person name and actual role.
    // Cover only the existing printed labels. Keep both original column positions.
    const sig=await pdf.embedPng(dataBytes(signatureData));
    const role=short(data.role,30).trim()||'PEMBUAT';
    const name='( '+short(data.person_name,80)+' )';
    const driverSide=['DRIVER','CO-DRIVER'].includes(role.toUpperCase());
    const groups=[
      {left:660,right:753,coverLeft:{x:615,top:117,w:81,h:17},coverRight:{x:716,top:117,w:84,h:17},sigTop:77,nameTop:120,roleTop:132,w:90},
      {left:522,right:622,coverLeft:{x:481,top:545,w:83,h:17},coverRight:{x:585,top:545,w:85,h:17},sigTop:498,nameTop:548,roleTop:560,w:90}
    ];
    const centered=(text,cx,top,f,size)=>{
      page.drawText(text,{x:cx-f.widthOfTextAtSize(text,size)/2,y:H-top,font:f,size,color:navy});
    };
    // Wrap even exceptionally long manually entered names; do not truncate them.
    function nameLines(text,maxWidth){
      let size=8,lines;
      function splitAtWidth(n){
        const out=[];let line='';
        for(const char of text){
          if(line && bold.widthOfTextAtSize(line+char,n)>maxWidth){
            const space=line.lastIndexOf(' ');
            if(space>Math.floor(line.length/2)){out.push(line.slice(0,space).trim());line=line.slice(space+1)+char;}
            else{out.push(line);line=char;}
          }else line+=char;
        }
        if(line.trim())out.push(line.trim());return out;
      }
      while(true){lines=splitAtWidth(size);if(lines.length<=3&&lines.every(l=>bold.widthOfTextAtSize(l,size)<=maxWidth))return {lines,size};size-=.25;}
    }
    for(const g of groups){
      for(const b of [g.coverLeft,g.coverRight])page.drawRectangle({x:b.x,y:H-b.top-b.h,width:b.w,height:b.h,color:white});
      const cx=driverSide?g.right:g.left,emptyCx=driverSide?g.left:g.right;
      const nm=nameLines(name,g.w-4),leading=Math.max(5,nm.size+1),firstTop=g.nameTop-(nm.lines.length-1)*leading;
      // Signature has the same horizontal center as both text labels. Reserve
      // vertical space for wrapped names, including custom names/roles.
      const sigH=Math.min(38,firstTop-g.sigTop-nm.size-3);
      const size=fitImage(sig,g.w-6,sigH);
      page.drawImage(sig,{x:cx-size.width/2,y:H-g.sigTop-sigH+(sigH-size.height)/2,width:size.width,height:size.height});
      nm.lines.forEach((line,i)=>centered(line,cx,firstTop+i*leading,bold,nm.size));
      const roleSize=Math.min(7.2,(g.w-4)/Math.max(font.widthOfTextAtSize(role,1),.01));
      centered(role,cx,g.roleTop,font,roleSize);
      // Inactive column: keep an empty placeholder, no signature or actual role.
      centered('(                           )',emptyCx,g.roleTop,font,7.2);
    }
    const evidence=window.MASTER_P2H.items.filter(item=>photos[item.row]).map(item=>({item,photo:photos[item.row],status:data.checks[item.row].status,note:data.checks[item.row].note}));
    const margin=27,gap=12,cardW=(W-margin*2-gap)/2,cardH=220;
    for(let start=0;start<evidence.length;start+=4){
      const pg=pdf.addPage([W,H]),pageNo=2+Math.floor(start/4);
      pg.drawRectangle({x:0,y:0,width:W,height:H,color:white});
      pg.drawRectangle({x:0,y:H-64,width:W,height:64,color:navy});
      pg.drawRectangle({x:0,y:H-8,width:W,height:8,color:gold});
      pg.drawText('LAMPIRAN FOTO EVIDENCE P2H',{x:27,y:H-33,font:bold,size:16.5,color:white});
      const meta=`${short(data.person_name,40)}  |  ${short(data.plate,25)}  |  ${dateLabel(data.inspection_date)}`;
      pg.drawText(meta,{x:28,y:H-51,font:font,size:8.2,color:C(219,228,239)});
      pg.drawText(`ID: ${short(recordId,44)}`,{x:28,y:18,font,size:7.5,color:slate});
      pg.drawText(`Halaman ${pageNo} dari ${1+Math.ceil(evidence.length/4)}`,{x:W-124,y:18,font,size:8,color:slate});
      for(let i=0;i<4;i++){
        const entry=evidence[start+i];if(!entry)continue;
        const col=i%2,row=Math.floor(i/2),x=margin+col*(cardW+gap);
        const y=row===0?H-83-cardH:H-83-cardH-14-cardH;
        await p2hEvidenceCard(pg,entry,logo,font,bold,x,y,cardW,cardH,pdf);
      }
    }
    pdf.setTitle('Form P2H - '+short(data.person_name,75));
    pdf.setSubject('P2H dengan lampiran foto evidence langsung dari kamera');
    return pdf.save({useObjectStreams:true});
  }
  async function cleaning(data,photos,recordId){
    if(!window.PDFLib)throw new Error('Library PDF belum tersedia, cek koneksi internet.');
    preparePalette();
    const pdf=await PDFLib.PDFDocument.create();
    const W=595.28,H=841.89,page=pdf.addPage([W,H]);
    const font=await pdf.embedFont(PDFLib.StandardFonts.Helvetica),bold=await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold),logo=await loadLogo(pdf);
    page.drawRectangle({x:0,y:0,width:W,height:H,color:white});
    page.drawRectangle({x:0,y:H-8,width:W,height:8,color:gold});
    drawLogo(page,logo,26,H-92,139,79);
    page.drawRectangle({x:189,y:H-93,width:2.5,height:65,color:gold});
    page.drawText('LAPORAN',{x:207,y:H-38,font:bold,size:11,color:slate});
    page.drawText('KEBERSIHAN TRUCK',{x:207,y:H-61,font:bold,size:19.4,color:navy});
    page.drawText('Dokumentasi Pembersihan Kendaraan',{x:207,y:H-80,font,size:9,color:slate});
    page.drawRectangle({x:25,y:H-106,width:W-50,height:1.5,color:navy});
    // Information, separated from evidence photos.
    page.drawRectangle({x:26,y:H-225,width:W-52,height:105,color:soft,borderColor:line,borderWidth:.8});
    page.drawText('INFORMASI PEMBERSIHAN',{x:40,y:H-139,font:bold,size:10,color:navy});
    const infos=[['Nama Driver',data.driver,40],['Nomor Polisi',data.plate,306],['Tanggal',dateLabel(data.date),40],['Jenis Pembersihan',data.type,306]];
    infos.forEach(([label,val,x],i)=>{
      const yy=H-(i<2?160:201);
      page.drawText(label,{x,y:yy,font,size:8,color:slate});
      const v=short(val,90);
      page.drawText(v,{x,y:yy-16,font:bold,size:fontFit(v,bold,245,10,6.5),color:navy});
    });
    page.drawText('FOTO EVIDENCE KEGIATAN',{x:27,y:H-250,font:bold,size:12,color:navy});
    page.drawText('4 foto wajib | kamera langsung',{x:W-235,y:H-250,font,size:8.1,color:slate});
    const margin=26,gap=12,cardW=(W-2*margin-gap)/2,cardH=226;
    for(let i=0;i<cleanAreas.length;i++){
      const area=cleanAreas[i],photo=photos[area.key];
      if(!photo)throw new Error('Foto '+area.title+' wajib diambil.');
      const x=margin+(i%2)*(cardW+gap),top=(i<2?264:506),y=H-top-cardH;
      page.drawRectangle({x,y,width:cardW,height:cardH,color:white,borderColor:line,borderWidth:1});
      page.drawRectangle({x,y:y+cardH-46,width:cardW,height:46,color:soft});
      page.drawText(`0${i+1}  ${area.title}`,{x:x+9,y:y+cardH-18,font:bold,size:fontFit(`0${i+1}  ${area.title}`,bold,cardW-18,8.6,6),color:navy});
      page.drawText(`Waktu foto: ${short(photo.capturedAt,38)}`,{x:x+9,y:y+cardH-34,font,size:7.2,color:slate});
      const img=await pdf.embedJpg(dataBytes(photo.dataUrl));const size=fitImage(img,cardW-19,138);
      page.drawImage(img,{x:x+(cardW-size.width)/2,y:y+33+(146-size.height)/2,width:size.width,height:size.height});
      page.drawText('Bukti kamera langsung',{x:x+9,y:y+13,font,size:7.4,color:slate});
    }
    page.drawRectangle({x:26,y:45,width:W-52,height:1,color:line});
    page.drawText(`Ref: ${short(recordId,40)}`,{x:27,y:29,font,size:7.3,color:slate});
    page.drawText('Waktu foto mengikuti waktu perangkat | Halaman 1 dari 1',{x:W-298,y:29,font,size:7.1,color:slate});
    pdf.setTitle('Kebersihan Truck - '+short(data.driver,75));
    pdf.setSubject('Empat evidence kamera langsung termasuk Sterico Trap sebelum dan sesudah');
    return pdf.save({useObjectStreams:true});
  }
  return {p2h,cleaning,cleanAreas};
})();
