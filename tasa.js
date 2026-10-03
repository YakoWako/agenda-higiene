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
  const normalizeTime = v => String(v||'').trim().replace(/[Hh.]/,':').replace(/^24:00$/,'24:00');
  const serverCall = (fn,...args) => window.AgendaApi.call(fn,...args);

  let events = [];
  let currentMonth = new Date();
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  let loadedOnce = false;

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

  function renderCalendar(){
    const title=q('#tasaMonthTitle');
    const picker=q('#tasaMonthPicker');
    const cal=q('#tasaCalendar');
    if(!title||!cal) return;

    title.textContent=monthLabel(currentMonth);
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
          <small>${esc(e.horaInicio||'')}${e.horaFin?' – '+esc(e.horaFin):''}</small>
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
    const term=String(q('#tasaSearch')?.value||'').toLowerCase().trim();
    const rows=events
      .filter(e=>!term || [e.nombreEvento,e.numeroDocumento,e.organizador,e.lugar,e.fechaEvento].some(v=>String(v||'').toLowerCase().includes(term)))
      .sort((a,b)=>String(b.fechaEvento||'').localeCompare(String(a.fechaEvento||'')));

    el.innerHTML=rows.length ? rows.map(e=>`
      <button type="button" class="tasa-record-card" data-tasa-id="${esc(e.id)}" style="width:100%;text-align:left">
        <div>
          <strong>${esc(e.nombreEvento||'Evento sin nombre')}</strong>
          <div class="event-meta">
            <span>📅 ${esc(fmtDate(e.fechaEvento))}</span>
            <span>🕐 ${esc(e.horaInicio||'—')}${e.horaFin?' – '+esc(e.horaFin):''}</span>
            ${e.lugar?`<span>📍 ${esc(e.lugar)}</span>`:''}
          </div>
        </div>
        <span>›</span>
      </button>`).join('') : '<div class="empty">No existen eventos con tasa de aseo registrados.</div>';

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
        <div class="tasa-detail-item"><span>Horario</span><strong>${esc(e.horaInicio||'—')}${e.horaFin?' – '+esc(e.horaFin):''}</strong></div>
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
    q('#tasaDetailBody').innerHTML=detailRows(e)+`
      <div class="card-title" style="margin-top:16px">Cronograma</div>
      ${cron.length?`<table class="tasa-crono-table"><thead><tr><th>Fase</th><th>Fecha</th><th>Inicio</th><th>Fin</th></tr></thead><tbody>${cron.map(c=>`<tr><td>${esc(c.fase||'')}</td><td>${esc(fmtDate(c.fecha))}</td><td>${esc(c.inicio||'')}</td><td>${esc(c.fin||'')}</td></tr>`).join('')}</tbody></table>`:'<div class="hint">Sin cronograma registrado.</div>'}
      ${e.pdfUrl?`<div class="form-actions"><a class="secondary" style="text-decoration:none" href="${esc(e.pdfUrl)}" target="_blank" rel="noopener">📄 Ver certificación PDF</a></div>`:''}
    `;
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

  function clearForm(){
    fillForm({});
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
      const data=await serverCall('getTasaAseoData');
      events=Array.isArray(data)?data:(data?.events||[]);
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
    if(st) st.textContent='Procesando certificación con IA…';
    const btn=q('#tasaProcessPdf');
    if(btn) btn.disabled=true;
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
      if(btn) btn.disabled=false;
    }
  }

  async function saveEvent(){
    const data=collectForm();
    const st=q('#tasaProcessState');
    if(!data.nombreEvento||!data.fechaEvento){
      if(st) st.textContent='Complete al menos el nombre y la fecha del evento.';
      return;
    }
    const btn=q('#tasaSaveEvent');
    if(btn) btn.disabled=true;
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
      if(btn) btn.disabled=false;
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