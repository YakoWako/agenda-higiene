(() => {
  const ASSIGNABLES_DEFAULT = ['Carlos Pacheco','William Pruss','Darwin Zambrano','Roque Mendoza','Romeo Mendoza','Leonardo Figueroa','William Torres','Gabriel Torres','Oldemar Giler','Gabriel García','Johnny Zambrano','Jordy Zamora'];
  const REGISTRARS_DEFAULT = ['Carlos Pacheco','William Pruss','Romeo Mendoza','Darwin Zambrano','Jessica Calderón','Gabriela Castro','Jordy Zamora','Gabriel Torres'];
  const EVENT_TYPES = ['Agenda Alcaldía','Reunión','Avanzada','Mesa de trabajo','Capacitación','Socialización','PAP','Otro'];
  const APP_TZ = 'America/Guayaquil';
  let state = {events:[], assignables:ASSIGNABLES_DEFAULT, registrars:REGISTRARS_DEFAULT, config:{}, currentEventId:null, role:'LECTURA'};
  let dailySelectedDate = '';
  const GENERAL_PAGE_SIZE = 20;
  let generalPage = 1;
  let savingNewEvent = false;
  let savingEventChanges = false;
  let uploadingEvidence = false;
  let processingInput = false;
  const LOCAL_MODE = !!(window.AGENDA_CONFIG && window.AGENDA_CONFIG.localMode);
  const MAX_UPLOAD_MB = Number(window.AGENDA_CONFIG?.maxUploadMB || 7);
  const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const uid = p => `${p}-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
  function todayISO(){
    const d=new Date();
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,'0');
    const day=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  const fmtDate = iso => { if(!iso) return 'Sin fecha'; const [y,m,d]=iso.split('-'); return `${d}/${m}/${y}`; };
  const fmtNow = () => new Intl.DateTimeFormat('es-EC',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date());
  function shiftISODate(iso,days){
    const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m)return todayISO();
    const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])+days));
    return d.toISOString().slice(0,10);
  }
  function formatDailyDate(iso){
    const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m)return '';
    const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),12));
    const text=new Intl.DateTimeFormat('es-EC',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(d);
    return text.charAt(0).toUpperCase()+text.slice(1);
  }
  function dailyRelativeLabel(iso){
    const today=todayISO();
    if(iso===today)return 'HOY';
    if(iso===shiftISODate(today,1))return 'MAÑANA';
    if(iso===shiftISODate(today,-1))return 'AYER';
    return '';
  }
  const dt = e => e.fecha && e.hora ? new Date(`${e.fecha}T${e.hora}:00`) : null;
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

  function cleanNonLinkField(value){
    return String(value||'')
      .replace(/\b(?:enlace|link)\s+(?:de\s+)?reuni[oó]n(?:\s+virtual)?\b\s*[:\-]?/gi,' ')
      .replace(/\b(?:enlace|link)\s+(?:de\s+)?ubicaci[oó]n\b\s*[:\-]?/gi,' ')
      .replace(/https?:\/\/[^\s<>"']+/gi,' ')
      .replace(/\b(?:enlace|link)(?:\s+de)?\s*$/gi,' ')
      .replace(/\s+/g,' ')
      .replace(/^[\s,;:.\-]+|[\s,;:.\-]+$/g,'')
      .trim();
  }

  function heuristicExtract(text,eventType){
    const raw=String(text||'').replace(/\s+/g,' ').trim();

    const labelRe=/\b(enlace\s+(?:de\s+)?reuni[oó]n(?:\s+virtual)?|link\s+(?:de\s+)?reuni[oó]n(?:\s+virtual)?|enlace\s+(?:de\s+)?ubicaci[oó]n|link\s+(?:de\s+)?ubicaci[oó]n|tema|asunto|motivo|fecha|hora|lugar|sitio|ubicaci[oó]n|convocados|convoca|asistentes|observaciones|nota|detalle|tipo|evento)\b\s*[:\-]?/gi;

    const tokens=[];
    let m;

    while((m=labelRe.exec(raw))!==null){
      const label=m[1].toLowerCase();

      let key='';

      if(/^(?:enlace|link)\s+(?:de\s+)?reuni[oó]n/.test(label)) key='linkReunion';
      else if(/^(?:enlace|link)\s+(?:de\s+)?ubicaci[oó]n/.test(label)) key='linkUbicacion';
      else if(/^(?:tema|asunto|motivo)$/.test(label)) key='tema';
      else if(label==='fecha') key='fecha';
      else if(label==='hora') key='hora';
      else if(/^(?:lugar|sitio|ubicaci[oó]n)$/.test(label)) key='lugar';
      else if(/^(?:convocados|convoca|asistentes)$/.test(label)) key='convocados';
      else if(/^(?:observaciones|nota|detalle)$/.test(label)) key='observaciones';
      else if(/^(?:tipo|evento)$/.test(label)) key='tipo';

      tokens.push({
        key,
        index:m.index,
        valueStart:labelRe.lastIndex
      });
    }

    const fields={};

    tokens.forEach((token,i)=>{
      if(!token.key||fields[token.key]) return;

      const next=tokens[i+1];
      const value=raw
        .slice(token.valueStart,next?next.index:raw.length)
        .trim()
        .replace(/[.;,\s]+$/,'');

      if(value) fields[token.key]=value;
    });

    const dm=raw.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
    let fecha='';

    if(dm){
      let y=dm[3];
      if(y.length===2)y='20'+y;
      fecha=`${y}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;
    }

    const tm=raw.match(/\b([01]?\d|2[0-3])[:h.]([0-5]\d)\b/i);
    const hora=tm?`${tm[1].padStart(2,'0')}:${tm[2]}`:'';

    const urls=(raw.match(/https?:\/\/[^\s<>"']+/gi)||[])
      .map(url=>url.replace(/[),.;]+$/,''));

    const linkUbicacion=
      urls.find(url=>/(?:maps\.app\.goo\.gl|google\.[^/]+\/maps|goo\.gl\/maps|waze\.com)/i.test(url))
      || fields.linkUbicacion
      || '';

    const linkReunion=
      urls.find(url=>/(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com)/i.test(url))
      || fields.linkReunion
      || '';

    let tema=fields.tema||'';

    if(!tema){
      const firstStructured=tokens.find(t=>t.key&&t.key!=='tipo');
      tema=firstStructured
        ? raw.slice(0,firstStructured.index).trim().replace(/[.;,\s]+$/,'')
        : raw;
    }

    return {
      tipo:eventType||cleanNonLinkField(fields.tipo||''),
      tema:cleanNonLinkField(tema),
      fecha:fecha||cleanNonLinkField(fields.fecha||''),
      hora:hora||cleanNonLinkField(fields.hora||''),
      lugar:cleanNonLinkField(fields.lugar||''),
      convocados:cleanNonLinkField(fields.convocados||''),
      observaciones:cleanNonLinkField(fields.observaciones||''),
      linkReunion:normalizeOptionalUrl(linkReunion),
      linkUbicacion:normalizeOptionalUrl(linkUbicacion),
      rawText:raw
    };
  }

  function alertInfo(e,now=new Date()){
    const admin=String(e.estadoAdmin||'').toUpperCase();

    if(['CERRADO','SUSPENDIDO','EJECUTADO'].includes(admin)) return null;
    if((e.asignados||[]).length>0) return null;

    const when=dt(e);
    if(!when) return {urgency:null,hours:null};

    const h=(when-now)/36e5;
    let urgency=null;

    if(h<=0) urgency='VENCIDO';
    else if(h<=1) urgency='CRÍTICO';
    else if(h<=3) urgency='PRÓXIMO';

    return {urgency,hours:h};
  }
  function urgencyPill(u){if(!u)return '';const c=u==='PRÓXIMO'?'urg-proximo':u==='CRÍTICO'?'urg-critico':'urg-vencido';return `<span class="alert-pill ${c}">${u}</span>`}
  function eventVisualState(e, now = new Date()){
    const admin=String(e.estadoAdmin||'').toUpperCase();

    if(admin==='SUSPENDIDO') return 'SUSPENDIDO';
    if(admin==='CERRADO') return 'CERRADO';
    if(admin==='EJECUTADO') return 'EJECUTADO';

    const when=dt(e);

    // La hora ya pasó, pero todavía nadie confirmó ejecución.
    if(when&&when.getTime()<=now.getTime()){
      return 'VENCIDO';
    }

    if((e.asignados||[]).length>0) return 'ASIGNADO';

    // Sin RECIBIDO ni NO ASIGNADO: el evento activo puede quedar sin etiqueta
    // hasta que se asigne, venza, se ejecute, se suspenda o se cierre.
    return '';
  }

function eventStatePill(e){
  const stateName=eventVisualState(e);
  if(!stateName) return '';

  const colors={
    'ASIGNADO':    ['#fff0bd','#9a6700'],
    'VENCIDO':     ['#edf0ee','#59645e'],
    'EJECUTADO':   ['#daf5e4','#08783f'],
    'SUSPENDIDO':  ['#eee7f7','#6f42a6'],
    'CERRADO':     ['#148447','#ffffff']
  };

  const [bg,color]=colors[stateName]||colors.ASIGNADO;

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
  dailySelectedDate = todayISO();
  $('#demoBtn').classList.toggle('hidden', !LOCAL_MODE);

  bind();

  // Carga inmediatamente las listas disponibles en el navegador.
  // Luego Apps Script las actualiza silenciosamente desde Google Sheets.
  fillSelectors();

  fillConnectionFields();
  renderDaily();
  renderAlerts();
  applyRoleUI();

  if (!LOCAL_MODE && !window.AgendaApi.isConfigured()) {
    openSettings();
    renderAll();
    return;
  }

  // Sincronización con la base maestra en segundo plano.
  refresh();
}
  function normalizeRole(value){
    const role=String(value||'').trim().toUpperCase();
    return ['ADMIN','EDITOR','LECTURA'].includes(role)?role:'LECTURA';
  }

  function canEdit(){
    return state.role==='ADMIN'||state.role==='EDITOR';
  }

  function isAdmin(){
    return state.role==='ADMIN';
  }

  function applyRoleUI(){
    const locked=!canEdit();
    const directoryBtn=$('.nav button[data-view="directory"]');
    const registerBtn=$('.nav button[data-view="register"]');

    [directoryBtn,registerBtn].forEach(btn=>{
      if(!btn)return;
      btn.disabled=locked;
      btn.style.opacity=locked?'0.5':'';
      btn.style.cursor=locked?'not-allowed':'';
      btn.title=locked?'Acceso de solo lectura':'';
    });

    const roleLabel=$('#connectionRole');
    if(roleLabel)roleLabel.textContent='Perfil: '+state.role;
  }

  async function refresh(){
    try{
      const d=await serverCall('getBootstrapData');
      state.events=(d?.events||[]).map(normalizeEvent);
      state.assignables=d?.assignables?.length?d.assignables:ASSIGNABLES_DEFAULT;
      state.registrars=d?.registrars?.length?d.registrars:REGISTRARS_DEFAULT;
      state.config=d?.config||{};
      state.role=normalizeRole(d?.role||state.config?.role);
      renderAll();
      applyRoleUI();
    }
    catch(e){console.error(e);const msg=e?.message||String(e);if(/ACCESO_DENEGADO|CLAVE_NO_CONFIGURADA|BACKEND_NO_CONFIGURADO/.test(msg)){setConnectionState('No se pudo autenticar la conexión.','bad');openSettings();}toast('No se pudo cargar la base. Revise la conexión.');}
  }
  function normalizeEvent(e){
    let asignacionesMeta=e?.asignacionesMeta;

    if(typeof asignacionesMeta==='string'){
      try{asignacionesMeta=JSON.parse(asignacionesMeta||'{}');}
      catch(_){asignacionesMeta={};}
    }

    if(!asignacionesMeta||typeof asignacionesMeta!=='object'||Array.isArray(asignacionesMeta)){
      asignacionesMeta={};
    }

    let rawAsignados=Array.isArray(e?.asignados)
      ? e.asignados
      : (e?.asignados?String(e.asignados).split('|').filter(Boolean):[]);

    const asignados=[];

    rawAsignados.forEach(item=>{
      if(item&&typeof item==='object'){
        const nombre=String(item.nombre||item.name||'').trim();
        if(!nombre)return;

        asignados.push(nombre);

        const asignadoAt=item.asignadoAt||item.assignedAt||'';
        if(asignadoAt&&!asignacionesMeta[nombre]){
          asignacionesMeta[nombre]=asignadoAt;
        }
      }else{
        const nombre=String(item||'').trim();
        if(nombre)asignados.push(nombre);
      }
    });

    const rawAdmin=String(e?.estadoAdmin||'').toUpperCase();
    const estadoAdmin=
      rawAdmin==='RECIBIDO'||rawAdmin==='NO ASIGNADO'
        ? (asignados.length?'ASIGNADO':'')
        : rawAdmin;

    const compromisos=(Array.isArray(e.compromisos)?e.compromisos:[]).map(c=>({
      ...c,
      estado:String(c?.estado||'').toUpperCase()==='EJECUTADO'?'EJECUTADO':'ASIGNADO'
    }));

    return {
      ...e,
      tema:cleanNonLinkField(e.tema),
      lugar:cleanNonLinkField(e.lugar),
      convocados:cleanNonLinkField(e.convocados),
      observaciones:cleanNonLinkField(e.observaciones),
      asignados,
      asignacionesMeta,
      estadoAdmin,
      compromisos,
      evidencias:Array.isArray(e.evidencias)?e.evidencias:[]
    };
  }

  function serializeEventForSave(e){
    const meta=e.asignacionesMeta||{};

    return {
      ...e,
      asignados:(e.asignados||[]).map(nombre=>({
        nombre,
        asignadoAt:meta[nombre]||''
      }))
    };
  }
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
    $('#directorySearch').oninput=renderDirectory; $('#directoryFilter').onchange=renderDirectory; $('#generalSearch').oninput=()=>{generalPage=1;renderGeneral();};

    $('#dailyPrevDay').onclick=()=>{
      dailySelectedDate=shiftISODate(dailySelectedDate||todayISO(),-1);
      renderDaily();
    };
    $('#dailyNextDay').onclick=()=>{
      dailySelectedDate=shiftISODate(dailySelectedDate||todayISO(),1);
      renderDaily();
    };
    $('#dailyTodayBtn').onclick=()=>{
      dailySelectedDate=todayISO();
      renderDaily();
    };
    $('#dailyDatePicker').onchange=()=>{
      if($('#dailyDatePicker').value){
        dailySelectedDate=$('#dailyDatePicker').value;
        renderDaily();
      }
    };

    $('#drawerClose').onclick=closeDrawer; $('#drawerBackdrop').onclick=closeDrawer;
    $('#alertsBtn').onclick=openAlerts; $('#alertsClose').onclick=()=>$('#alertsModal').classList.remove('open'); $('#alertsModal').onclick=e=>{if(e.target===$('#alertsModal'))$('#alertsModal').classList.remove('open')};
    $('#notifyBtn').onclick=requestNotifications; $('#settingsBtn').onclick=openSettings; $('#settingsClose').onclick=closeSettings; $('#settingsModal').onclick=e=>{if(e.target===$('#settingsModal'))closeSettings()}; $('#saveConnection').onclick=saveConnection; $('#clearConnection').onclick=clearConnection; $('#demoBtn').onclick=async()=>{await serverCall('seedDemo');await refresh();toast('Datos de demostración cargados.');};
  }

  function fillConnectionFields(){
    $('#accessKey').value='';
    const roleLabel=$('#connectionRole');
    if(roleLabel)roleLabel.textContent='Perfil: '+state.role;
    setConnectionState(
      window.AgendaApi?.isConfigured?.()
        ? 'Conexión guardada en este dispositivo.'
        : 'Ingrese una clave de acceso para conectar este dispositivo.',
      window.AgendaApi?.isConfigured?.()?'warn':'bad'
    );
  }
  function setConnectionState(text,kind='warn'){const el=$('#connectionState');if(!el)return;el.textContent=text;el.className=`hint conn-${kind}`;}
  function openSettings(){fillConnectionFields();$('#settingsModal').classList.add('open')}
  function closeSettings(){$('#settingsModal').classList.remove('open')}
  async function saveConnection(){
    try{
      const key=$('#accessKey').value.trim();
      const backendUrl=window.AGENDA_CONFIG?.backendUrl||window.AgendaApi?.getBackendUrl?.()||'';

      if(!key){
        setConnectionState('Ingrese la clave de acceso.','bad');
        return;
      }

      window.AgendaApi.configure(backendUrl,key);
      setConnectionState('Comprobando conexión…','warn');

      const ping=await window.AgendaApi.call('ping');
      state.role=normalizeRole(ping?.role);

      await refresh();
      $('#accessKey').value='';
      closeSettings();
      toast('Conexión correcta · Perfil '+state.role);

    }catch(e){
      console.error(e);
      setConnectionState(e?.message||'No se pudo conectar.','bad');
    }
  }
  function clearConnection(){
    window.AgendaApi.clear();
    state.role='LECTURA';
    $('#accessKey').value='';
    applyRoleUI();
    setConnectionState('Conexión borrada de este dispositivo.','warn');
  }

  function showView(v){
    if((v==='directory'||v==='register')&&!canEdit()){
      toast('Este perfil tiene acceso de solo lectura.');
      return;
    }

    document.querySelectorAll('.section').forEach(section=>{
      section.classList.remove('active');
    });

    const target=document.querySelector('#view-'+v);
    if(!target){
      toast('No se encontró el panel solicitado.');
      return;
    }

    target.classList.add('active');

    document.querySelectorAll('.nav button').forEach(btn=>{
      btn.classList.toggle('active',btn.dataset.view===v);
    });

    window.scrollTo({top:0,behavior:'smooth'});
  }
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
  function attachCards(container,mode='edit'){
    container.querySelectorAll('.event-card').forEach(c=>{
      c.onclick=()=>mode==='info'?openEventInfo(c.dataset.id):openEvent(c.dataset.id);
    });
  }
  function renderDirectory(){const q=($('#directorySearch').value||'').toLowerCase();const f=$('#directoryFilter').value;let rows=state.events.filter(e=>!['CERRADO','SUSPENDIDO'].includes(String(e.estadoAdmin||'').toUpperCase())).filter(e=>!f||e.estadoAdmin===f).filter(e=>[e.tema,e.tipo,e.fecha,e.lugar].some(x=>String(x||'').toLowerCase().includes(q))).sort(sortRecent);const el=$('#directoryList');el.innerHTML=rows.length?rows.map(e=>eventCard(e)).join(''):'<div class="empty">No hay eventos activos.</div>';attachCards(el,'edit');}
  function renderGeneral(){
    const q=($('#generalSearch').value||'').toLowerCase();

    const rows=state.events
      .filter(e=>['CERRADO','SUSPENDIDO'].includes(String(e.estadoAdmin||'').toUpperCase()))
      .filter(e=>[e.tema,e.tipo,e.fecha,e.lugar].some(x=>String(x||'').toLowerCase().includes(q)))
      .sort(sortRecent);

    const el=$('#generalList');
    const pagination=$('#generalPagination');

    if(!rows.length){
      generalPage=1;
      el.innerHTML='<div class="empty">Aún no existen eventos cerrados o suspendidos.</div>';
      pagination.innerHTML='';
      attachCards(el,'info');
      return;
    }

    const total=rows.length;
    const totalPages=Math.max(1,Math.ceil(total/GENERAL_PAGE_SIZE));

    if(generalPage>totalPages) generalPage=totalPages;
    if(generalPage<1) generalPage=1;

    const start=(generalPage-1)*GENERAL_PAGE_SIZE;
    const end=Math.min(start+GENERAL_PAGE_SIZE,total);
    const pageRows=rows.slice(start,end);

    el.innerHTML=pageRows.map(e=>eventCard(e,true)).join('');
    attachCards(el,'info');

    pagination.innerHTML=`
      <div class="pagination-info">
        Mostrando ${start+1}–${end} de ${total} eventos
      </div>

      <div class="pagination-controls">
        <button class="secondary" id="generalPrevPage" type="button" ${generalPage===1?'disabled':''}>
          ‹ Anterior
        </button>

        <strong>${generalPage} / ${totalPages}</strong>

        <button class="secondary" id="generalNextPage" type="button" ${generalPage===totalPages?'disabled':''}>
          Siguiente ›
        </button>
      </div>
    `;

    const prev=$('#generalPrevPage');
    const next=$('#generalNextPage');

    if(prev){
      prev.onclick=()=>{
        if(generalPage<=1)return;
        generalPage--;
        renderGeneral();
        window.scrollTo({top:0,behavior:'smooth'});
      };
    }

    if(next){
      next.onclick=()=>{
        if(generalPage>=totalPages)return;
        generalPage++;
        renderGeneral();
        window.scrollTo({top:0,behavior:'smooth'});
      };
    }
  }
  function renderDaily(){
    const selected=dailySelectedDate||todayISO();
    dailySelectedDate=selected;

    const rows=state.events
      .filter(e=>e.fecha===selected)
      .sort((a,b)=>(a.hora||'99:99').localeCompare(b.hora||'99:99'));

    const label=dailyRelativeLabel(selected);
    const formatted=formatDailyDate(selected);

    $('#dailyDateTitle').textContent=formatted||fmtDate(selected);
    $('#dailyDateBadge').textContent=label;
    $('#dailyDatePicker').value=selected;

    const title=
      label==='HOY' ? '📅 Eventos de hoy' :
      label==='MAÑANA' ? '📅 Eventos de mañana' :
      label==='AYER' ? '📅 Eventos de ayer' :
      `📅 Eventos del ${fmtDate(selected)}`;

    $('#dailyEventsTitle').innerHTML=
      esc(title)+' <span style="font-weight:700;color:var(--muted)">('+rows.length+')</span>';

    const el=$('#dailyList');
    el.innerHTML=rows.length
      ? rows.map(e=>eventCard(e,true)).join('')
      : '<div class="empty">No hay eventos programados para esta fecha.</div>';

    attachCards(el,'info');
  }
  function sortRecent(a,b){const av=`${a.fecha||''} ${a.hora||''}`;const bv=`${b.fecha||''} ${b.hora||''}`;return bv.localeCompare(av)}

  function getTodayAlerts(){return state.events.filter(e=>e.fecha===todayISO()&&!['CERRADO','SUSPENDIDO','EJECUTADO'].includes(String(e.estadoAdmin||'').toUpperCase())).map(e=>({e,a:alertInfo(e)})).filter(x=>x.a?.urgency).sort((x,y)=>(x.e.hora||'').localeCompare(y.e.hora||''));}
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
  function renderAlerts(){const rows=getTodayAlerts();$('#alertCount').textContent=rows.length;$('#alertCount').classList.toggle('hidden',!rows.length);$('#alertCountLabel').textContent=rows.length;$('#alertsList').innerHTML=rows.length?rows.map(alertRow).join(''):'<div class="empty" style="border:0">Sin alertas activas.</div>';$('#alertsModalList').innerHTML=rows.length?rows.map(alertRow).join(''):'<div class="empty">Sin alertas activas.</div>';[$('#alertsList'),$('#alertsModalList')].forEach(el=>el.querySelectorAll('.alert-row').forEach(r=>r.onclick=()=>{closeAlerts();openEventInfo(r.dataset.id)}));maybeNotify(rows);}
  function openAlerts(){$('#alertsModal').classList.add('open')} function closeAlerts(){$('#alertsModal').classList.remove('open')}
  async function requestNotifications(){if(!('Notification'in window)){toast('Este navegador no admite notificaciones.');return}const p=await Notification.requestPermission();toast(p==='granted'?'Avisos del navegador activados mientras use la app.':'Permiso de notificación no concedido.');}
  function maybeNotify(rows){if(!('Notification'in window)||Notification.permission!=='granted')return;const today=todayISO();rows.forEach(({e,a})=>{const key=`notif:${today}:${e.id}:${a.urgency}`;if(localStorage.getItem(key))return;new Notification(`Agenda Higiene · ${a.urgency}`,{body:`${e.tema||e.tipo} · ${e.hora||''}`});localStorage.setItem(key,'1')});}

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
  btn.textContent = 'Procesando' + '.'.repeat(puntos);
};

actualizarTexto();
const dotsTimer = setInterval(actualizarTexto, 450);
    $('#processing').classList.remove('hidden');
    try{
      let payload={registrador,fuente,eventType:tipo,rawText,fileName:'',mimeType:'',dataUrl:''};
      if(file){payload.fileName=file.name;payload.mimeType=file.type;payload.dataUrl=await fileToDataURL(file);}
      const local=heuristicExtract(rawText,tipo);
      const out=await serverCall('extractDocument',payload);
      const ai=out||{};

      // Con la API activa, la interpretación de la IA tiene prioridad.
      // La heurística local queda solo como respaldo cuando la IA no devuelve
      // un campo y para recuperar enlaces que todavía no forman parte del
      // esquema estructurado del backend.
      const x={
        tipo:ai.tipo||local.tipo||tipo,
        tema:ai.tema||local.tema||'',
        fecha:ai.fecha||local.fecha||'',
        hora:ai.hora||local.hora||'',
        lugar:ai.lugar||local.lugar||'',
        convocados:ai.convocados||local.convocados||'',
        observaciones:ai.observaciones||local.observaciones||'',
        rawText:ai.rawText||rawText||local.rawText||'',
        linkReunion:ai.linkReunion||local.linkReunion||'',
        linkUbicacion:ai.linkUbicacion||local.linkUbicacion||''
      };
      $('#fTipo').value=cleanNonLinkField(x.tipo||tipo);$('#fTema').value=cleanNonLinkField(x.tema||'');$('#fFecha').value=normalizeDate(x.fecha)||'';$('#fHora').value=normalizeTime(x.hora)||'';$('#fLugar').value=cleanNonLinkField(x.lugar||'');$('#fConvocados').value=cleanNonLinkField(x.convocados||'');$('#fObservaciones').value=cleanNonLinkField(x.observaciones||'');$('#fLinkReunion').value=normalizeOptionalUrl(x.linkReunion)||'';$('#fLinkUbicacion').value=normalizeOptionalUrl(x.linkUbicacion)||'';updateGeneratedHeader();$('#generatedForm').classList.remove('hidden');$('#generatedForm').scrollIntoView({behavior:'smooth',block:'start'});
    }catch(e){
      console.error(e);
      const msg=String(e?.message||e||'Error desconocido');
      toast('No se pudo procesar: '+msg.slice(0,220));
      $('#generatedForm').classList.remove('hidden');
      $('#fTipo').value=tipo;
      updateGeneratedHeader();
    }
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

  function getEventLinks(e){
    const storedReunion=normalizeOptionalUrl(e?.linkReunion);
    const storedUbicacion=normalizeOptionalUrl(e?.linkUbicacion);

    if(storedReunion&&storedUbicacion){
      return {reunionUrl:storedReunion,ubicacionUrl:storedUbicacion};
    }

    const extracted=heuristicExtract(e?.rawText||'',e?.tipo||'');

    return {
      reunionUrl:storedReunion||normalizeOptionalUrl(extracted.linkReunion),
      ubicacionUrl:storedUbicacion||normalizeOptionalUrl(extracted.linkUbicacion)
    };
  }

  function formatActionTime(value){
    if(!value)return'';

    const d=new Date(value);
    if(Number.isNaN(d.getTime()))return'';

    return new Intl.DateTimeFormat('es-EC',{
      hour:'2-digit',
      minute:'2-digit',
      hour12:false
    }).format(d);
  }

  function updateGeneratedHeader(){$('#generatedHeader').textContent=`Evento: ${$('#fTema').value||'Sin tema'}`;$('#generatedDate').textContent=fmtDate($('#fFecha').value)}
  async function saveNewEvent(){
    if(!canEdit()){toast('Este perfil no puede crear eventos.');return;}
    if(savingNewEvent)return;

    const registrador=$('#registrador').value==='Otro'?$('#registradorOtro').value.trim():$('#registrador').value;
    const fuente=$('#fuente').value==='Otro'?$('#fuenteOtro').value.trim():$('#fuente').value;
    const assigned=$$('#newEventPeople input:checked').map(x=>x.value);
    const assignmentTime=new Date().toISOString();
    const asignacionesMeta=Object.fromEntries(
      assigned.map(nombre=>[nombre,assignmentTime])
    );

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
      asignacionesMeta,
      estadoAdmin:assigned.length?'ASIGNADO':'',
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
      const saved = await serverCall('saveEventBundle',{event:serializeEventForSave(ev)});

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

function buildEvidenceFileName(eventDate,legend,originalName){
  const date=String(eventDate||todayISO()).trim()||todayISO();

  const cleanLegend=String(legend||'Evidencia')
    .replace(/[\\/:*?"<>|]/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,50);

  const original=String(originalName||'').trim();
  const extMatch=original.match(/(\.[A-Za-z0-9]{1,8})$/);
  const ext=extMatch?extMatch[1].toLowerCase():'';

  return `${date} - ${cleanLegend}${ext}`;
}

function getEvidenceMeta(v){
  const text=String(v?.texto||'').trim();

  let m=text.match(/^\[ASISTENCIA\]\s*(.*)$/i);
  if(m){
    return {
      category:'ASISTENCIA',
      commitmentId:'',
      legend:(m[1]||'').trim()||'Asistencia del funcionario'
    };
  }

  m=text.match(/^\[COMPROMISO:([^\]]+)\]\s*(.*)$/i);
  if(m){
    return {
      category:'COMPROMISO',
      commitmentId:String(m[1]||'').trim(),
      legend:(m[2]||'').trim()||'Evidencia de compromiso'
    };
  }

  return {
    category:'OTRA',
    commitmentId:'',
    legend:text||String(v?.nombre||'Evidencia').trim()||'Evidencia'
  };
}

function hasAttendancePhoto(e){
  return (e?.evidencias||[]).some(v=>{
    const meta=getEvidenceMeta(v);
    return meta.category==='ASISTENCIA' &&
      String(v?.tipo||'').toUpperCase()==='CAPTURA' &&
      !!v?.url;
  });
}

function copyEventLink(text,label){
  const value=String(text||'').trim();
  if(!value)return;

  if(navigator.clipboard&&window.isSecureContext){
    navigator.clipboard.writeText(value)
      .then(()=>toast((label||'Enlace')+' copiado.'))
      .catch(()=>fallbackCopyEventLink(value,label));
    return;
  }

  fallbackCopyEventLink(value,label);
}

function fallbackCopyEventLink(text,label){
  const area=document.createElement('textarea');
  area.value=text;
  area.setAttribute('readonly','');
  area.style.position='fixed';
  area.style.opacity='0';
  document.body.appendChild(area);
  area.select();

  try{
    document.execCommand('copy');
    toast((label||'Enlace')+' copiado.');
  }catch(_){
    toast('No se pudo copiar automáticamente. Seleccione el enlace manualmente.');
  }

  area.remove();
}

function buildEventShareText(e){
  const asignados=(e.asignados||[]).filter(Boolean);
  const {reunionUrl,ubicacionUrl}=getEventLinks(e);

  const lines=[
    `*AGENDA HIGIENE*`,
    ``,
    `*Tema:* ${e.tema||e.tipo||'Evento'}`,
    `*Tipo:* ${e.tipo||'—'}`,
    `*Fecha:* ${fmtDate(e.fecha)}`,
    `*Hora:* ${e.hora||'Sin hora'}`,
    `*Lugar:* ${e.lugar||'—'}`,
    `*Convocados:* ${e.convocados||'—'}`,
    `*Asignado(s):* ${asignados.length ? asignados.join(', ') : 'Sin asignar'}`
  ];

  const visualState=eventVisualState(e);
  if(visualState){
    lines.push(`*Estado:* ${visualState}`);
  }

  if(reunionUrl){
    lines.push(`*Enlace de reunión virtual:* ${reunionUrl}`);
  }

  if(ubicacionUrl){
    lines.push(`*Ubicación:* ${ubicacionUrl}`);
  }

  if(e.observaciones){
    lines.push(`*Observaciones:* ${e.observaciones}`);
  }

  return lines.join('\n');
}

function buildEventShareHtml(e){
  const asignados=(e.asignados||[]).filter(Boolean);
  const {reunionUrl,ubicacionUrl}=getEventLinks(e);
  const rows=[
    ['Tema',e.tema||e.tipo||'Evento'],
    ['Tipo',e.tipo||'—'],
    ['Fecha',fmtDate(e.fecha)],
    ['Hora',e.hora||'Sin hora'],
    ['Lugar',e.lugar||'—'],
    ['Convocados',e.convocados||'—'],
    ['Asignado(s)',asignados.length?asignados.join(', '):'Sin asignar']
  ];

  const visualState=eventVisualState(e);
  if(visualState) rows.push(['Estado',visualState]);
  if(reunionUrl) rows.push(['Enlace de reunión virtual',reunionUrl]);
  if(ubicacionUrl) rows.push(['Ubicación',ubicacionUrl]);
  if(e.observaciones) rows.push(['Observaciones',e.observaciones]);

  return '<div><strong>AGENDA HIGIENE</strong><br><br>'+
    rows.map(([label,value])=>
      '<strong>'+esc(label)+':</strong> '+esc(value)
    ).join('<br>')+
  '</div>';
}

function copyEventSheet(e){
  const text=buildEventShareText(e);
  const html=buildEventShareHtml(e);

  if(navigator.clipboard&&window.isSecureContext){
    if(typeof ClipboardItem!=='undefined'&&navigator.clipboard.write){
      const item=new ClipboardItem({
        'text/plain':new Blob([text],{type:'text/plain'}),
        'text/html':new Blob([html],{type:'text/html'})
      });

      navigator.clipboard.write([item])
        .then(()=>toast('Ficha copiada correctamente.'))
        .catch(()=>navigator.clipboard.writeText(text)
          .then(()=>toast('Ficha copiada correctamente.'))
          .catch(()=>fallbackCopyEventLink(text,'Ficha')));
      return;
    }

    navigator.clipboard.writeText(text)
      .then(()=>toast('Ficha copiada correctamente.'))
      .catch(()=>fallbackCopyEventLink(text,'Ficha'));
    return;
  }

  fallbackCopyEventLink(text,'Ficha');
}

function eventInfoView(e){
  const asignados=(e.asignados||[]).filter(Boolean);
  const asignacionesMeta=e.asignacionesMeta||{};
  const evidencias=(e.evidencias||[]).filter(Boolean);
  const {reunionUrl,ubicacionUrl}=getEventLinks(e);

  function infoItem(label,value){
    return '<div style="border:1px solid var(--line);border-radius:12px;padding:11px 12px;background:#fff">'+
      '<div style="font-size:11px;font-weight:800;color:#6b7f72;text-transform:uppercase;letter-spacing:.35px;margin-bottom:5px">'+esc(label)+'</div>'+
      '<div style="color:var(--text);line-height:1.45">'+esc(value||'—')+'</div>'+
    '</div>';
  }

  function infoItemHtml(label,valueHtml){
    return '<div style="border:1px solid var(--line);border-radius:12px;padding:11px 12px;background:#fff">'+
      '<div style="font-size:11px;font-weight:800;color:#6b7f72;text-transform:uppercase;letter-spacing:.35px;margin-bottom:5px">'+esc(label)+'</div>'+
      '<div style="color:var(--text);line-height:1.55">'+valueHtml+'</div>'+
    '</div>';
  }

  function linkBlock(label,url,openLabel,icon){
    if(!url){
      return '<div class="field" style="margin-top:14px">'+
        '<label>'+esc(label)+'</label>'+
        '<div style="border:1px solid var(--line);border-radius:11px;padding:11px 12px;background:#f7faf8;color:var(--muted)">Sin enlace registrado</div>'+
      '</div>';
    }

    return '<div class="field" style="margin-top:14px">'+
      '<label>'+esc(label)+'</label>'+
      '<input type="text" readonly value="'+esc(url)+'" style="user-select:text">'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
        '<a class="secondary" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px">'+icon+' '+esc(openLabel)+'</a>'+
        '<button class="secondary copy-event-link" type="button" data-copy-link="'+esc(url)+'" data-copy-label="'+esc(label)+'">📋 Copiar enlace</button>'+
      '</div>'+
    '</div>';
  }

  function photoEvidenceLink(v,label){
    const meta=getEvidenceMeta(v);
    return '<div style="border:1px solid var(--line);border-radius:12px;padding:11px 12px;background:#fff;margin-top:8px">'+
      '<div style="font-weight:500;color:var(--text);line-height:1.45;margin-bottom:7px">'+esc(meta.legend||label)+'</div>'+
      '<a class="secondary" href="'+esc(v.url)+'" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;font-weight:700">📷 '+esc(label)+'</a>'+
    '</div>';
  }

  const asignadosHtml=asignados.length
    ? asignados.map(nombre=>{
        const hora=formatActionTime(asignacionesMeta[nombre]);

        return '<div>'+esc(nombre)+
          (hora
            ? ' <span style="color:var(--muted);font-size:12px;font-weight:500">('+esc(hora)+')</span>'
            : '')+
        '</div>';
      }).join('')
    : '<span class="muted">Sin asignar</span>';

  const attendancePhotos=evidencias.filter(v=>{
    const meta=getEvidenceMeta(v);
    return meta.category==='ASISTENCIA' && !!v.url;
  });

  const commitmentPhotos=evidencias.filter(v=>{
    const meta=getEvidenceMeta(v);
    return meta.category==='COMPROMISO' && !!v.url;
  });

  const otherEvidence=evidencias.filter(v=>{
    const meta=getEvidenceMeta(v);
    return meta.category==='OTRA' && !!v.url;
  });

  const commitmentsById=new Map(
    (e.compromisos||[]).map(c=>[String(c.id||''),c])
  );

  const reopenButton=String(e.estadoAdmin||'').toUpperCase()==='CERRADO'&&isAdmin()
    ? '<button class="secondary" id="reopenEventBtn" type="button" title="Reabrir evento" aria-label="Reabrir evento" style="width:40px;height:40px;padding:0;display:grid;place-items:center;font-size:20px">↺</button>'
    : '';

  let html=
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px">'+
      '<button class="secondary" id="copyEventSheetBtn" type="button">📋 Copiar ficha</button>'+
      reopenButton+
    '</div>'+
    '<div class="card">'+
      '<div class="card-title">📋 Información del evento</div>'+
      '<div class="grid grid-2">'+
        infoItem('Tipo',e.tipo)+
        infoItem('Fecha',fmtDate(e.fecha))+
        infoItem('Hora',e.hora||'Sin hora')+
        infoItem('Lugar',e.lugar)+
        infoItem('Convocados',e.convocados)+
        infoItemHtml('Asignado(s)',asignadosHtml)+
      '</div>'+
    '</div>';

  html+='<div class="card" style="margin-top:12px">'+
    '<div class="card-title">📷 Evidencias fotográficas</div>'+
    '<div style="font-size:11px;font-weight:800;color:#6b7f72;text-transform:uppercase;letter-spacing:.35px;margin-top:4px">1. Asistencia del funcionario</div>';

  if(attendancePhotos.length){
    html+=attendancePhotos.map((v,i)=>
      photoEvidenceLink(v,attendancePhotos.length>1?'Ver foto de asistencia '+(i+1):'Ver foto de asistencia')
    ).join('');
  }else{
    const suspended=String(e.estadoAdmin||'').toUpperCase()==='SUSPENDIDO';
    html+='<div class="muted" style="margin-top:6px">'+
      (suspended
        ? 'No requerida para un evento suspendido.'
        : 'No consta fotografía de asistencia clasificada.')+
    '</div>';
  }

  html+='<div style="font-size:11px;font-weight:800;color:#6b7f72;text-transform:uppercase;letter-spacing:.35px;margin-top:16px">2. Evidencias de compromisos cumplidos</div>';

  if(commitmentPhotos.length){
    html+=commitmentPhotos.map(v=>{
      const meta=getEvidenceMeta(v);
      const c=commitmentsById.get(meta.commitmentId);
      const detail=c
        ? (c.compromiso+(c.responsable?' · '+c.responsable:''))
        : meta.legend;

      return '<div style="border:1px solid var(--line);border-radius:12px;padding:11px 12px;background:#fff;margin-top:8px">'+
        '<div style="font-weight:600;color:var(--text);line-height:1.45;margin-bottom:3px">'+esc(detail)+'</div>'+
        (meta.legend&&meta.legend!==detail
          ? '<div class="muted" style="font-size:12px;margin-bottom:7px">'+esc(meta.legend)+'</div>'
          : '')+
        '<a class="secondary" href="'+esc(v.url)+'" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;font-weight:700">📷 Ver evidencia del compromiso</a>'+
      '</div>';
    }).join('');
  }else{
    const hasCommitments=(e.compromisos||[]).some(c=>c&&c.compromiso);
    html+='<div class="muted" style="margin-top:6px">'+
      (hasCommitments
        ? 'No hay evidencias fotográficas de compromisos registradas.'
        : 'No existen compromisos registrados para este evento.')+
    '</div>';
  }

  if(otherEvidence.length){
    html+='<div style="font-size:11px;font-weight:800;color:#6b7f72;text-transform:uppercase;letter-spacing:.35px;margin-top:16px">Otras evidencias</div>'+
      otherEvidence.map(v=>{
        const meta=getEvidenceMeta(v);
        return '<div style="margin-top:8px">'+
          '<a href="'+esc(v.url)+'" target="_blank" rel="noopener noreferrer">'+esc(meta.legend)+'</a>'+
        '</div>';
      }).join('');
  }

  html+='</div>';

  if(e.observaciones){
    html+='<div class="card" style="margin-top:12px">'+
      '<div class="card-title">💬 Observaciones</div>'+
      '<div style="white-space:pre-wrap;line-height:1.55">'+esc(e.observaciones)+'</div>'+
    '</div>';
  }

  html+='<div class="card" style="margin-top:12px">'+
    '<div class="card-title">🔗 Enlaces del evento</div>'+
    linkBlock('Enlace de reunión virtual',reunionUrl,'Abrir reunión','🔗')+
    linkBlock('Enlace de ubicación',ubicacionUrl,'Ver ubicación','📍')+
  '</div>';

  return html;
}
function openEventInfo(id){
  const e=state.events.find(x=>x.id===id);
  if(!e)return;

  state.currentEventId=id;

  $('#drawerTitle').textContent=
    e.tema||e.tipo||'Evento';

  $('#drawerSub').textContent=[
    e.tipo,
    fmtDate(e.fecha),
    e.hora||'Sin hora',
    e.lugar
  ].filter(Boolean).join(' · ');

  $('#drawerAdminState').innerHTML=
    eventStatePill(e);

  $('#drawerBody').innerHTML=
    eventInfoView(e);

  $('#drawer').classList.add('open');
  $('#drawerBackdrop').classList.add('open');

  const copySheetBtn=$('#copyEventSheetBtn');

  if(copySheetBtn){
    copySheetBtn.onclick=event=>{
      event.preventDefault();
      event.stopPropagation();
      copyEventSheet(e);
    };
  }

  const reopenBtn=$('#reopenEventBtn');
  if(reopenBtn){
    reopenBtn.onclick=event=>{
      event.preventDefault();
      event.stopPropagation();
      reopenEvent(e.id,reopenBtn);
    };
  }

  document.querySelectorAll('#drawerBody .copy-event-link').forEach(btn=>{
    btn.onclick=event=>{
      event.preventDefault();
      event.stopPropagation();

      copyEventLink(
        btn.dataset.copyLink,
        btn.dataset.copyLabel||'Enlace'
      );
    };
  });
}

async function reopenEvent(id,btn=null){
  if(!isAdmin()){
    toast('Solo el administrador puede reabrir eventos.');
    return;
  }

  const e=state.events.find(x=>x.id===id);
  if(!e)return;

  if(String(e.estadoAdmin||'').toUpperCase()!=='CERRADO'){
    toast('Este evento no está cerrado.');
    return;
  }

  if(!confirm('¿Reabrir este evento? Volverá al Directorio como EJECUTADO y conservará toda su información.')){
    return;
  }

  const original=btn?btn.innerHTML:'';

  if(btn){
    btn.disabled=true;
    btn.innerHTML='…';
  }

  try{
    const updated=await serverCall('reopenEvent',id);
    updateEventInState(updated);
    generalPage=1;
    renderAll();
    closeDrawer();
    showView('directory');
    toast('Evento reabierto correctamente.');
  }catch(err){
    console.error(err);
    toast('No se pudo reabrir el evento. El backend debe estar actualizado.');
  }finally{
    if(btn&&btn.isConnected){
      btn.disabled=false;
      btn.innerHTML=original;
    }
  }
}

function openEvent(id){
  if(!canEdit()){
    openEventInfo(id);
    return;
  }

  const e = state.events.find(x => x.id === id);
  if (!e) return;

  state.currentEventId = id;

  const readOnly = ['CERRADO','SUSPENDIDO'].includes(String(e.estadoAdmin||'').toUpperCase());

  $('#drawerTitle').textContent =
    e.tema || e.tipo || 'Evento';

  $('#drawerSub').textContent = [
    e.tipo,
    fmtDate(e.fecha),
    e.hora || 'Sin hora',
    e.lugar
  ].filter(Boolean).join(' · ');

  $('#drawerAdminState').innerHTML =
    eventStatePill(e);

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
      const meta=getEvidenceMeta(v);
      const heading=
        meta.category==='ASISTENCIA'
          ? 'Asistencia'
          : (meta.category==='COMPROMISO'?'Compromiso':'Evidencia');

      if(v.url){
        return `<div class="evidence-item">
          <b>${esc(heading)}</b><br>
          <strong>${esc(meta.legend)}</strong><br>
          <a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">Abrir foto / archivo</a>
        </div>`;
      }

      return `<div class="evidence-item">
        <b>${esc(heading)}</b><br>
        ${esc(meta.legend||'Texto registrado')}
      </div>`;
    }).join('');

    const commitmentOptions=(e.compromisos||[])
      .filter(c=>c&&c.compromiso&&String(c.estado||'').toUpperCase()==='EJECUTADO')
      .map(c=>`<option value="${esc(c.id||'')}">${esc(c.compromiso)}${c.responsable?' · '+esc(c.responsable):''}</option>`)
      .join('');

    const finalState=String(e.estadoAdmin||'').toUpperCase();
    const closedNote=ro
      ? `<div class="card" style="margin-top:12px"><b>${finalState==='SUSPENDIDO'?'⏸ Evento suspendido':'✓ Evento cerrado'}</b><div class="muted">Registro histórico de solo lectura.</div></div>`
      : '';
    const {reunionUrl,ubicacionUrl}=getEventLinks(e);
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
            <div class="field"><label>Enlace de reunión virtual · opcional</label><input id="editLinkReunion" type="url" inputmode="url" placeholder="Pegue aquí el enlace de Meet, Zoom, Teams, etc." value="${esc(reunionUrl||'')}"></div>
            <div class="field"><label>Enlace de ubicación · opcional</label><input id="editLinkUbicacion" type="url" inputmode="url" placeholder="Pegue aquí el enlace de Google Maps o Waze" value="${esc(ubicacionUrl||'')}"></div>
          </div>
          <div class="field"><label>Asignado(s)</label><div class="people-grid">${assignments}</div></div>
        </div>
        <div class="card" style="margin-top:12px">
          <div class="card-title">🎯 Compromisos y asignaciones operativas <button class="secondary" style="margin-left:auto" id="addCommitment">＋ Añadir compromiso</button></div>
          <div id="commitments">${comps||'<div class="empty" id="noCommitments">Sin compromisos registrados.</div>'}</div>
        </div>
        <div class="card" style="margin-top:12px">
          <div class="card-title">📷 Evidencias fotográficas</div>
          <div class="topnote">La fotografía de asistencia del funcionario es obligatoria para poder cerrar el evento.</div>

          <div class="grid grid-2">
            <div>
              <b>1. Asistencia del funcionario · obligatoria</b>

              <div class="field">
                <label>Leyenda · máx. 50 caracteres</label>
                <input id="attendanceEvidenceLegend" type="text" maxlength="50" placeholder="Ej.: Asistencia a reunión">
                <div class="hint" id="attendanceEvidenceLegendCount">0 / 50</div>
              </div>

              <div class="field">
                <label>Fotografía</label>
                <input id="attendanceEvidenceFile" type="file" accept="image/*">
              </div>

              <button class="secondary wide" id="addAttendanceEvidence" type="button">Subir foto de asistencia</button>
            </div>

            <div>
              <b>2. Compromiso cumplido · si aplica</b>

              <div class="field">
                <label>Compromiso ejecutado</label>
                <select id="commitmentEvidenceSelect" ${commitmentOptions?'':'disabled'}>
                  <option value="">Seleccione...</option>
                  ${commitmentOptions}
                </select>
                ${commitmentOptions?'':'<div class="hint">Marque el compromiso como EJECUTADO y guarde los cambios antes de cargar su foto.</div>'}
              </div>

              <div class="field">
                <label>Leyenda · máx. 50 caracteres</label>
                <input id="commitmentEvidenceLegend" type="text" maxlength="50" placeholder="Ej.: Compromiso cumplido">
                <div class="hint" id="commitmentEvidenceLegendCount">0 / 50</div>
              </div>

              <div class="field">
                <label>Fotografía</label>
                <input id="commitmentEvidenceFile" type="file" accept="image/*">
              </div>

              <button class="secondary wide" id="addCommitmentEvidence" type="button" ${commitmentOptions?'':'disabled'}>Subir foto del compromiso</button>
            </div>
          </div>

          <div class="card-title" style="margin-top:16px">Evidencias registradas</div>
          <div id="evidenceList" class="evidence-grid">${evid||'<div class="muted">Aún no hay evidencias.</div>'}</div>

          <div style="margin-top:16px;border-top:1px solid var(--line);padding-top:12px">
            <b>Constancia textual adicional</b>
            <div class="field">
              <textarea id="evidenceText" placeholder="Escriba aquí una constancia manual adicional..."></textarea>
            </div>
            <button class="secondary" id="addTextEvidence" type="button">Añadir texto como evidencia</button>
          </div>
        </div>
        <div class="card" style="margin-top:12px"><div class="card-title">💬 Observaciones</div><div class="field"><textarea id="editObs">${esc(e.observaciones||'')}</textarea></div></div>
        ${!ro ? `
<div class="event-actions-grid">
  ${e.estadoAdmin !== 'EJECUTADO' ? `
    <button class="event-action-btn" id="suspendEventBtn" type="button">
      <span>EVENTO</span>
      <strong>SUSPENDIDO</strong>
    </button>

    <button class="event-action-btn" id="markEventExecuted" type="button">
      <span>MARCAR</span>
      <strong>EJECUTADO</strong>
    </button>
  ` : `
    <button class="event-action-btn" type="button" disabled>
      <span>EVENTO</span>
      <strong>EJECUTADO</strong>
    </button>

    <button class="event-action-btn" type="button" disabled>
      <span>ESTADO</span>
      <strong>CONFIRMADO</strong>
    </button>
  `}

  <button class="event-action-btn event-action-primary" id="saveEventChanges" type="button">
    <span>GUARDAR</span>
    <strong>CAMBIOS</strong>
  </button>

  <button class="event-action-btn event-action-success" id="closeEventBtn" type="button">
    <span>CERRAR</span>
    <strong>EVENTO</strong>
  </button>
</div>
` : ''}
      </div>
      ${closedNote}`;
  }
  function commitRow(c={}){
    const currentState=String(c.estado||'').toUpperCase()==='EJECUTADO'?'EJECUTADO':'ASIGNADO';

    return `<div class="commit-row" data-id="${esc(c.id||uid('CMP'))}">
      <input class="c-text" placeholder="Compromiso" value="${esc(c.compromiso||'')}">
      <select class="c-resp">
        <option value="">Seleccione responsable...</option>
        ${state.assignables.map(n=>`<option value="${esc(n)}" ${c.responsable===n?'selected':''}>${esc(n)}</option>`).join('')}
      </select>
      <select class="c-state">
        <option value="ASIGNADO" ${currentState==='ASIGNADO'?'selected':''}>ASIGNADO</option>
        <option value="EJECUTADO" ${currentState==='EJECUTADO'?'selected':''}>EJECUTADO</option>
      </select>
      <button class="secondary copy-commitment-btn" type="button" title="Copiar compromiso para WhatsApp" aria-label="Copiar compromiso">📋</button>
      <button class="remove-btn" title="Eliminar compromiso">🗑</button>
    </div>`;
  }
function getCommitmentShareData(e,row){
  const compromiso=(row?.querySelector('.c-text')?.value||'').trim();
  const responsable=(row?.querySelector('.c-resp')?.value||'').trim();
  const estado=(row?.querySelector('.c-state')?.value||'ASIGNADO').trim().toUpperCase();

  const observacionesEl=$('#editObservaciones');
  const observaciones=observacionesEl
    ? observacionesEl.value.trim()
    : String(e?.observaciones||'').trim();

  const {ubicacionUrl}=getEventLinks(e||{});

  return {
    compromiso,
    responsable,
    estado,
    observaciones,
    ubicacionUrl,
    tema:e?.tema||e?.tipo||'Evento',
    tipo:e?.tipo||'—',
    fecha:fmtDate(e?.fecha),
    hora:e?.hora||'Sin hora',
    lugar:e?.lugar||'—'
  };
}

function buildCommitmentShareText(e,row){
  const d=getCommitmentShareData(e,row);

  const lines=[
    '*AGENDA HIGIENE · COMPROMISO*',
    '',
    '*Evento:* '+d.tema,
    '*Tipo:* '+d.tipo,
    '*Fecha:* '+d.fecha,
    '*Hora:* '+d.hora,
    '*Lugar:* '+d.lugar
  ];

  if(d.observaciones){
    lines.push('*Contexto general:* '+d.observaciones);
  }

  lines.push(
    '',
    '*Compromiso adquirido:* '+(d.compromiso||'—'),
    '*Responsable asignado:* '+(d.responsable||'Sin asignar'),
    '*Estado:* '+d.estado
  );

  if(d.ubicacionUrl){
    lines.push('*Ubicación:* '+d.ubicacionUrl);
  }

  lines.push(
    '',
    'Con base en el evento señalado, queda asignado el compromiso indicado para su cumplimiento y seguimiento.'
  );

  return lines.join('\n');
}

function buildCommitmentShareHtml(e,row){
  const d=getCommitmentShareData(e,row);
  const rows=[
    ['Evento',d.tema],
    ['Tipo',d.tipo],
    ['Fecha',d.fecha],
    ['Hora',d.hora],
    ['Lugar',d.lugar]
  ];

  if(d.observaciones) rows.push(['Contexto general',d.observaciones]);

  rows.push(
    ['Compromiso adquirido',d.compromiso||'—'],
    ['Responsable asignado',d.responsable||'Sin asignar'],
    ['Estado',d.estado]
  );

  if(d.ubicacionUrl) rows.push(['Ubicación',d.ubicacionUrl]);

  return '<div><strong>AGENDA HIGIENE · COMPROMISO</strong><br><br>'+
    rows.map(([label,value])=>
      '<strong>'+esc(label)+':</strong> '+esc(value)
    ).join('<br>')+
    '<br><br>Con base en el evento señalado, queda asignado el compromiso indicado para su cumplimiento y seguimiento.</div>';
}

function copyCommitmentContext(e,row){
  const data=getCommitmentShareData(e,row);

  if(!data.compromiso){
    toast('Escriba el compromiso antes de copiarlo.');
    return;
  }

  if(!data.responsable){
    toast('Seleccione un responsable antes de copiar el compromiso.');
    return;
  }

  const text=buildCommitmentShareText(e,row);
  const html=buildCommitmentShareHtml(e,row);

  if(navigator.clipboard&&window.isSecureContext){
    if(typeof ClipboardItem!=='undefined'&&navigator.clipboard.write){
      const item=new ClipboardItem({
        'text/plain':new Blob([text],{type:'text/plain'}),
        'text/html':new Blob([html],{type:'text/html'})
      });

      navigator.clipboard.write([item])
        .then(()=>toast('Compromiso copiado para WhatsApp.'))
        .catch(()=>navigator.clipboard.writeText(text)
          .then(()=>toast('Compromiso copiado para WhatsApp.'))
          .catch(()=>fallbackCopyEventLink(text,'Compromiso')));
      return;
    }

    navigator.clipboard.writeText(text)
      .then(()=>toast('Compromiso copiado para WhatsApp.'))
      .catch(()=>fallbackCopyEventLink(text,'Compromiso'));
    return;
  }

  fallbackCopyEventLink(text,'Compromiso');
}

function bindCommitmentActions(e){
  document.querySelectorAll('#commitments .copy-commitment-btn').forEach(btn=>{
    btn.onclick=event=>{
      event.preventDefault();
      event.stopPropagation();
      const row=btn.closest('.commit-row');
      if(row)copyCommitmentContext(e,row);
    };
  });

  document.querySelectorAll('#commitments .remove-btn').forEach(btn=>{
    btn.onclick=()=>btn.closest('.commit-row')?.remove();
  });
}

function bindEventEditor(e, ro){
  if (ro) return;

  const addCommitmentBtn = $('#addCommitment');

  if (addCommitmentBtn) {
    addCommitmentBtn.onclick = () => {
      const n = $('#noCommitments');

      if (n) n.remove();

      $('#commitments').insertAdjacentHTML(
        'beforeend',
        commitRow({estado:'ASIGNADO'})
      );

      bindCommitmentActions(e);
    };
  }

  bindCommitmentActions(e);

  const addTextEvidenceBtn = $('#addTextEvidence');
  if (addTextEvidenceBtn) {
    addTextEvidenceBtn.onclick = () => addEvidence('TEXTO');
  }

  function bindLegendCounter(inputId,countId){
    const input=$(inputId);
    const count=$(countId);

    if(!input||!count)return;

    const update=()=>{
      count.textContent=`${input.value.length} / 50`;
    };

    input.oninput=update;
    update();
  }

  bindLegendCounter('#attendanceEvidenceLegend','#attendanceEvidenceLegendCount');
  bindLegendCounter('#commitmentEvidenceLegend','#commitmentEvidenceLegendCount');

  const attendanceBtn=$('#addAttendanceEvidence');
  if(attendanceBtn){
    attendanceBtn.onclick=()=>addEvidence('ASISTENCIA');
  }

  const commitmentBtn=$('#addCommitmentEvidence');
  if(commitmentBtn){
    commitmentBtn.onclick=()=>addEvidence('COMPROMISO');
  }

  const saveBtn = $('#saveEventChanges');
  if (saveBtn) {
    saveBtn.onclick = () => saveEventChanges('',saveBtn);
  }

  const suspendBtn = $('#suspendEventBtn');
  if (suspendBtn) {
    suspendBtn.onclick = () => setAdminState('SUSPENDIDO',suspendBtn);
  }

  const executedBtn = $('#markEventExecuted');
  if (executedBtn) {
    executedBtn.onclick = () => setAdminState('EJECUTADO',executedBtn);
  }

  const closeBtn = $('#closeEventBtn');
  if (closeBtn) {
    closeBtn.onclick = () => setAdminState('CERRADO',closeBtn);
  }
}
  function bindRemoveCommitments(){document.querySelectorAll('#commitments .remove-btn').forEach(b=>b.onclick=()=>b.closest('.commit-row')?.remove())}
  function collectCommitments(){
    const rows=$$('#commitments .commit-row');
    const commitments=[];

    for(const r of rows){
      const compromiso=r.querySelector('.c-text').value.trim();
      const responsable=r.querySelector('.c-resp').value;

      if(!compromiso) continue;

      if(!responsable){
        toast('Todo compromiso debe tener un responsable.');
        r.querySelector('.c-resp').focus();
        return null;
      }

      commitments.push({
        id:r.dataset.id||uid('CMP'),
        eventId:state.currentEventId,
        compromiso,
        responsable,
        estado:r.querySelector('.c-state').value==='EJECUTADO'?'EJECUTADO':'ASIGNADO',
        updatedAt:new Date().toISOString()
      });
    }

    return commitments;
  }
  async function addEvidence(kind) {
  const e=state.events.find(x=>x.id===state.currentEventId);
  if(!e)return;

  if(kind!=='TEXTO'&&uploadingEvidence)return;

  let payload={
    eventId:e.id,
    tipo:kind,
    nombre:'',
    texto:'',
    dataUrl:'',
    mimeType:''
  };

  let btn=null;
  let contenidoOriginal='';
  let dotsTimer=null;

  try{
    if(kind==='TEXTO'){
      payload.texto=$('#evidenceText').value.trim();
      payload.nombre='Nota manual';

      if(!payload.texto){
        toast('Escriba el texto de la evidencia.');
        return;
      }
    }else{
      const isAttendance=kind==='ASISTENCIA';
      const legendInput=isAttendance
        ? $('#attendanceEvidenceLegend')
        : $('#commitmentEvidenceLegend');
      const fileInput=isAttendance
        ? $('#attendanceEvidenceFile')
        : $('#commitmentEvidenceFile');

      btn=isAttendance
        ? $('#addAttendanceEvidence')
        : $('#addCommitmentEvidence');

      const legend=(legendInput?.value||'').trim();

      if(!legend){
        toast('Escriba una leyenda para la fotografía.');
        return;
      }

      if(legend.length>50){
        toast('La leyenda no puede superar 50 caracteres.');
        return;
      }

      let commitmentId='';

      if(!isAttendance){
        commitmentId=$('#commitmentEvidenceSelect')?.value||'';

        if(!commitmentId){
          toast('Seleccione el compromiso ejecutado.');
          return;
        }

        const commitment=(e.compromisos||[]).find(c=>String(c.id||'')===String(commitmentId));

        if(!commitment||String(commitment.estado||'').toUpperCase()!=='EJECUTADO'){
          toast('El compromiso debe estar marcado como EJECUTADO.');
          return;
        }
      }

      const file=fileInput?.files?.[0];

      if(!file){
        toast('Seleccione una fotografía.');
        return;
      }

      if(!String(file.type||'').startsWith('image/')){
        toast('La evidencia debe ser una fotografía.');
        return;
      }

      if(file.size>MAX_UPLOAD_MB*1024*1024){
        toast(`El archivo supera ${MAX_UPLOAD_MB} MB.`);
        return;
      }

      uploadingEvidence=true;
      contenidoOriginal=btn?btn.innerHTML:'';

      if(btn){
        btn.disabled=true;

        let puntos=0;
        const actualizarTexto=()=>{
          puntos=(puntos%3)+1;
          btn.textContent='Subiendo'+'.'.repeat(puntos);
        };

        actualizarTexto();
        dotsTimer=setInterval(actualizarTexto,450);
      }

      const marker=isAttendance
        ? '[ASISTENCIA]'
        : `[COMPROMISO:${commitmentId}]`;

      payload.texto=`${marker} ${legend}`;
      payload.nombre=buildEvidenceFileName(
        e.fecha,
        `${isAttendance?'ASISTENCIA':'COMPROMISO'} - ${legend}`,
        file.name
      );
      payload.mimeType=file.type;
      payload.dataUrl=await fileToDataURL(file);
      payload.tipo='CAPTURA';

      // Campos auxiliares para una futura ampliación del backend.
      payload.categoria=isAttendance?'ASISTENCIA':'COMPROMISO';
      payload.compromisoId=commitmentId;
    }

    const ev=await serverCall('uploadEvidence',payload);
    const savedEvidence={...(ev||{})};

    // Garantiza la clasificación en la sesión actual aun si el backend
    // devuelve solamente los campos básicos de EVIDENCIAS.
    if(!savedEvidence.texto)savedEvidence.texto=payload.texto;
    if(!savedEvidence.nombre)savedEvidence.nombre=payload.nombre;
    if(!savedEvidence.tipo)savedEvidence.tipo=payload.tipo;
    if(!savedEvidence.eventId)savedEvidence.eventId=e.id;

    e.evidencias=e.evidencias||[];
    e.evidencias.push(savedEvidence);

    if(LOCAL_MODE){
      persistLocal();
    }

    openEvent(e.id);
    toast(kind==='ASISTENCIA'
      ? 'Foto de asistencia añadida correctamente.'
      : (kind==='COMPROMISO'
        ? 'Evidencia del compromiso añadida correctamente.'
        : 'Evidencia añadida correctamente.'));

  }catch(err){
    console.error(err);
    toast('No se pudo subir la evidencia.');

  }finally{
    if(dotsTimer)clearInterval(dotsTimer);

    if(kind!=='TEXTO'){
      uploadingEvidence=false;

      if(btn&&btn.isConnected){
        btn.disabled=false;
        btn.innerHTML=contenidoOriginal;
      }
    }
  }
}
async function saveEventChanges(targetState='',actionBtn=null){
  if(!canEdit()){toast('Este perfil no puede modificar eventos.');return false;}
  if (savingEventChanges) return false;

  const e = state.events.find(x => x.id === state.currentEventId);
  if (!e) return false;

  const rawLinkReunion=$('#editLinkReunion').value.trim();
  const rawLinkUbicacion=$('#editLinkUbicacion').value.trim();
  const linkReunion=normalizeOptionalUrl(rawLinkReunion);
  const linkUbicacion=normalizeOptionalUrl(rawLinkUbicacion);

  if(rawLinkReunion&&!linkReunion){
    toast('El enlace de reunión virtual no es válido.');
    return false;
  }
  if(rawLinkUbicacion&&!linkUbicacion){
    toast('El enlace de ubicación no es válido.');
    return false;
  }

  e.tipo = $('#editTipo').value.trim();
  e.tema = $('#editTema').value.trim();
  e.fecha = $('#editFecha').value;
  e.hora = $('#editHora').value;
  e.lugar = $('#editLugar').value.trim();
  e.convocados = $('#editConvocados').value.trim();
  e.linkReunion = linkReunion;
  e.linkUbicacion = linkUbicacion;

  const previousAssigned=new Set(e.asignados||[]);
  const newAssigned=$$('.edit-assignee:checked').map(x=>x.value);
  const asignacionesMeta={...(e.asignacionesMeta||{})};
  const assignmentTime=new Date().toISOString();

  newAssigned.forEach(nombre=>{
    if(!previousAssigned.has(nombre)){
      asignacionesMeta[nombre]=assignmentTime;
    }
  });

  Object.keys(asignacionesMeta).forEach(nombre=>{
    if(!newAssigned.includes(nombre)){
      delete asignacionesMeta[nombre];
    }
  });

  e.asignados = newAssigned;
  e.asignacionesMeta = asignacionesMeta;

  const compromisos=collectCommitments();
  if(compromisos===null) return false;

  e.compromisos = compromisos;
  e.observaciones = $('#editObs').value.trim();

  if (targetState) {
    e.estadoAdmin = targetState;
  } else if (!['EJECUTADO','CERRADO','SUSPENDIDO'].includes(String(e.estadoAdmin||'').toUpperCase())) {
    e.estadoAdmin = e.asignados.length ? 'ASIGNADO' : '';
  }

  e.updatedAt = new Date().toISOString();

  const btn = actionBtn || $('#saveEventChanges');
  const contenidoOriginal = btn ? btn.innerHTML : '';

  savingEventChanges = true;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>PROCESANDO</span><strong>GUARDANDO...</strong>';
  }

  try {
    const saved = await serverCall('saveEventBundle', {event: serializeEventForSave(e)});

const updated = updateEventInState(saved || e);
renderAll();

openEvent(updated.id);
toast('Cambios guardados correctamente.');
return true;

  } catch (err) {
    console.error(err);
    toast('No se pudieron guardar los cambios.');
    return false;

  } finally {
    savingEventChanges = false;

    if (btn && btn.isConnected) {
      btn.disabled = false;
      btn.innerHTML = contenidoOriginal;
    }
  }
}  async function setAdminState(s,actionBtn=null){
  const e=state.events.find(x=>x.id===state.currentEventId);
  if(!e)return;

  if(s==='CERRADO'&&!hasAttendancePhoto(e)){
    toast('No se puede cerrar el evento sin una fotografía de asistencia del funcionario.');
    return;
  }

  if(s==='SUSPENDIDO'&&!confirm('¿Marcar este evento como SUSPENDIDO? Dejará de generar alertas y pasará al Panel general.')){
    return;
  }

  if(s==='CERRADO'&&!confirm('¿Cerrar este evento? Pasará al Panel general y quedará en solo lectura.')){
    return;
  }

  const saved=await saveEventChanges(s,actionBtn);
  if(!saved)return;

  if(s==='CERRADO'||s==='SUSPENDIDO'){
    generalPage=1;
    renderGeneral();
    closeDrawer();
    showView('general');
  }
}

  function demoEvents(){const t=todayISO();return [
    {id:uid('EVT'),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),registrador:'Romeo Mendoza',fuente:'WhatsApp',tipo:'Reunión',tema:'Reunión con comunidad',fecha:t,hora:addHoursTime(0.7),lugar:'Manta',convocados:'Direcciones municipales',asignados:[],estadoAdmin:'',observaciones:'',compromisos:[],evidencias:[]},
    {id:uid('EVT'),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),registrador:'Romeo Mendoza',fuente:'Correo',tipo:'Avanzada',tema:'Levantamiento de información',fecha:t,hora:addHoursTime(2.3),lugar:'Tarqui',convocados:'Higiene',asignados:['William Pruss'],estadoAdmin:'ASIGNADO',observaciones:'',compromisos:[],evidencias:[]},
    {id:uid('EVT'),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),registrador:'Romeo Mendoza',fuente:'Gestor',tipo:'Capacitación',tema:'Manejo de residuos',fecha:t,hora:addHoursTime(0.8),lugar:'Municipio',convocados:'Personal operativo',asignados:['Gabriel García'],estadoAdmin:'ASIGNADO',observaciones:'',compromisos:[],evidencias:[]}
  ].map(normalizeEvent)}
  function addHoursTime(h){const d=new Date(Date.now()+h*36e5);return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false}).format(d)}

  window.addEventListener('load',init);
})();
