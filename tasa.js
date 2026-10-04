(() => {
  'use strict';

  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const pad = n => String(n).padStart(2,'0');
  const isoToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  };
  const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  const fmtDate = iso => {
    if(!iso) return '—';
    const m=String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };
  const normalizeTime = v => {
    const raw=String(v||'').trim();
    if(!raw) return '';

    let m=raw.match(/^(\d{1,2})[:Hh.](\d{2})(?::\d{2})?$/);
    if(!m){
      m=raw.match(/\b(\d{1,2}):(\d{2}):\d{2}\s+GMT/i) ||
        raw.match(/\b(\d{1,2}):(\d{2})\b/);
    }

    if(!m) return raw;

    const h=Number(m[1]);
    const min=Number(m[2]);

    if(h===24 && min===0) return '24:00';
    if(h<0 || h>23 || min<0 || min>59) return raw;

    return String(h).padStart(2,'0')+':'+String(min).padStart(2,'0');
  };

  const displayTime = v => {
    const t=normalizeTime(v);
    return /^\d{2}:\d{2}$/.test(t) ? t : t;
  };

  const serverCall = (fn,...args) => window.AgendaApi.call(fn,...args);

  let events = [];
  let currentMonth = new Date();
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  let loadedOnce = false;
  let tasaRole = 'LECTURA';
  let editingId = '';
  let editingPdfUrl = '';
  let editingPdfFileName = '';

  function moduleVisible(){
    const el=q('#module-tasa');
    return !!el && !el.classList.contains('hidden');
  }

  function showTasaView(view){
    ['calendar','records','register'].forEach(name=>{
      const panel=q('#tasa-view-'+name);
      if(panel) panel.classList.toggle('hidden',name!==view);
    });
    qa('#tasaSubnav [data-tasa-view]').forEach(btn=>{
      btn.classList.toggle('active',btn.dataset.tasaView===view);
    });
    if(view==='calendar') renderCalendar();
    if(view==='records') renderRecords();
  }

  function monthLabel(d){
    const txt=new Intl.DateTimeFormat('es-EC',{month:'long',year:'numeric'}).format(d);
    return txt.charAt(0).toUpperCase()+txt.slice(1);
  }

  function isAdmin(){
    return String(tasaRole||'').toUpperCase()==='ADMIN';
  }

  function monthEvents(d=currentMonth){
    const key=monthKey(d);
    return events
      .filter(e=>String(e.fechaEvento||'').slice(0,7)===key)
      .sort((a,b)=>{
        const fa=String(a.fechaEvento||'')+' '+String(a.horaInicio||'');
        const fb=String(b.fechaEvento||'')+' '+String(b.horaInicio||'');
        return fa.localeCompare(fb);
      });
  }

  function normalizeComparable(value){
    return String(value||'')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g,' ')
      .trim()
      .replace(/\s+/g,' ');
  }

  function tokenSimilarity(a,b){
    const aa=new Set(normalizeComparable(a).split(' ').filter(Boolean));
    const bb=new Set(normalizeComparable(b).split(' ').filter(Boolean));
    if(!aa.size||!bb.size) return 0;
    let inter=0;
    aa.forEach(x=>{if(bb.has(x)) inter++;});
    const union=new Set([...aa,...bb]).size;
    return union?inter/union:0;
  }

  function findPossibleDuplicates(data){
    const name=normalizeComparable(data.nombreEvento);
    const org=normalizeComparable(data.organizador);
    const doc=normalizeComparable(data.numeroDocumento);

    return events.filter(e=>{
      if(editingId && String(e.id)===String(editingId)) return false;

      const eName=normalizeComparable(e.nombreEvento);
      const eOrg=normalizeComparable(e.organizador);
      const eDoc=normalizeComparable(e.numeroDocumento);

      if(doc && eDoc && doc===eDoc) return true;

      const nameExact=!!name && name===eName;
      const orgExact=!!org && org===eOrg;
      const nameSim=tokenSimilarity(name,eName);
      const orgSim=tokenSimilarity(org,eOrg);
      const sameDate=!!data.fechaEvento && String(data.fechaEvento)===String(e.fechaEvento||'');

      if(nameExact && orgExact) return true;
      if(nameExact && (orgExact || orgSim>=0.6)) return true;
      if(orgExact && nameSim>=0.65) return true;
      if(sameDate && nameSim>=0.6) return true;
      return nameSim>=0.75 && orgSim>=0.65;
    }).slice(0,5);
  }

  function confirmPossibleDuplicate(data){
    const dupes=findPossibleDuplicates(data);
    if(!dupes.length) return true;

    const lines=dupes.map(e=>
      '• '+(e.nombreEvento||'Evento')+
      ' · '+fmtDate(e.fechaEvento)+
      (e.horaInicio?' · '+displayTime(e.horaInicio):'')+
      (e.organizador?' · '+e.organizador:'')
    ).join('\n');

    return window.confirm(
      'Se encontró '+(dupes.length===1?'un posible evento duplicado':'posibles eventos duplicados')+':\n\n'+
      lines+
      '\n\n¿Desea guardar de todas formas?'
    );
  }

  async function copyText(text){
    try{
      if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(text);
        return true;
      }
    }catch(_){}

    const ta=document.createElement('textarea');
    ta.value=text;
    ta.style.position='fixed';
    ta.style.opacity='0';
    document.body.appendChild(ta);
    ta.select();
    const ok=document.execCommand('copy');
    ta.remove();
    return ok;
  }

  function getRecordFilterState(){
    return {
      term:String(q('#tasaSearch')?.value||'').toLowerCase().trim(),
      month:String(q('#tasaRecordsMonth')?.value||'').trim(),
      day:String(q('#tasaRecordsDay')?.value||'').trim()
    };
  }

  function getFilteredRecords(ascending=false){
    const {term,month,day}=getRecordFilterState();

    const rows=events.filter(e=>{
      const fecha=String(e.fechaEvento||'');

      if(day && fecha!==day) return false;
      if(!day && month && fecha.slice(0,7)!==month) return false;

      if(term){
        const ok=[e.nombreEvento,e.numeroDocumento,e.organizador,e.lugar,e.fechaEvento]
          .some(v=>String(v||'').toLowerCase().includes(term));
        if(!ok) return false;
      }

      return true;
    });

    return rows.sort((a,b)=>{
      const av=String(a.fechaEvento||'')+' '+String(a.horaInicio||'');
      const bv=String(b.fechaEvento||'')+' '+String(b.horaInicio||'');
      return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }

  function recordFilterTitle(){
    const {term,month,day}=getRecordFilterState();

    let label='Todos los registros';

    if(day){
      label=fmtDate(day);
    }else if(month){
      const [y,m]=month.split('-').map(Number);
      if(y&&m) label=monthLabel(new Date(y,m-1,1));
    }

    if(term) label+=' · búsqueda';

    return label;
  }

  async function copyFilteredRecords(){
    const rows=getFilteredRecords(true);

    if(!rows.length){
      window.alert('No existen eventos para el filtro seleccionado.');
      return;
    }

    const header='EVENTOS CON TASA DE ASEO · '+recordFilterTitle().toUpperCase();

    const textBody=rows.map((e,i)=>[
      '*'+(i+1)+'. '+String(e.nombreEvento||'EVENTO').toUpperCase()+'*',
      '*Fecha:* '+fmtDate(e.fechaEvento),
      '*Hora:* '+(e.horaInicio?displayTime(e.horaInicio):'—')+(e.horaFin?' – '+displayTime(e.horaFin):''),
      '*Lugar:* '+(e.lugar||'—'),
      '*Organizador:* '+(e.organizador||'—')
    ].join('\n')).join('\n\n');

    const htmlBody=rows.map((e,i)=>
      '<div style="margin-bottom:16px">'+
        '<strong>'+esc((i+1)+'. '+String(e.nombreEvento||'EVENTO').toUpperCase())+'</strong><br>'+
        '<strong>Fecha:</strong> '+esc(fmtDate(e.fechaEvento))+'<br>'+
        '<strong>Hora:</strong> '+esc((e.horaInicio?displayTime(e.horaInicio):'—')+(e.horaFin?' – '+displayTime(e.horaFin):''))+'<br>'+
        '<strong>Lugar:</strong> '+esc(e.lugar||'—')+'<br>'+
        '<strong>Organizador:</strong> '+esc(e.organizador||'—')+
      '</div>'
    ).join('');

    const text='*'+header+'*\n\n'+textBody;
    const html='<div><strong>'+esc(header)+'</strong><br><br>'+htmlBody+'</div>';

    try{
      if(navigator.clipboard&&window.isSecureContext&&typeof ClipboardItem!=='undefined'&&navigator.clipboard.write){
        const item=new ClipboardItem({
          'text/plain':new Blob([text],{type:'text/plain'}),
          'text/html':new Blob([html],{type:'text/html'})
        });
        await navigator.clipboard.write([item]);
        window.alert('Eventos filtrados copiados al portapapeles.');
        return;
      }

      const ok=await copyText(text);
      window.alert(ok?'Eventos filtrados copiados al portapapeles.':'No se pudo copiar el listado.');
    }catch(_){
      const ok=await copyText(text);
      window.alert(ok?'Eventos filtrados copiados al portapapeles.':'No se pudo copiar el listado.');
    }
  }

  function renderCalendar(){
    const title=q('#tasaMonthTitle');
    const picker=q('#tasaMonthPicker');
    const cal=q('#tasaCalendar');
    if(!title||!cal) return;

    const count=monthEvents(currentMonth).length;
    title.textContent=monthLabel(currentMonth)+' ('+count+')';
    if(picker) picker.value=monthKey(currentMonth);

    const weekdays=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
    let html=weekdays.map(x=>`<div class="tasa-weekday">${x}</div>`).join('');

    const year=currentMonth.getFullYear();
    const month=currentMonth.getMonth();
    const first=new Date(year,month,1);
    const jsDay=first.getDay();
    const offset=(jsDay+6)%7;
    const gridStart=new Date(year,month,1-offset);
    const today=isoToday();

    for(let i=0;i<42;i++){
      const d=new Date(gridStart.getFullYear(),gridStart.getMonth(),gridStart.getDate()+i);
      const iso=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      const outside=d.getMonth()!==month;
      const dayEvents=events
        .filter(e=>String(e.fechaEvento||'')===iso)
        .sort((a,b)=>String(a.horaInicio||'').localeCompare(String(b.horaInicio||'')));

      html+=`<div class="tasa-day${outside?' outside':''}${iso===today?' today':''}" data-date="${iso}">
        <div class="tasa-day-num">${d.getDate()}</div>
        ${dayEvents.map(e=>`<button class="tasa-event-chip" type="button" data-tasa-id="${esc(e.id)}">
          ${esc(e.nombreEvento||'Evento')}
          <small>${esc(e.horaInicio?displayTime(e.horaInicio):'')}${e.horaFin?' – '+esc(displayTime(e.horaFin)):''}</small>
        </button>`).join('')}
      </div>`;
    }
    cal.innerHTML=html;
    cal.querySelectorAll('[data-tasa-id]').forEach(btn=>{
      btn.onclick=()=>openDetail(btn.dataset.tasaId);
    });
  }

  function renderRecords(){
    const el=q('#tasaRecords');
    if(!el) return;

    const rows=getFilteredRecords(false);
    const label=recordFilterTitle();

    const labelEl=q('#tasaRecordsMonthLabel');
    if(labelEl) labelEl.textContent=label+' ('+rows.length+')';

    const copyBtn=q('#tasaCopyMonth');
    if(copyBtn){
      copyBtn.textContent='📋 Copiar resultados ('+rows.length+')';
      copyBtn.disabled=!rows.length;
    }

    el.innerHTML=rows.length ? rows.map(e=>`
      <button type="button" class="tasa-record-card" data-tasa-id="${esc(e.id)}" style="width:100%;text-align:left">
        <div>
          <strong>${esc(e.nombreEvento||'Evento sin nombre')}</strong>
          <div class="event-meta">
            <span>📅 ${esc(fmtDate(e.fechaEvento))}</span>
            <span>🕐 ${esc(e.horaInicio?displayTime(e.horaInicio):'—')}${e.horaFin?' – '+esc(displayTime(e.horaFin)):''}</span>
            ${e.lugar?`<span>📍 ${esc(e.lugar)}</span>`:''}
          </div>
        </div>
        <span>›</span>
      </button>`).join('') : '<div class="empty">No existen eventos para el filtro seleccionado.</div>';

    el.querySelectorAll('[data-tasa-id]').forEach(btn=>btn.onclick=()=>openDetail(btn.dataset.tasaId));
  }

  function detailRows(e){
    const amount=(e.tasaPagada!=='' && e.tasaPagada!=null) ? Number(e.tasaPagada) : null;
    const amountHtml=amount!==null && !Number.isNaN(amount)
      ? `<div class="tasa-detail-item"><span>Tasa de aseo cancelada</span><strong>USD $${amount.toFixed(2)}</strong></div>`
      : '';

    return `
      <div class="tasa-detail-grid">
        <div class="tasa-detail-item"><span>N.º de oficio / certificación</span><strong>${esc(e.numeroDocumento||'—')}</strong></div>
        <div class="tasa-detail-item"><span>Fecha de emisión</span><strong>${esc(fmtDate(e.fechaEmision))}</strong></div>
        <div class="tasa-detail-item"><span>Fecha del evento</span><strong>${esc(fmtDate(e.fechaEvento))}</strong></div>
        <div class="tasa-detail-item"><span>Horario</span><strong>${esc(e.horaInicio?displayTime(e.horaInicio):'—')}${e.horaFin?' – '+esc(displayTime(e.horaFin)):''}</strong></div>
        <div class="tasa-detail-item"><span>Lugar</span><strong>${esc(e.lugar||'—')}</strong></div>
        <div class="tasa-detail-item"><span>Aforo</span><strong>${esc(e.aforo||'—')}</strong></div>
        <div class="tasa-detail-item"><span>Organizador</span><strong>${esc(e.organizador||'—')}</strong></div>
        <div class="tasa-detail-item"><span>Cédula / identificación</span><strong>${esc(e.identificacion||'—')}</strong></div>
        ${amountHtml}
      </div>`;
  }

  function openDetail(id){
    const e=events.find(x=>String(x.id)===String(id));
    if(!e) return;

    let modal=q('#tasaDetailModal');
    if(!modal){
      modal=document.createElement('div');
      modal.id='tasaDetailModal';
      modal.className='modal';
      modal.innerHTML='<div class="modal-card"><div class="modal-head"><div><h2 id="tasaDetailTitle" style="margin:0;color:var(--navy)"></h2><div class="muted">Evento con certificación de tasa de aseo</div></div><button id="tasaDetailClose" type="button">✕</button></div><div id="tasaDetailBody" style="margin-top:14px"></div></div>';
      document.body.appendChild(modal);
      q('#tasaDetailClose').onclick=()=>modal.classList.remove('open');
      modal.onclick=ev=>{if(ev.target===modal) modal.classList.remove('open');};
    }

    q('#tasaDetailTitle').textContent=e.nombreEvento||'Evento';
    const cron=Array.isArray(e.cronograma)?e.cronograma:[];
    const adminActions=isAdmin()
      ? `<button class="secondary" id="tasaEditEvent" type="button">✏️ Editar</button>
         <button class="danger" id="tasaDeleteEvent" type="button">🗑 Eliminar</button>`
      : '';

    q('#tasaDetailBody').innerHTML=detailRows(e)+`
      <div class="card-title" style="margin-top:16px">Cronograma</div>
      ${cron.length?`<table class="tasa-crono-table"><thead><tr><th>Fase</th><th>Fecha</th><th>Inicio</th><th>Fin</th></tr></thead><tbody>${cron.map(c=>`<tr><td>${esc(c.fase||'')}</td><td>${esc(fmtDate(c.fecha))}</td><td>${esc(c.inicio?displayTime(c.inicio):'')}</td><td>${esc(c.fin?displayTime(c.fin):'')}</td></tr>`).join('')}</tbody></table>`:'<div class="hint">Sin cronograma registrado.</div>'}
      <div class="form-actions">
        ${e.pdfUrl?`<a class="secondary" style="text-decoration:none" href="${esc(e.pdfUrl)}" target="_blank" rel="noopener">📄 Ver certificación PDF</a>`:''}
        ${adminActions}
      </div>
    `;

    const editBtn=q('#tasaEditEvent');
    if(editBtn) editBtn.onclick=()=>startEditEvent(e);

    const deleteBtn=q('#tasaDeleteEvent');
    if(deleteBtn) deleteBtn.onclick=()=>deleteEvent(e);

    modal.classList.add('open');
  }

  function clearCronograma(){
    const body=q('#tasaCronogramaBody');
    if(!body) return;
    body.innerHTML=cronRow();
  }

  function cronRow(c={}){
    return `<tr>
      <td><input data-crono="fase" value="${esc(c.fase||'')}"></td>
      <td><input data-crono="fecha" type="date" value="${esc(c.fecha||'')}"></td>
      <td><input data-crono="inicio" placeholder="HH:MM" value="${esc(c.inicio||'')}"></td>
      <td><input data-crono="fin" placeholder="HH:MM" value="${esc(c.fin||'')}"></td>
    </tr>`;
  }

  function collectCronograma(){
    return qa('#tasaCronogramaBody tr').map(tr=>{
      const get=name=>tr.querySelector(`[data-crono="${name}"]`)?.value.trim()||'';
      return {fase:get('fase'),fecha:get('fecha'),inicio:normalizeTime(get('inicio')),fin:normalizeTime(get('fin'))};
    }).filter(c=>c.fase||c.fecha||c.inicio||c.fin);
  }

  function fillForm(e={}){
    const map={
      tasaNumeroDocumento:e.numeroDocumento||'',
      tasaFechaEmision:e.fechaEmision||'',
      tasaNombreEvento:e.nombreEvento||'',
      tasaFechaEvento:e.fechaEvento||'',
      tasaHoraInicio:e.horaInicio||'',
      tasaHoraFin:e.horaFin||'',
      tasaLugar:e.lugar||'',
      tasaAforo:e.aforo||'',
      tasaOrganizador:e.organizador||'',
      tasaIdentificacion:e.identificacion||'',
      tasaPagada:(e.tasaPagada!==undefined && e.tasaPagada!==null)?e.tasaPagada:''
    };
    Object.entries(map).forEach(([id,val])=>{const el=q('#'+id);if(el)el.value=val;});
    const body=q('#tasaCronogramaBody');
    if(body) body.innerHTML=(Array.isArray(e.cronograma)&&e.cronograma.length?e.cronograma:[{}]).map(cronRow).join('');
  }

  function resetEditState(){
    editingId='';
    editingPdfUrl='';
    editingPdfFileName='';
    const title=q('#tasaFormTitle');
    if(title) title.textContent='🗂️ Datos del evento';
    const saveBtn=q('#tasaSaveEvent');
    if(saveBtn) saveBtn.textContent='Guardar evento';
    const clearBtn=q('#tasaClearForm');
    if(clearBtn) clearBtn.textContent='Limpiar';
  }

  function startEditEvent(e){
    if(!isAdmin()) return;
    editingId=String(e.id||'');
    editingPdfUrl=String(e.pdfUrl||'');
    editingPdfFileName=String(e.pdfFileName||'');
    fillForm(e);

    const title=q('#tasaFormTitle');
    if(title) title.textContent='✏️ Editar evento';
    const saveBtn=q('#tasaSaveEvent');
    if(saveBtn) saveBtn.textContent='Actualizar evento';
    const clearBtn=q('#tasaClearForm');
    if(clearBtn) clearBtn.textContent='Cancelar edición';

    const modal=q('#tasaDetailModal');
    if(modal) modal.classList.remove('open');
    showTasaView('register');
    q('#tasaNombreEvento')?.focus();
  }

  async function deleteEvent(e){
    if(!isAdmin()) return;

    const ok=window.confirm(
      '¿Eliminar definitivamente este registro?\n\n'+
      (e.nombreEvento||'Evento')+' · '+fmtDate(e.fechaEvento)+
      '\n\nEsta acción está reservada al administrador.'
    );
    if(!ok) return;

    const btn=q('#tasaDeleteEvent');
    const original=btn?.textContent||'🗑 Eliminar';
    if(btn){
      btn.disabled=true;
      btn.textContent='Eliminando...';
    }

    try{
      await serverCall('deleteTasaAseoEvent',String(e.id||''));
      events=events.filter(x=>String(x.id)!==String(e.id));
      q('#tasaDetailModal')?.classList.remove('open');
      renderCalendar();
      renderRecords();
    }catch(err){
      window.alert('No se pudo eliminar: '+String(err?.message||err).slice(0,220));
    }finally{
      if(btn&&btn.isConnected){
        btn.disabled=false;
        btn.textContent=original;
      }
    }
  }

  function clearForm(){
    fillForm({});
    resetEditState();
    const file=q('#tasaPdfFile');
    if(file) file.value='';
    const name=q('#tasaPdfName');
    if(name) name.textContent='Sin archivo seleccionado';
    const st=q('#tasaProcessState');
    if(st) st.textContent='';
  }

  function collectForm(){
    const val=id=>q('#'+id)?.value.trim()||'';
    return {
      numeroDocumento:val('tasaNumeroDocumento'),
      fechaEmision:val('tasaFechaEmision'),
      nombreEvento:val('tasaNombreEvento'),
      fechaEvento:val('tasaFechaEvento'),
      horaInicio:normalizeTime(val('tasaHoraInicio')),
      horaFin:normalizeTime(val('tasaHoraFin')),
      lugar:val('tasaLugar'),
      aforo:val('tasaAforo'),
      organizador:val('tasaOrganizador'),
      identificacion:val('tasaIdentificacion'),
      tasaPagada:val('tasaPagada'),
      cronograma:collectCronograma()
    };
  }

  function fileToDataURL(file){
    return new Promise((resolve,reject)=>{
      const fr=new FileReader();
      fr.onload=()=>resolve(fr.result);
      fr.onerror=()=>reject(fr.error||new Error('No se pudo leer el archivo.'));
      fr.readAsDataURL(file);
    });
  }

  async function loadEvents(silent=false){
    if(!window.AgendaApi?.isConfigured?.()) return;
    try{
      const [data,ping]=await Promise.all([
        serverCall('getTasaAseoData'),
        serverCall('ping').catch(()=>null)
      ]);
      const rawEvents=Array.isArray(data)?data:(data?.events||[]);
      events=rawEvents.map(e=>({
        ...e,
        horaInicio:normalizeTime(e.horaInicio),
        horaFin:normalizeTime(e.horaFin),
        cronograma:Array.isArray(e.cronograma)
          ? e.cronograma.map(c=>({
              ...c,
              inicio:normalizeTime(c.inicio),
              fin:normalizeTime(c.fin)
            }))
          : []
      }));
      tasaRole=String(ping?.role||tasaRole||'LECTURA').toUpperCase();
      loadedOnce=true;
      renderCalendar();
      renderRecords();
    }catch(err){
      if(!silent){
        const st=q('#tasaProcessState');
        if(st) st.textContent='El módulo visual está listo; falta habilitar sus funciones en Apps Script.';
      }
      console.warn('Tasa de aseo backend pendiente:',err);
    }
  }

  async function processPdf(){
    const file=q('#tasaPdfFile')?.files?.[0];
    const st=q('#tasaProcessState');
    if(!file){
      if(st) st.textContent='Seleccione primero una certificación PDF.';
      return;
    }

    const btn=q('#tasaProcessPdf');
    const originalText=btn?.textContent||'Procesar certificación con IA';
    let dotsTimer=null;

    if(st) st.textContent='Procesando certificación con IA…';

    if(btn){
      btn.disabled=true;
      let puntos=0;
      const actualizarTexto=()=>{
        puntos=(puntos%3)+1;
        btn.textContent='Procesando'+'.'.repeat(puntos);
      };
      actualizarTexto();
      dotsTimer=setInterval(actualizarTexto,450);
    }

    try{
      const dataUrl=await fileToDataURL(file);
      const out=await serverCall('extractTasaAseo',{
        fileName:file.name,
        mimeType:file.type||'application/pdf',
        dataUrl
      });
      fillForm(out||{});
      if(st) st.textContent='Extracción completada. Revise los datos antes de guardar.';
    }catch(err){
      if(st) st.textContent='No se pudo procesar: '+String(err?.message||err).slice(0,220);
    }finally{
      if(dotsTimer) clearInterval(dotsTimer);
      if(btn){
        btn.disabled=false;
        btn.textContent=originalText;
      }
    }
  }

  async function saveEvent(){
    const data=collectForm();
    const st=q('#tasaProcessState');
    if(!data.nombreEvento||!data.fechaEvento){
      if(st) st.textContent='Complete al menos el nombre y la fecha del evento.';
      return;
    }

    if(!confirmPossibleDuplicate(data)) return;

    if(editingId){
      data.id=editingId;
      data.pdfUrl=editingPdfUrl;
      data.pdfFileName=editingPdfFileName;
    }

    const btn=q('#tasaSaveEvent');
    const originalText=btn?.textContent||'Guardar evento';
    let dotsTimer=null;

    if(btn){
      btn.disabled=true;
      let puntos=0;
      const actualizarTexto=()=>{
        puntos=(puntos%3)+1;
        btn.textContent='Guardando'+'.'.repeat(puntos);
      };
      actualizarTexto();
      dotsTimer=setInterval(actualizarTexto,450);
    }

    try{
      const file=q('#tasaPdfFile')?.files?.[0];
      if(file && !data.pdfDataUrl){
        data.pdfDataUrl=await fileToDataURL(file);
        data.pdfFileName=file.name;
        data.pdfMimeType=file.type||'application/pdf';
      }
      const saved=await serverCall('saveTasaAseoEvent',data);
      const normalized=saved?.event||saved;
      if(normalized){
        const i=events.findIndex(x=>String(x.id)===String(normalized.id));
        if(i>=0) events[i]=normalized; else events.push(normalized);
      }else{
        await loadEvents(true);
      }
      clearForm();
      currentMonth=new Date(Number(data.fechaEvento.slice(0,4)),Number(data.fechaEvento.slice(5,7))-1,1);
      showTasaView('calendar');
      renderCalendar();
    }catch(err){
      if(st) st.textContent='No se pudo guardar: '+String(err?.message||err).slice(0,220);
    }finally{
      if(dotsTimer) clearInterval(dotsTimer);
      if(btn){
        btn.disabled=false;
        btn.textContent=originalText;
      }
    }
  }

  function bind(){
    qa('#tasaSubnav [data-tasa-view]').forEach(btn=>btn.onclick=()=>showTasaView(btn.dataset.tasaView));
    q('#tasaPrevMonth').onclick=()=>{currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth()-1,1);renderCalendar();};
    q('#tasaNextMonth').onclick=()=>{currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth()+1,1);renderCalendar();};
    q('#tasaTodayMonth').onclick=()=>{const d=new Date();currentMonth=new Date(d.getFullYear(),d.getMonth(),1);renderCalendar();};
    q('#tasaMonthPicker').onchange=e=>{
      if(!e.target.value) return;
      const [y,m]=e.target.value.split('-').map(Number);
      currentMonth=new Date(y,m-1,1);
      renderCalendar();
    };
    q('#tasaSearch').oninput=renderRecords;

    q('#tasaRecordsMonth').onchange=e=>{
      const day=q('#tasaRecordsDay');
      if(day) day.value='';

      if(e.target.value){
        const [y,m]=e.target.value.split('-').map(Number);
        if(y&&m) currentMonth=new Date(y,m-1,1);
      }

      renderRecords();
    };

    q('#tasaRecordsDay').onchange=e=>{
      const month=q('#tasaRecordsMonth');
      if(month) month.value='';

      if(e.target.value){
        const [y,m]=e.target.value.slice(0,7).split('-').map(Number);
        if(y&&m) currentMonth=new Date(y,m-1,1);
      }

      renderRecords();
    };

    q('#tasaRecordsAll').onclick=()=>{
      q('#tasaRecordsMonth').value='';
      q('#tasaRecordsDay').value='';
      renderRecords();
    };

    q('#tasaCopyMonth').onclick=copyFilteredRecords;
    q('#tasaPickPdf').onclick=()=>q('#tasaPdfFile').click();
    q('#tasaPdfFile').onchange=()=>{q('#tasaPdfName').textContent=q('#tasaPdfFile').files[0]?.name||'Sin archivo seleccionado';};
    q('#tasaProcessPdf').onclick=processPdf;
    q('#tasaSaveEvent').onclick=saveEvent;
    q('#tasaClearForm').onclick=clearForm;
    q('#tasaAddCrono').onclick=()=>q('#tasaCronogramaBody').insertAdjacentHTML('beforeend',cronRow());

    const tasaModuleBtn=q('#moduleNav [data-module="tasa"]');
    if(tasaModuleBtn){
      tasaModuleBtn.addEventListener('click',()=>{
        renderCalendar();
        if(!loadedOnce) loadEvents(true);
      });
    }
  }

  document.addEventListener('DOMContentLoaded',()=>{
    bind();
    renderCalendar();
  });
})();