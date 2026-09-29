(() => {
  const ASSIGNABLES_DEFAULT = ['Carlos Pacheco','William Pruss','Darwin Zambrano','Roque Mendoza','Romeo Mendoza','Leonardo Figueroa','William Torres','Gabriel Torres','Oldemar Giler','Gabriel García','Johnny Zambrano','Jordy Zamora'];
  const REGISTRARS_DEFAULT = ['Carlos Pacheco','William Pruss','Romeo Mendoza','Darwin Zambrano','Jessica Calderón','Gabriela Navas','Jordy Zamora','Gabriel Torres'];
  const EVENT_TYPES = ['Agenda Alcaldía','Reunión','Avanzada','Mesa de trabajo','Capacitación','Socialización','PAP','Otro'];
  const APP_TZ = 'America/Guayaquil';
  let state = {events:[], assignables:ASSIGNABLES_DEFAULT, registrars:REGISTRARS_DEFAULT, config:{}, currentEventId:null};
  let savingNewEvent = false;
  let savingEventChanges = false;
  let uploadingEvidence = false;
  let processingInput = false;
  const LOCAL_MODE = !!(window.AGENDA_CONFIG && window.AGENDA_CONFIG.localMode);
  const MAX_UPLOAD_MB = Number(window.AGENDA_CONFIG?.maxUploadMB || 7);
  const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const uid = p => `${p}-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
  const todayISO = () => new Intl.DateTimeFormat('en-CA',{timeZone:APP_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const fmtDate = iso => { if(!iso) return 'Sin fecha'; const [y,m,d]=iso.split('-'); return `${d}/${m}/${y}`; };
  const fmtNow = () => new Intl.DateTimeFormat('es-EC',{timeZone:APP_TZ,weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date());
  const dt = e => e.fecha && e.hora ? new Date(`${e.fecha}T${e.hora}:00-05:00`) : null;
  function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}

  function serverCall(fn, ...args){
    if(LOCAL_MODE) return Promise.resolve(localApi[fn] ? localApi[fn](...args) : null);
    return window.AgendaApi.call(fn, ...args);
  }
  const localApi = {
    getBootstrapData(){return JSON.parse(localStorage.getItem('agendaHigieneData')||'null') || {events:[],assignables:ASSIGNABLES_DEFAULT,registrars:REGISTRARS_DEFAULT,config:{mode:'local'}};},
    saveEvent(ev){const data=this.getBootstrapData();const i=data.events.findIndex(x=>x.id===ev.id);if(i>=0)data.events[i]=ev;else data.events.push(ev);localStorage.setItem('agendaHigieneData',JSON.stringify(data));return ev;},
    saveEventBundle(bundle){return this.saveEvent(bundle.event)},
    uploadEvidence(payload){return {id:uid('EVD'),eventId:payload.eventId,tipo:payload.tipo||'ARCHIVO',nombre:payload.nombre||'evidencia',url:'',texto:payload.texto||'',createdAt:new Date().toISOString()};},
    extractDocument(payload){return heuristicExtract(payload.rawText||'',payload.eventType||'');},
    seedDemo(){const data=this.getBootstrapData();data.events=demoEvents();localStorage.setItem('agendaHigieneData',JSON.stringify(data));return data;}
  };
  function persistLocal(){if(LOCAL_MODE)localStorage.setItem('agendaHigieneData',JSON.stringify({events:state.events,assignables:state.assignables,registrars:state.registrars,config:state.config}));}

  function heuristicExtract(text,eventType){
    const raw=String(text||'').replace(/\s+/g,' ').trim();
    const labels='tema|asunto|motivo|fecha|hora|lugar|ubicación|ubicacion|sitio|convocados|convoca|asistentes|observaciones|nota|detalle';

    function field(names){
      const re=new RegExp('\\b(?:'+names+')\\b\\s*[:\\-]?\\s*(.*?)(?=\\s*[.;]?\\s*\\b(?:'+labels+')\\b\\s*[:\\-]?|$)','i');
      const m=raw.match(re);
      return m?m[1].trim().replace(/[.;,\s]+$/,''):'';
    }

    const dm=raw.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
    let fecha='';
    if(dm){
      let y=dm[3];
      if(y.length===2)y='20'+y;
      fecha=`${y}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;
    }

    const tm=raw.match(/\b([01]?\d|2[0-3])[:h.]([0-5]\d)\b/i);
    const hora=tm?`${tm[1].padStart(2,'0')}:${tm[2]}`:'';

    let tema=field('tema|asunto|motivo');
    if(!tema){
      const markers=[
        /\bfecha\b\s*[:\-]?\s*\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/i,
        /\bhora\b\s*[:\-]?\s*(?:[01]?\d|2[0-3])[:h.][0-5]\d/i,
        /\b(?:lugar|ubicación|ubicacion|sitio)\b\s*[:\-]?/i,
        /\b(?:convocados|convoca|asistentes)\b\s*[:\-]?/i,
        /\b(?:observaciones|nota|detalle)\b\s*[:\-]?/i
      ];
      let cut=raw.length;
      markers.forEach(re=>{const m=raw.match(re);if(m&&m.index<cut)cut=m.index;});
      tema=raw.slice(0,cut).trim().replace(/[.;,\s]+$/,'');
    }

    const urls=(raw.match(/https?:\/\/[^\s<>"']+/gi)||[])
      .map(url=>url.replace(/[),.;]+$/,''));

    const linkUbicacion=
      urls.find(url=>/(?:maps\.app\.goo\.gl|google\.[^/]+\/maps|goo\.gl\/maps|waze\.com)/i.test(url))||'';

    const linkReunion=
      urls.find(url=>/(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com)/i.test(url))||'';

    return {
      tipo:eventType||field('tipo|evento'),
      tema,
      fecha:fecha||field('fecha'),
      hora:hora||field('hora'),
      lugar:field('lugar|ubicación|ubicacion|sitio'),
      convocados:field('convocados|convoca|asistentes'),
      observaciones:field('observaciones|nota|detalle'),
      linkReunion,
      linkUbicacion,
      rawText:raw
    };
  }
  function alertInfo(e,now=new Date()){
    if(e.estadoAdmin==='CERRADO') return null; const when=dt(e); if(!when) return {urgency:null,assignment:(e.asignados||[]).length?'ASIGNADO':'NO ASIGNADO',hours:null};
    const h=(when-now)/36e5; let urgency=null; if(h<=0) urgency='VENCIDO'; else if(h<=1) urgency='CRÍTICO'; else if(h<=3) urgency='PRÓXIMO';
    return {urgency,assignment:(e.asignados||[]).length?'ASIGNADO':'NO ASIGNADO',hours:h};
  }
  function urgencyPill(u){if(!u)return '';const c=u==='PRÓXIMO'?'urg-proximo':u==='CRÍTICO'?'urg-critico':'urg-vencido';return `<span class="alert-pill ${c}">${u}</span>`}
  function assignmentPill(a){return `<span class="assign-pill ${a==='ASIGNADO'?'a-assigned':'a-unassigned'}">${a}</span>`}
  function adminPill(s){const c=s==='RECIBIDO'?'s-received':s==='ASIGNADO'?'s-assigned':s==='EJECUTADO'?'s-executed':'s-closed';return `<span class="status-pill ${c}">${s==='CERRADO'?'✓ ':''}${s}</span>`}
  function eventVisualState(e, now = new Date()){
  const admin = String(e.estadoAdmin || 'RECIBIDO').toUpperCase();

  if(admin === 'CERRADO') return 'CERRADO';
  if(admin === 'EJECUTADO') return 'EJECUTADO';

  const assigned = (e.asignados || []).length > 0;
  const when = dt(e);

  // La hora ya pasó, pero todavía nadie confirmó ejecución.
  if(when && when.getTime() <= now.getTime()){
    return 'VENCIDO';
  }

  // A 3 horas o menos y continúa sin responsable.
  if(!assigned && when){
    const hours = (when.getTime() - now.getTime()) / 36e5;

    if(hours <= 3){
      return 'NO ASIGNADO';
    }
  }

  if(assigned) return 'ASIGNADO';

  return 'RECIBIDO';
}

function eventStatePill(e){
  const stateName = eventVisualState(e);

  const colors = {
    'RECIBIDO':     ['#dcecff', '#0b5cab'],
    'NO ASIGNADO': ['#ffe3e3', '#b42318'],
    'ASIGNADO':    ['#fff0bd', '#9a6700'],
    'VENCIDO':     ['#e8edf2', '#43576b'],
    'EJECUTADO':   ['#daf5e4', '#08783f'],
    'CERRADO':     ['#148447', '#ffffff']
  };

  const [bg, color] = colors[stateName] || colors.RECIBIDO;

  return `
    <span style="
      display:inline-flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      min-width:92px;
      padding:6px 12px;
      border-radius:999px;
      background:${bg};
      color:${color};
      line-height:1.05;
      font-weight:800;
    ">
      <span style="
        font-size:9px;
        letter-spacing:.8px;
        opacity:.72;
        margin-bottom:3px;
      ">EVENTO</span>
      <span style="font-size:12px">${stateName}</span>
    </span>`;
}
  function commitmentStatePill(e){
  const commitments = Array.isArray(e.compromisos)
    ? e.compromisos.filter(c => c && c.compromiso)
    : [];

  if (!commitments.length) return '';

  const total = commitments.length;
  const executed = commitments.filter(
    c => String(c.estado || '').toUpperCase() === 'EJECUTADO'
  ).length;

  let labelTop = '';
  let labelBottom = '';
  let bg = '';
  let color = '';
  let minWidth = '105px';

  if (total === 1) {
    labelTop = 'COMPROMISO';

    if (executed === 1) {
      labelBottom = 'EJECUTADO';
      bg = '#daf5e4';
      color = '#08783f';
    } else {
      labelBottom = 'ASIGNADO';
      bg = '#e8f1ff';
      color = '#2059a6';
    }

  } else {
    labelTop = 'COMPROMISOS';

    if (executed === 0) {
      labelBottom = 'ASIGNADOS';
      bg = '#e8f1ff';
      color = '#2059a6';

    } else if (executed === total) {
      labelBottom = 'EJECUTADOS';
      bg = '#daf5e4';
      color = '#08783f';

    } else {
      labelBottom = 'PARCIALMENTE EJECUTADOS';
      bg = '#fff1d6';
      color = '#9a5b00';
      minWidth = '150px';
    }
  }

  return `
    <span style="
      display:inline-flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      min-width:${minWidth};
      padding:6px 12px;
      border-radius:999px;
      background:${bg};
      color:${color};
      line-height:1.05;
      font-weight:800;
      text-align:center;
    ">
      <span style="
        font-size:9px;
        letter-spacing:.7px;
        opacity:.72;
        margin-bottom:3px;
      ">${labelTop}</span>

      <span style="
        font-size:${labelBottom === 'PARCIALMENTE EJECUTADOS' ? '9px' : '12px'};
      ">${labelBottom}</span>
    </span>`;
}
  async function init(){
  $('#todayLabel').textContent = fmtNow();
  $('#demoBtn').classList.toggle('hidden', !LOCAL_MODE);

  bind();

  // Carga inmediatamente las listas disponibles en el navegador.
  // Luego Apps Script las actualiza silenciosamente desde Google Sheets.
  fillSelectors();

  fillConnectionFields();

  if (!LOCAL_MODE && !window.AgendaApi.isConfigured()) {
    openSettings();
    renderAll();
    return;
  }

  // Sincronización con la base maestra en segundo plano.
  refresh();
}
  async function refresh(){
    try{const d=await serverCall('getBootstrapData');state.events=(d?.events||[]).map(normalizeEvent);state.assignables=d?.assignables?.length?d.assignables:ASSIGNABLES_DEFAULT;state.registrars=d?.registrars?.length?d.registrars:REGISTRARS_DEFAULT;state.config=d?.config||{};renderAll();}
    catch(e){console.error(e);const msg=e?.message||String(e);if(/ACCESO_DENEGADO|CLAVE_NO_CONFIGURADA|BACKEND_NO_CONFIGURADO/.test(msg)){setConnectionState('No se pudo autenticar la conexión.','bad');openSettings();}toast('No se pudo cargar la base. Revise la conexión.');}
  }
  function normalizeEvent(e){return {...e,asignados:Array.isArray(e.asignados)?e.asignados:(e.asignados?String(e.asignados).split('|').filter(Boolean):[]),compromisos:Array.isArray(e.compromisos)?e.compromisos:[],evidencias:Array.isArray(e.evidencias)?e.evidencias:[]};}
  function updateEventInState(event){
  const updated = normalizeEvent(event);
  const i = state.events.findIndex(x => x.id === updated.id);

  if(i >= 0){
    state.events[i] = updated;
  } else {
    state.events.push(updated);
  }

  return updated;
}
  function bind(){
    $$('.nav button').forEach(b=>b.onclick=()=>showView(b.dataset.view));
    $('#registrador').onchange=()=>$('#registradorOtroWrap').classList.toggle('hidden',$('#registrador').value!=='Otro');
    $('#fuente').onchange=()=>$('#fuenteOtroWrap').classList.toggle('hidden',$('#fuente').value!=='Otro');
    $('#tipo').onchange=()=>$('#tipoOtroWrap').classList.toggle('hidden',$('#tipo').value!=='Otro');
    $('#pickFileBtn').onclick=()=>$('#sourceFile').click();$('#fTema').oninput=updateGeneratedHeader;$('#fFecha').oninput=updateGeneratedHeader; $('#sourceFile').onchange=()=>$('#fileName').textContent=$('#sourceFile').files[0]?.name||'Sin archivo seleccionado';
    $('#processBtn').onclick=processInput; $('#cancelGenerated').onclick=()=>$('#generatedForm').classList.add('hidden'); $('#saveNewEvent').onclick=saveNewEvent;
    $('#directorySearch').oninput=renderDirectory; $('#directoryFilter').onchange=renderDirectory; $('#generalSearch').oninput=renderGeneral;
    $('#drawerClose').onclick=closeDrawer; $('#drawerBackdrop').onclick=closeDrawer;
    $('#alertsBtn').onclick=openAlerts; $('#alertsClose').onclick=()=>$('#alertsModal').classList.remove('open'); $('#alertsModal').onclick=e=>{if(e.target===$('#alertsModal'))$('#alertsModal').classList.remove('open')};
    $('#notifyBtn').onclick=requestNotifications; $('#settingsBtn').onclick=openSettings; $('#settingsClose').onclick=closeSettings; $('#settingsModal').onclick=e=>{if(e.target===$('#settingsModal'))closeSettings()}; $('#saveConnection').onclick=saveConnection; $('#clearConnection').onclick=clearConnection; $('#demoBtn').onclick=async()=>{await serverCall('seedDemo');await refresh();toast('Datos de demostración cargados.');};
  }

  function fillConnectionFields(){
    const fixed=window.AGENDA_CONFIG?.backendUrl||'';
    $('#backendUrl').value=window.AgendaApi?.getBackendUrl?.()||fixed;
    $('#accessKey').value=window.AgendaApi?.getAccessKey?.()||'';
    setConnectionState(window.AgendaApi?.isConfigured?.()?'Conexión guardada en este dispositivo.':'Falta configurar la conexión.', window.AgendaApi?.isConfigured?.()?'warn':'bad');
  }
  function setConnectionState(text,kind='warn'){const el=$('#connectionState');if(!el)return;el.textContent=text;el.className=`hint conn-${kind}`;}
  function openSettings(){fillConnectionFields();$('#settingsModal').classList.add('open')}
  function closeSettings(){$('#settingsModal').classList.remove('open')}
  async function saveConnection(){
    try{
      window.AgendaApi.configure($('#backendUrl').value,$('#accessKey').value);
      setConnectionState('Comprobando conexión…','warn');
      await window.AgendaApi.call('ping');
      setConnectionState('✓ Conexión correcta.','ok');
      await refresh(); setTimeout(closeSettings,450); toast('Aplicativo conectado con la base maestra.');
    }catch(e){console.error(e);setConnectionState(e?.message||'No se pudo conectar.','bad');}
  }
  function clearConnection(){window.AgendaApi.clear();$('#accessKey').value='';setConnectionState('Conexión borrada de este dispositivo.','warn');}

  function showView(v){$$('.section').forEach(s=>s.classList.remove('active'));$(`#view-${v}`).classList.add('active');$$('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===v));window.scrollTo({top:0,behavior:'smooth'});}
  function fillSelectors(){
    $('#registrador').innerHTML='<option value="">Seleccione...</option>'+state.registrars.map(n=>`<option>${esc(n)}</option>`).join('')+'<option>Otro</option>';
    $('#newEventPeople').innerHTML=state.assignables.map(n=>`<label class="person-check"><input type="checkbox" value="${esc(n)}">${esc(n)}</label>`).join('');
  }
  function renderAll(){fillSelectors();renderDaily();renderDirectory();renderGeneral();renderAlerts();}

function eventCard(e,readOnly=false){
  return `
    <article class="event-card" data-id="${esc(e.id)}">
      <div class="event-main">
        <strong>${esc(e.tema||e.tipo||'Evento sin tema')}</strong>

        <div class="muted" style="margin-top:2px">
          ${esc(e.tipo||'')}
        </div>

        <div class="event-meta">
          <span>📅 ${fmtDate(e.fecha)}</span>
          <span>🕐 ${esc(e.hora||'Sin hora')}</span>
          ${e.lugar ? `<span>📍 ${esc(e.lugar)}</span>` : ''}
        </div>
      </div>

      <div class="event-chips">
  ${commitmentStatePill(e)}
  ${eventStatePill(e)}
  <span>›</span>
</div>
    </article>`;
}
  function attachCards(container){container.querySelectorAll('.event-card').forEach(c=>c.onclick=()=>openEvent(c.dataset.id));}
  function renderDirectory(){const q=($('#directorySearch').value||'').toLowerCase();const f=$('#directoryFilter').value;let rows=state.events.filter(e=>e.estadoAdmin!=='CERRADO').filter(e=>!f||e.estadoAdmin===f).filter(e=>[e.tema,e.tipo,e.fecha,e.lugar].some(x=>String(x||'').toLowerCase().includes(q))).sort(sortRecent);const el=$('#directoryList');el.innerHTML=rows.length?rows.map(e=>eventCard(e)).join(''):'<div class="empty">No hay eventos activos.</div>';attachCards(el);}
  function renderGeneral(){const q=($('#generalSearch').value||'').toLowerCase();let rows=state.events.filter(e=>e.estadoAdmin==='CERRADO').filter(e=>[e.tema,e.tipo,e.fecha,e.lugar].some(x=>String(x||'').toLowerCase().includes(q))).sort(sortRecent);const el=$('#generalList');el.innerHTML=rows.length?rows.map(e=>eventCard(e,true)).join(''):'<div class="empty">Aún no existen eventos cerrados.</div>';attachCards(el);}
  function renderDaily(){const t=todayISO();const rows=state.events.filter(e=>e.fecha===t&&e.estadoAdmin!=='CERRADO').sort((a,b)=>(a.hora||'99:99').localeCompare(b.hora||'99:99'));const el=$('#dailyList');el.innerHTML=rows.length?rows.map(e=>eventCard(e)).join(''):'<div class="empty">No hay eventos programados para hoy.</div>';attachCards(el);}
  function sortRecent(a,b){const av=`${a.fecha||''} ${a.hora||''}`;const bv=`${b.fecha||''} ${b.hora||''}`;return bv.localeCompare(av)}

  function getTodayAlerts(){return state.events.filter(e=>e.fecha===todayISO()&&e.estadoAdmin!=='CERRADO').map(e=>({e,a:alertInfo(e)})).filter(x=>x.a?.urgency).sort((x,y)=>(x.e.hora||'').localeCompare(y.e.hora||''));}
function alertRow(x){
  const e = x.e;

  return `
    <div class="alert-row" data-id="${esc(e.id)}">
      <div>
        <strong>${esc(e.tema || e.tipo || 'Evento')}</strong>
        <span class="muted">${esc(e.hora || '')}</span>

        <div class="alert-sub">
          ${eventStatePill(e)}
        </div>
      </div>

      <div style="align-self:center">›</div>
    </div>`;
}
  function renderAlerts(){const rows=getTodayAlerts();$('#alertCount').textContent=rows.length;$('#alertCount').classList.toggle('hidden',!rows.length);$('#alertCountLabel').textContent=rows.length;$('#alertsList').innerHTML=rows.length?rows.map(alertRow).join(''):'<div class="empty" style="border:0">Sin alertas activas.</div>';$('#alertsModalList').innerHTML=rows.length?rows.map(alertRow).join(''):'<div class="empty">Sin alertas activas.</div>';[$('#alertsList'),$('#alertsModalList')].forEach(el=>el.querySelectorAll('.alert-row').forEach(r=>r.onclick=()=>{closeAlerts();openEvent(r.dataset.id)}));maybeNotify(rows);}
  function openAlerts(){$('#alertsModal').classList.add('open')} function closeAlerts(){$('#alertsModal').classList.remove('open')}
  async function requestNotifications(){if(!('Notification'in window)){toast('Este navegador no admite notificaciones.');return}const p=await Notification.requestPermission();toast(p==='granted'?'Avisos del navegador activados mientras use la app.':'Permiso de notificación no concedido.');}
  function maybeNotify(rows){if(!('Notification'in window)||Notification.permission!=='granted')return;const today=todayISO();rows.forEach(({e,a})=>{const key=`notif:${today}:${e.id}:${a.urgency}:${a.assignment}`;if(localStorage.getItem(key))return;new Notification(`Agenda Higiene · ${a.urgency}`,{body:`${e.tema||e.tipo} · ${e.hora||''} · ${a.assignment}`});localStorage.setItem(key,'1')});}

  async function processInput(){
    if (processingInput) return;
    const registrador=$('#registrador').value==='Otro'?$('#registradorOtro').value.trim():$('#registrador').value; const fuente=$('#fuente').value==='Otro'?$('#fuenteOtro').value.trim():$('#fuente').value; const tipo=$('#tipo').value==='Otro'?$('#tipoOtro').value.trim():$('#tipo').value;
    if(!registrador||!fuente||!tipo){toast('Complete ¿Quién eres?, Fuente y Tipo de evento.');return}
    const file=$('#sourceFile').files[0]; const rawText=$('#rawText').value.trim(); if(!file&&!rawText){toast('Cargue una captura/PDF o pegue el texto.');return} if(file&&file.size>MAX_UPLOAD_MB*1024*1024){toast(`El archivo supera ${MAX_UPLOAD_MB} MB.`);return}
    const btn = $('#processBtn');
const textoOriginal = btn.textContent;

processingInput = true;
btn.disabled = true;

let puntos = 0;

const actualizarTexto = () => {
  puntos = (puntos % 3) + 1;
  btn.textContent = '✨ Procesando' + '.'.repeat(puntos);
};

actualizarTexto();
const dotsTimer = setInterval(actualizarTexto, 450);
    $('#processing').classList.remove('hidden');
    try{
      let payload={registrador,fuente,eventType:tipo,rawText,fileName:'',mimeType:'',dataUrl:''};
      if(file){payload.fileName=file.name;payload.mimeType=file.type;payload.dataUrl=await fileToDataURL(file);}
      const local=heuristicExtract(rawText,tipo);
      const out=await serverCall('extractDocument',payload);
      const x={...local,...(out||{})};

      // Cuando el usuario pega texto, los campos claramente etiquetados en ese
      // texto tienen prioridad sobre una extracción genérica del servidor.
      if(rawText){
        const hasStructuredMarkers=/\b(?:fecha|hora|lugar|ubicación|ubicacion|sitio|convocados|convoca|asistentes|observaciones|nota|detalle)\b\s*[:\-]?/i.test(rawText);
        if(hasStructuredMarkers&&local.tema)x.tema=local.tema;
        if(local.fecha)x.fecha=local.fecha;
        if(local.hora)x.hora=local.hora;
        if(local.lugar)x.lugar=local.lugar;
        if(local.convocados)x.convocados=local.convocados;
        if(local.observaciones)x.observaciones=local.observaciones;
        if(local.linkReunion)x.linkReunion=local.linkReunion;
        if(local.linkUbicacion)x.linkUbicacion=local.linkUbicacion;
      }
      $('#fTipo').value=x.tipo||tipo;$('#fTema').value=x.tema||'';$('#fFecha').value=normalizeDate(x.fecha)||'';$('#fHora').value=normalizeTime(x.hora)||'';$('#fLugar').value=x.lugar||'';$('#fConvocados').value=x.convocados||'';$('#fObservaciones').value=x.observaciones||'';$('#fLinkReunion').value=x.linkReunion||'';$('#fLinkUbicacion').value=x.linkUbicacion||'';updateGeneratedHeader();$('#generatedForm').classList.remove('hidden');$('#generatedForm').scrollIntoView({behavior:'smooth',block:'start'});
    }catch(e){console.error(e);toast('No se pudo procesar automáticamente. Puede completar la ficha manualmente.');$('#generatedForm').classList.remove('hidden');$('#fTipo').value=tipo;updateGeneratedHeader();}
    finally{
  clearInterval(dotsTimer);
  processingInput = false;
  btn.disabled = false;
  btn.textContent = textoOriginal;
  $('#processing').classList.add('hidden');
}
  }
  function fileToDataURL(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)})}
  function normalizeDate(v){if(!v)return'';if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;const m=String(v).match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);if(!m)return'';let y=m[3];if(y.length===2)y='20'+y;return`${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`}
  function normalizeTime(v){if(!v)return'';const m=String(v).match(/([01]?\d|2[0-3])[:h.]([0-5]\d)/i);return m?`${m[1].padStart(2,'0')}:${m[2]}`:''}
  function normalizeOptionalUrl(value){
    const raw=String(value||'').trim();
    if(!raw)return'';
    const candidate=/^https?:\/\//i.test(raw)?raw:`https://${raw}`;
    try{
      const url=new URL(candidate);
      if(url.protocol!=='http:'&&url.protocol!=='https:')return'';
      return url.href;
    }catch(_){
      return'';
    }
  }
  function updateGeneratedHeader(){$('#generatedHeader').textContent=`Evento: ${$('#fTema').value||'Sin tema'}`;$('#generatedDate').textContent=fmtDate($('#fFecha').value)}
  async function saveNewEvent(){
    if(savingNewEvent)return;

    const registrador=$('#registrador').value==='Otro'?$('#registradorOtro').value.trim():$('#registrador').value;
    const fuente=$('#fuente').value==='Otro'?$('#fuenteOtro').value.trim():$('#fuente').value;
    const assigned=$$('#newEventPeople input:checked').map(x=>x.value);

    const rawLinkReunion=$('#fLinkReunion').value.trim();
    const rawLinkUbicacion=$('#fLinkUbicacion').value.trim();
    const linkReunion=normalizeOptionalUrl(rawLinkReunion);
    const linkUbicacion=normalizeOptionalUrl(rawLinkUbicacion);

    if(rawLinkReunion&&!linkReunion){
      toast('El enlace de reunión virtual no es válido.');
      return;
    }
    if(rawLinkUbicacion&&!linkUbicacion){
      toast('El enlace de ubicación no es válido.');
      return;
    }

    const ev=normalizeEvent({
      id:uid('EVT'),
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString(),
      registrador,
      fuente,
      tipo:$('#fTipo').value.trim(),
      tema:$('#fTema').value.trim(),
      fecha:$('#fFecha').value,
      hora:$('#fHora').value,
      lugar:$('#fLugar').value.trim(),
      convocados:$('#fConvocados').value.trim(),
      linkReunion,
      linkUbicacion,
      asignados:assigned,
      estadoAdmin:'RECIBIDO',
      observaciones:$('#fObservaciones').value.trim(),
      rawText:$('#rawText').value.trim(),
      compromisos:[],
      evidencias:[]
    });

    if(!ev.tema||!ev.fecha||!ev.hora){
      toast('Tema, fecha y hora son obligatorios.');
      return;
    }

    const btn=$('#saveNewEvent');
    const textoOriginal=btn.textContent;
    savingNewEvent=true;
    btn.disabled=true;
    btn.textContent='Guardando…';

    try{
      const saved = await serverCall('saveEventBundle',{event:ev});

updateEventInState(saved || ev);
renderAll();

resetRegister();
showView('directory');
toast('Evento guardado en el Directorio.');
    }catch(err){
      console.error(err);
      toast('No se pudo guardar el evento. Intente nuevamente.');
    }finally{
      savingNewEvent=false;
      btn.disabled=false;
      btn.textContent=textoOriginal;
    }
  }
  function resetRegister(){['#registrador','#fuente','#tipo'].forEach(id=>$(id).value='');['#registradorOtro','#fuenteOtro','#tipoOtro','#rawText','#fTipo','#fTema','#fFecha','#fHora','#fLugar','#fConvocados','#fLinkReunion','#fLinkUbicacion','#fObservaciones'].forEach(id=>$(id).value='');$('#sourceFile').value='';$('#fileName').textContent='Sin archivo seleccionado';$('#generatedForm').classList.add('hidden');$$('#newEventPeople input').forEach(x=>x.checked=false)}

function openEvent(id){
  const e = state.events.find(x => x.id === id);
  if (!e) return;

  state.currentEventId = id;

  const readOnly = e.estadoAdmin === 'CERRADO';

  $('#drawerTitle').textContent =
    e.tema || e.tipo || 'Evento';

  $('#drawerSub').textContent = [
    e.tipo,
    fmtDate(e.fecha),
    e.hora || 'Sin hora',
    e.lugar
  ].filter(Boolean).join(' · ');

  $('#drawerAdminState').innerHTML =
    adminPill(e.estadoAdmin || 'RECIBIDO');

  $('#drawerBody').innerHTML =
    eventEditor(e, readOnly);

  $('#drawer').classList.add('open');
  $('#drawerBackdrop').classList.add('open');

  bindEventEditor(e, readOnly);
}  function closeDrawer(){$('#drawer').classList.remove('open');$('#drawerBackdrop').classList.remove('open');state.currentEventId=null}
  function eventEditor(e,ro){
    const assignments=state.assignables.map(n=>`<label class="person-check"><input class="edit-assignee" type="checkbox" value="${esc(n)}" ${(e.asignados||[]).includes(n)?'checked':''}>${esc(n)}</label>`).join('');
    const comps=(e.compromisos||[]).map(commitRow).join('');
    const evid=(e.evidencias||[]).map(v=>{
      const body=v.url?`<a href="${esc(v.url)}" target="_blank">${esc(v.nombre||'Abrir archivo')}</a>`:esc(v.nombre||v.texto||'Texto registrado');
      return `<div class="evidence-item"><b>${esc(v.tipo||'Evidencia')}</b><br>${body}</div>`;
    }).join('');
    const closedNote=ro?'<div class="card" style="margin-top:12px"><b>✓ Evento cerrado</b><div class="muted">Registro histórico de solo lectura.</div></div>':'';
    const reunionUrl=normalizeOptionalUrl(e.linkReunion);
    const ubicacionUrl=normalizeOptionalUrl(e.linkUbicacion);
    const linkActions=(reunionUrl||ubicacionUrl)?`
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        ${reunionUrl?`<a class="secondary" href="${esc(reunionUrl)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px">🔗 Abrir reunión virtual</a>`:''}
        ${ubicacionUrl?`<a class="secondary" href="${esc(ubicacionUrl)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px">📍 Ver ubicación</a>`:''}
      </div>`:'';    
    return `
      ${linkActions}
      <div class="${ro?'readonly-mask':''}">
        <div class="card">
          <div class="card-title">🗂️ Ficha del evento</div>
          <div class="grid grid-2">
            <div class="field"><label>Tipo</label><input id="editTipo" value="${esc(e.tipo||'')}"></div>
            <div class="field"><label>Tema</label><input id="editTema" value="${esc(e.tema||'')}"></div>
            <div class="field"><label>Fecha</label><input id="editFecha" type="date" value="${esc(e.fecha||'')}"></div>
            <div class="field"><label>Hora</label><input id="editHora" type="time" value="${esc(e.hora||'')}"></div>
            <div class="field"><label>Lugar</label><input id="editLugar" value="${esc(e.lugar||'')}"></div>
            <div class="field"><label>Convocados</label><input id="editConvocados" value="${esc(e.convocados||'')}"></div>
            <div class="field"><label>Enlace de reunión virtual · opcional</label><input id="editLinkReunion" type="url" inputmode="url" placeholder="https://meet.google.com/..." value="${esc(e.linkReunion||'')}"></div>
            <div class="field"><label>Enlace de ubicación · opcional</label><input id="editLinkUbicacion" type="url" inputmode="url" placeholder="https://maps.app.goo.gl/..." value="${esc(e.linkUbicacion||'')}"></div>
          </div>
          <div class="field"><label>Asignado(s)</label><div class="people-grid">${assignments}</div></div>
        </div>
        <div class="card" style="margin-top:12px">
          <div class="card-title">🎯 Compromisos y asignaciones operativas <button class="secondary" style="margin-left:auto" id="addCommitment">＋ Añadir compromiso</button></div>
          <div id="commitments">${comps||'<div class="empty" id="noCommitments">Sin compromisos registrados.</div>'}</div>
        </div>
        <div class="card" style="margin-top:12px">
          <div class="card" style="margin-top:12px">
          <div class="card-title">📎 Evidencia</div>
          <div class="evidence-grid">
            <div><div class="field"><label>Archivo</label><input id="evidenceFile" type="file" accept="image/*,.pdf,application/pdf"></div><button class="secondary wide" id="addFileEvidence">📷 / PDF / Captura · Subir</button></div>
            <div><div style="display:flex;gap:8px;align-items:center"><div class="note-icon">🗒️</div><b>Texto manual</b></div><div class="field"><textarea id="evidenceText" placeholder="Escriba aquí la evidencia o constancia manual..."></textarea></div><button class="secondary wide" id="addTextEvidence">Añadir texto como evidencia</button></div>
          </div>
          <div id="evidenceList" class="evidence-grid" style="margin-top:10px">${evid||'<div class="muted">Aún no hay evidencias.</div>'}</div>
        </div>
        <div class="card" style="margin-top:12px"><div class="card-title">💬 Observaciones</div><div class="field"><textarea id="editObs">${esc(e.observaciones||'')}</textarea></div></div>
        ${!ro ? `
<div class="form-actions" style="
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:12px;
  flex-wrap:wrap;
">
  <button class="primary" id="saveEventChanges">
    Guardar cambios
  </button>

  <div style="display:flex;gap:10px;margin-left:auto">
    ${e.estadoAdmin !== 'EJECUTADO' ? `
      <button class="secondary" id="markEventExecuted">
        ✓ Marcar ejecutado
      </button>
    ` : ''}

    <button class="success" id="closeEventBtn">
      ✓ Cerrar evento
    </button>
  </div>
</div>
` : ''}
      </div>
      ${closedNote}`;
  }
  function commitRow(c={}){return `<div class="commit-row" data-id="${esc(c.id||uid('CMP'))}"><input class="c-text" placeholder="Compromiso" value="${esc(c.compromiso||'')}"><select class="c-resp"><option value="">Sin responsable</option>${state.assignables.map(n=>`<option ${c.responsable===n?'selected':''}>${esc(n)}</option>`).join('')}</select><select class="c-state"><option ${(!c.estado||c.estado==='RECIBIDO')?'selected':''}>RECIBIDO</option><option ${c.estado==='ASIGNADO'?'selected':''}>ASIGNADO</option><option ${c.estado==='NO ASIGNADO'?'selected':''}>NO ASIGNADO</option><option ${c.estado==='EJECUTADO'?'selected':''}>EJECUTADO</option></select><button class="remove-btn" title="Eliminar">🗑</button></div>`}
function bindEventEditor(e, ro){
  if (ro) return;

  const addCommitmentBtn = $('#addCommitment');

  if (addCommitmentBtn) {
    addCommitmentBtn.onclick = () => {
      const n = $('#noCommitments');

      if (n) n.remove();

      $('#commitments').insertAdjacentHTML(
        'beforeend',
        commitRow({estado:'RECIBIDO'})
      );

      bindRemoveCommitments();
    };
  }

  bindRemoveCommitments();

  const addTextEvidenceBtn = $('#addTextEvidence');
  if (addTextEvidenceBtn) {
    addTextEvidenceBtn.onclick = () => addEvidence('TEXTO');
  }

  const addFileEvidenceBtn = $('#addFileEvidence');
  if (addFileEvidenceBtn) {
    addFileEvidenceBtn.onclick = () => addEvidence('ARCHIVO');
  }

  const saveBtn = $('#saveEventChanges');
  if (saveBtn) {
    saveBtn.onclick = () => saveEventChanges();
  }

  const executedBtn = $('#markEventExecuted');
  if (executedBtn) {
    executedBtn.onclick = () => setAdminState('EJECUTADO');
  }

  const closeBtn = $('#closeEventBtn');
  if (closeBtn) {
    closeBtn.onclick = () => setAdminState('CERRADO');
  }
}
  function bindRemoveCommitments(){$$('#commitments .remove-btn').forEach(b=>b.onclick=()=>b.closest('.commit-row').remove())}
  function collectCommitments(){return $$('#commitments .commit-row').map(r=>({id:r.dataset.id||uid('CMP'),eventId:state.currentEventId,compromiso:r.querySelector('.c-text').value.trim(),responsable:r.querySelector('.c-resp').value,estado:r.querySelector('.c-state').value,updatedAt:new Date().toISOString()})).filter(c=>c.compromiso)}
  async function addEvidence(kind) {
  const e = state.events.find(x => x.id === state.currentEventId);
  if (!e) return;

  if (kind === 'ARCHIVO' && uploadingEvidence) return;

  let payload = {
    eventId: e.id,
    tipo: kind,
    nombre: '',
    texto: '',
    dataUrl: '',
    mimeType: ''
  };

  let btn = null;
  let textoOriginal = '';
  let dotsTimer = null;

  try {
    if (kind === 'TEXTO') {
      payload.texto = $('#evidenceText').value.trim();
      payload.nombre = 'Nota manual';

      if (!payload.texto) {
        toast('Escriba el texto de la evidencia.');
        return;
      }

    } else {
      const f = $('#evidenceFile').files[0];

      if (!f) {
        toast('Seleccione un archivo.');
        return;
      }

      if (f.size > MAX_UPLOAD_MB * 1024 * 1024) {
        toast(`El archivo supera ${MAX_UPLOAD_MB} MB.`);
        return;
      }

      btn = $('#addFileEvidence');
      textoOriginal = btn.textContent;

      uploadingEvidence = true;
      btn.disabled = true;

      let puntos = 0;

      const actualizarTexto = () => {
        puntos = (puntos % 3) + 1;
        btn.textContent =
          '📷 / PDF / Captura · Subiendo' + '.'.repeat(puntos);
      };

      actualizarTexto();
      dotsTimer = setInterval(actualizarTexto, 450);

      payload.nombre = f.name;
      payload.mimeType = f.type;
      payload.dataUrl = await fileToDataURL(f);

      payload.tipo =
        f.type === 'application/pdf'
          ? 'PDF'
          : (f.type.startsWith('image/') ? 'CAPTURA' : 'ARCHIVO');
    }

    const ev = await serverCall('uploadEvidence', payload);

e.evidencias = e.evidencias || [];
e.evidencias.push(ev);

if (LOCAL_MODE) {
  persistLocal();
}

openEvent(e.id);
toast('Evidencia añadida correctamente.');

  } catch (err) {
    console.error(err);
    toast('No se pudo subir la evidencia.');

  } finally {
    if (dotsTimer) clearInterval(dotsTimer);

    if (kind === 'ARCHIVO') {
      uploadingEvidence = false;

      if (btn) {
        btn.disabled = false;
        btn.textContent = textoOriginal;
      }
    }
  }
}
async function saveEventChanges(targetState){
  if (savingEventChanges) return;

  const e = state.events.find(x => x.id === state.currentEventId);
  if (!e) return;

  const rawLinkReunion=$('#editLinkReunion').value.trim();
  const rawLinkUbicacion=$('#editLinkUbicacion').value.trim();
  const linkReunion=normalizeOptionalUrl(rawLinkReunion);
  const linkUbicacion=normalizeOptionalUrl(rawLinkUbicacion);

  if(rawLinkReunion&&!linkReunion){
    toast('El enlace de reunión virtual no es válido.');
    return;
  }
  if(rawLinkUbicacion&&!linkUbicacion){
    toast('El enlace de ubicación no es válido.');
    return;
  }

  e.tipo = $('#editTipo').value.trim();
  e.tema = $('#editTema').value.trim();
  e.fecha = $('#editFecha').value;
  e.hora = $('#editHora').value;
  e.lugar = $('#editLugar').value.trim();
  e.convocados = $('#editConvocados').value.trim();
  e.linkReunion = linkReunion;
  e.linkUbicacion = linkUbicacion;
  e.asignados = $$('.edit-assignee:checked').map(x => x.value);
  e.compromisos = collectCommitments();
  e.observaciones = $('#editObs').value.trim();

  if (targetState) {
    e.estadoAdmin = targetState;
  } else if (e.estadoAdmin === 'RECIBIDO' && e.asignados.length) {
    e.estadoAdmin = 'ASIGNADO';
  }

  e.updatedAt = new Date().toISOString();

  const btn = $('#saveEventChanges');
  const textoOriginal = btn ? btn.textContent : 'Guardar cambios';

  savingEventChanges = true;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Guardando…';
  }

  try {
    const saved = await serverCall('saveEventBundle', {event: e});

const updated = updateEventInState(saved || e);
renderAll();

openEvent(updated.id);
toast('Cambios guardados correctamente.');

  } catch (err) {
    console.error(err);
    toast('No se pudieron guardar los cambios.');

  } finally {
    savingEventChanges = false;

    if (btn) {
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  }
}  async function setAdminState(s){const e=state.events.find(x=>x.id===state.currentEventId);if(!e)return;if(s==='CERRADO'&&!(e.evidencias||[]).length){toast('No se puede cerrar sin evidencia.');return}if(s==='CERRADO'&&!confirm('¿Cerrar este evento? Pasará al Panel general y quedará en solo lectura.'))return;await saveEventChanges(s);if(s==='CERRADO'){closeDrawer();showView('general');}}

  function demoEvents(){const t=todayISO();return [
    {id:uid('EVT'),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),registrador:'Romeo Mendoza',fuente:'WhatsApp',tipo:'Reunión',tema:'Reunión con comunidad',fecha:t,hora:addHoursTime(0.7),lugar:'Manta',convocados:'Direcciones municipales',asignados:[],estadoAdmin:'RECIBIDO',observaciones:'',compromisos:[],evidencias:[]},
    {id:uid('EVT'),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),registrador:'Romeo Mendoza',fuente:'Correo',tipo:'Avanzada',tema:'Levantamiento de información',fecha:t,hora:addHoursTime(2.3),lugar:'Tarqui',convocados:'Higiene',asignados:['William Pruss'],estadoAdmin:'ASIGNADO',observaciones:'',compromisos:[],evidencias:[]},
    {id:uid('EVT'),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),registrador:'Romeo Mendoza',fuente:'Gestor',tipo:'Capacitación',tema:'Manejo de residuos',fecha:t,hora:addHoursTime(0.8),lugar:'Municipio',convocados:'Personal operativo',asignados:['Gabriel García'],estadoAdmin:'ASIGNADO',observaciones:'',compromisos:[],evidencias:[]}
  ].map(normalizeEvent)}
  function addHoursTime(h){const d=new Date(Date.now()+h*36e5);return new Intl.DateTimeFormat('en-GB',{timeZone:APP_TZ,hour:'2-digit',minute:'2-digit',hour12:false}).format(d)}

  window.addEventListener('load',init);
})();
