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

  const fmtDate = iso => {
    if(!iso) return '—';
    const m=String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };

  const formatLongDate = iso => {
    const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) return iso||'—';
    const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));
    const txt=new Intl.DateTimeFormat('es-EC',{
      weekday:'long',
      day:'numeric',
      month:'long',
      year:'numeric'
    }).format(d);
    return txt.charAt(0).toUpperCase()+txt.slice(1);
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
    if(h<0||h>23||min<0||min>59) return raw;

    return String(h).padStart(2,'0')+':'+String(min).padStart(2,'0');
  };

  const shiftDate = (iso,days) => {
    const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) return isoToday();
    const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));
    d.setDate(d.getDate()+days);
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  };

  const serverCall = (fn,...args) => window.AgendaApi.call(fn,...args);

  let events=[];
  let assignables=[];
  let selectedDate=isoToday();
  let extracted=[];
  let loadedOnce=false;
  let pastedSourceFile=null;
  let editingEventId='';

  function showView(view){
    ['daily','history','load'].forEach(name=>{
      q('#alcaldia-view-'+name)?.classList.toggle('hidden',name!==view);
    });

    qa('#alcaldiaSubnav [data-alcaldia-view]').forEach(btn=>{
      btn.classList.toggle('active',btn.dataset.alcaldiaView===view);
    });

    if(view==='daily') renderDaily();
    if(view==='history') renderHistory();
  }

  function timeRange(e){
    const start=normalizeTime(e.horaInicio);
    const end=normalizeTime(e.horaFin);
    if(start&&end) return start+' – '+end;
    return start||end||'Sin hora';
  }

  function responsibleOptions(selected=''){
    const values=[...new Set(assignables.filter(Boolean))];
    return '<option value="">Sin asignar</option>'+
      values.map(name=>`<option value="${esc(name)}"${name===selected?' selected':''}>${esc(name)}</option>`).join('');
  }

  function dailyRows(){
    return events
      .filter(e=>String(e.fecha||'')===selectedDate)
      .sort((a,b)=>String(a.horaInicio||'').localeCompare(String(b.horaInicio||'')));
  }

  function renderDaily(){
    const title=q('#alcaldiaDateTitle');
    const picker=q('#alcaldiaDatePicker');
    const count=q('#alcaldiaDailyCount');
    const board=q('#alcaldiaBoard');
    if(!title||!board) return;

    title.textContent=formatLongDate(selectedDate);
    if(picker) picker.value=selectedDate;

    const rows=dailyRows();
    if(count) count.textContent=rows.length
      ? rows.length+' '+(rows.length===1?'actividad registrada':'actividades registradas')
      : 'Sin actividades registradas para esta fecha.';

    board.innerHTML=rows.length ? rows.map(e=>{
      const estado=String(e.estado||'ACTIVO').toUpperCase();
      const suspended=estado==='SUSPENDIDO';

      return `
        <article class="alcaldia-card${suspended?' suspended':''}" data-alcaldia-id="${esc(e.id)}">
          <div class="alcaldia-time">
            <strong>${esc(timeRange(e))}</strong>
            ${e.llegadaAlcaldesa?`<small>Llegada Alcaldesa: ${esc(normalizeTime(e.llegadaAlcaldesa))}</small>`:''}
            <span class="alcaldia-status" style="margin-top:9px">${esc(estado)}</span>
          </div>

          <div class="alcaldia-main">
            <strong>${esc(e.nombreEvento||'Actividad sin nombre')}</strong>
            <div class="alcaldia-place">
              ${e.lugar?`📍 ${esc(e.lugar)}`:''}
              ${e.ubicacionUrl?`<div style="margin-top:5px"><a href="${esc(e.ubicacionUrl)}" target="_blank" rel="noopener">Abrir ubicación ↗</a></div>`:''}
            </div>
            ${e.observaciones?`<div class="muted" style="margin-top:8px">${esc(e.observaciones)}</div>`:''}
          </div>

          <div class="alcaldia-control">
            <div>
              <label>Responsable DHS</label>
              <select data-alcaldia-responsable="${esc(e.id)}">
                ${responsibleOptions(String(e.responsable||''))}
              </select>
            </div>
            <label class="alcaldia-check" style="text-transform:none;letter-spacing:0;font-size:13px">
              <input type="checkbox" data-alcaldia-asistio="${esc(e.id)}" ${e.asistio?'checked':''}>
              Asistió
            </label>

            <div class="alcaldia-actions">
              <button class="secondary" type="button" data-alcaldia-edit="${esc(e.id)}">✏️ Editar</button>
              <button class="danger" type="button" data-alcaldia-delete="${esc(e.id)}">🗑️ Borrar</button>
            </div>
          </div>
        </article>`;
    }).join('') : '<div class="empty">No hay actividades de Alcaldía registradas para este día.</div>';

    board.querySelectorAll('[data-alcaldia-responsable]').forEach(sel=>{
      sel.onchange=()=>updateTracking(sel.dataset.alcaldiaResponsable,{responsable:sel.value});
    });

    board.querySelectorAll('[data-alcaldia-asistio]').forEach(chk=>{
      chk.onchange=()=>updateTracking(chk.dataset.alcaldiaAsistio,{asistio:chk.checked});
    });

    board.querySelectorAll('[data-alcaldia-edit]').forEach(btn=>{
      btn.onclick=()=>openEditModal(btn.dataset.alcaldiaEdit);
    });

    board.querySelectorAll('[data-alcaldia-delete]').forEach(btn=>{
      btn.onclick=()=>deleteAlcaldiaEventFromUi(btn.dataset.alcaldiaDelete,btn);
    });
  }

  function renderHistory(){
    const el=q('#alcaldiaHistory');
    if(!el) return;

    const term=String(q('#alcaldiaSearch')?.value||'').toLowerCase().trim();

    const rows=events
      .filter(e=>!term || [e.nombreEvento,e.lugar,e.responsable,e.fecha,e.estado]
        .some(v=>String(v||'').toLowerCase().includes(term)))
      .sort((a,b)=>{
        const av=String(a.fecha||'')+' '+String(a.horaInicio||'');
        const bv=String(b.fecha||'')+' '+String(b.horaInicio||'');
        return bv.localeCompare(av);
      });

    el.innerHTML=rows.length ? rows.map(e=>`
      <button type="button" class="tasa-record-card" data-history-date="${esc(e.fecha||'')}" style="width:100%;text-align:left">
        <div>
          <strong>${esc(e.nombreEvento||'Actividad sin nombre')}</strong>
          <div class="event-meta">
            <span>📅 ${esc(fmtDate(e.fecha))}</span>
            <span>🕐 ${esc(timeRange(e))}</span>
            ${e.lugar?`<span>📍 ${esc(e.lugar)}</span>`:''}
            ${e.responsable?`<span>👤 ${esc(e.responsable)}</span>`:''}
          </div>
        </div>
        <span>›</span>
      </button>
    `).join('') : '<div class="empty">Aún no existen actividades en el histórico.</div>';

    el.querySelectorAll('[data-history-date]').forEach(btn=>{
      btn.onclick=()=>{
        selectedDate=btn.dataset.historyDate||selectedDate;
        showView('daily');
      };
    });
  }

  function activityEditor(e={},index=0){
    return `
      <div class="alcaldia-edit-card" data-preview-index="${index}">
        <div class="alcaldia-edit-card-head">
          <strong>Actividad ${index+1}</strong>
          <button class="danger" type="button" data-remove-preview="${index}" title="Quitar actividad">🗑</button>
        </div>

        <div class="alcaldia-edit-grid">
          <div class="field"><label>Hora inicio</label><input data-a-field="horaInicio" value="${esc(normalizeTime(e.horaInicio||''))}" placeholder="HH:MM"></div>
          <div class="field"><label>Hora fin</label><input data-a-field="horaFin" value="${esc(normalizeTime(e.horaFin||''))}" placeholder="HH:MM"></div>
          <div class="field"><label>Llegada Alcaldesa</label><input data-a-field="llegadaAlcaldesa" value="${esc(normalizeTime(e.llegadaAlcaldesa||''))}" placeholder="HH:MM"></div>
          <div class="field"><label>Estado</label><select data-a-field="estado"><option${String(e.estado||'ACTIVO')==='ACTIVO'?' selected':''}>ACTIVO</option><option${String(e.estado||'')==='SUSPENDIDO'?' selected':''}>SUSPENDIDO</option><option${String(e.estado||'')==='REPROGRAMADO'?' selected':''}>REPROGRAMADO</option></select></div>
          <div class="field wide"><label>Actividad / evento</label><input data-a-field="nombreEvento" value="${esc(e.nombreEvento||'')}"></div>
          <div class="field wide"><label>Lugar</label><input data-a-field="lugar" value="${esc(e.lugar||'')}"></div>
          <div class="field wide"><label>Enlace de ubicación</label><input data-a-field="ubicacionUrl" value="${esc(e.ubicacionUrl||'')}" placeholder="https://maps..."></div>
          <div class="field wide"><label>Observaciones</label><textarea data-a-field="observaciones" rows="2">${esc(e.observaciones||'')}</textarea></div>
        </div>
      </div>`;
  }

  function renderPreview(){
    const el=q('#alcaldiaPreview');
    if(!el) return;

    el.innerHTML=extracted.length
      ? extracted.map(activityEditor).join('')
      : '<div class="empty">Aún no se ha procesado ninguna agenda.</div>';

    el.querySelectorAll('[data-remove-preview]').forEach(btn=>{
      btn.onclick=()=>{
        extracted.splice(Number(btn.dataset.removePreview),1);
        renderPreview();
      };
    });
  }

  function collectPreview(){
    const agendaDate=String(q('#alcaldiaAgendaDate')?.value||'').trim();

    return qa('#alcaldiaPreview [data-preview-index]').map(card=>{
      const get=name=>card.querySelector(`[data-a-field="${name}"]`)?.value.trim()||'';
      const index=Number(card.dataset.previewIndex);
      const detectedDate=String(extracted[index]?.fecha||'').trim();

      return {
        fecha:agendaDate||detectedDate,
        horaInicio:normalizeTime(get('horaInicio')),
        horaFin:normalizeTime(get('horaFin')),
        llegadaAlcaldesa:normalizeTime(get('llegadaAlcaldesa')),
        nombreEvento:get('nombreEvento'),
        lugar:get('lugar'),
        ubicacionUrl:get('ubicacionUrl'),
        observaciones:get('observaciones'),
        estado:get('estado')||'ACTIVO'
      };
    }).filter(e=>e.nombreEvento||e.horaInicio||e.lugar);
  }

  function clearLoad(){
    extracted=[];
    renderPreview();

    const file=q('#alcaldiaSourceFile');
    if(file) file.value='';
    pastedSourceFile=null;

    if(q('#alcaldiaFileName')) q('#alcaldiaFileName').textContent='Sin captura seleccionada';

    const pasteZone=q('#alcaldiaPasteZone');
    if(pasteZone){
      pasteZone.classList.remove('has-image');
      pasteZone.innerHTML='';
    }

    if(q('#alcaldiaRawText')) q('#alcaldiaRawText').value='';
    if(q('#alcaldiaAgendaDate')) q('#alcaldiaAgendaDate').value='';
    if(q('#alcaldiaProcessState')) q('#alcaldiaProcessState').textContent='';
  }

  function fileToDataURL(file){
    return new Promise((resolve,reject)=>{
      const fr=new FileReader();
      fr.onload=()=>resolve(fr.result);
      fr.onerror=()=>reject(fr.error||new Error('No se pudo leer el archivo.'));
      fr.readAsDataURL(file);
    });
  }

  async function processAgenda(){
    const file=pastedSourceFile || q('#alcaldiaSourceFile')?.files?.[0];
    const rawText=String(q('#alcaldiaRawText')?.value||'').trim();
    const st=q('#alcaldiaProcessState');

    if(!file&&!rawText){
      if(st) st.textContent='Seleccione una captura o pegue el texto de la agenda.';
      return;
    }

    const btn=q('#alcaldiaProcess');
    const original=btn?.textContent||'Procesar agenda con IA';
    let timer=null;

    if(btn){
      btn.disabled=true;
      let dots=0;
      const tick=()=>{
        dots=(dots%3)+1;
        btn.textContent='Procesando'+'.'.repeat(dots);
      };
      tick();
      timer=setInterval(tick,450);
    }

    if(st) st.textContent='Analizando y separando las actividades…';

    try{
      const payload={
        rawText,
        fileName:file?.name||'',
        mimeType:file?.type||'',
        dataUrl:file?await fileToDataURL(file):''
      };

      const out=await serverCall('extractAlcaldia',payload);

      extracted=Array.isArray(out?.events) ? out.events : [];
      const agendaDate=String(out?.fechaAgenda||extracted[0]?.fecha||'');

      if(q('#alcaldiaAgendaDate')) q('#alcaldiaAgendaDate').value=agendaDate;
      renderPreview();

      if(st) st.textContent=extracted.length
        ? extracted.length+' actividades detectadas. Revise los datos antes de guardar.'
        : 'La IA no detectó actividades.';
    }catch(err){
      if(st) st.textContent='No se pudo procesar: '+String(err?.message||err).slice(0,220);
    }finally{
      if(timer) clearInterval(timer);
      if(btn){
        btn.disabled=false;
        btn.textContent=original;
      }
    }
  }

  async function saveAgenda(){
    const st=q('#alcaldiaProcessState');
    const btn=q('#alcaldiaSave');

    let rows=collectPreview();

    if(!rows.length){
      const msg='No hay actividades para guardar.';
      if(st) st.textContent=msg;
      window.alert(msg);
      return;
    }

    // Si la fecha general quedó vacía, recupera la fecha detectada por la IA.
    if(rows.some(e=>!e.fecha)){
      const fallback=String(
        q('#alcaldiaAgendaDate')?.value ||
        extracted.find(x=>String(x?.fecha||'').trim())?.fecha ||
        ''
      ).trim();

      if(fallback){
        if(q('#alcaldiaAgendaDate')) q('#alcaldiaAgendaDate').value=fallback;
        rows=collectPreview();
      }
    }

    if(rows.some(e=>!e.fecha)){
      const msg='Falta la fecha de la agenda. Selecciónela antes de guardar.';
      if(st) st.textContent=msg;
      const dateInput=q('#alcaldiaAgendaDate');
      dateInput?.scrollIntoView({behavior:'smooth',block:'center'});
      setTimeout(()=>dateInput?.focus(),250);
      window.alert(msg);
      return;
    }

    const original=btn?.textContent||'Guardar cartelera';
    let timer=null;

    if(btn){
      btn.disabled=true;
      let dots=0;
      const tick=()=>{
        dots=(dots%3)+1;
        btn.textContent='Guardando'+'.'.repeat(dots);
      };
      tick();
      timer=setInterval(tick,450);
    }

    if(st) st.textContent='Guardando cartelera en la base maestra…';

    try{
      const saved=await serverCall('saveAlcaldiaAgenda',{events:rows});
      const savedRows=Array.isArray(saved?.events)?saved.events:[];

      if(savedRows.length){
        const ids=new Set(savedRows.map(x=>String(x.id||'')));
        events=events.filter(x=>!ids.has(String(x.id||''))).concat(savedRows);
      }else{
        await loadData(true);
      }

      selectedDate=rows[0].fecha;
      clearLoad();
      showView('daily');
      renderDaily();
      renderHistory();

      window.alert(
        rows.length===1
          ? 'Actividad guardada correctamente.'
          : rows.length+' actividades guardadas correctamente.'
      );
    }catch(err){
      const msg='No se pudo guardar: '+String(err?.message||err).slice(0,220);
      if(st) st.textContent=msg;
      window.alert(msg);
    }finally{
      if(timer) clearInterval(timer);
      if(btn){
        btn.disabled=false;
        btn.textContent=original;
      }
    }
  }

  function closeEditModal(){
    editingEventId='';
    q('#alcaldiaEditModal')?.classList.remove('open');
    if(q('#alcaldiaEditState')) q('#alcaldiaEditState').textContent='';
  }

  function openEditModal(id){
    const e=events.find(x=>String(x.id)===String(id));
    if(!e) return;

    editingEventId=String(id);

    q('#alcaldiaEditFecha').value=String(e.fecha||'');
    q('#alcaldiaEditHoraInicio').value=normalizeTime(e.horaInicio||'');
    q('#alcaldiaEditHoraFin').value=normalizeTime(e.horaFin||'');
    q('#alcaldiaEditLlegada').value=normalizeTime(e.llegadaAlcaldesa||'');
    q('#alcaldiaEditNombre').value=String(e.nombreEvento||'');
    q('#alcaldiaEditLugar').value=String(e.lugar||'');
    q('#alcaldiaEditUbicacion').value=String(e.ubicacionUrl||'');
    q('#alcaldiaEditObservaciones').value=String(e.observaciones||'');
    q('#alcaldiaEditEstado').value=String(e.estado||'ACTIVO').toUpperCase();
    q('#alcaldiaEditState').textContent='';

    q('#alcaldiaEditModal').classList.add('open');
    setTimeout(()=>q('#alcaldiaEditNombre')?.focus(),30);
  }

  async function saveEditedAlcaldiaEvent(){
    if(!editingEventId) return;

    const patch={
      fecha:String(q('#alcaldiaEditFecha')?.value||'').trim(),
      horaInicio:normalizeTime(q('#alcaldiaEditHoraInicio')?.value||''),
      horaFin:normalizeTime(q('#alcaldiaEditHoraFin')?.value||''),
      llegadaAlcaldesa:normalizeTime(q('#alcaldiaEditLlegada')?.value||''),
      nombreEvento:String(q('#alcaldiaEditNombre')?.value||'').trim(),
      lugar:String(q('#alcaldiaEditLugar')?.value||'').trim(),
      ubicacionUrl:String(q('#alcaldiaEditUbicacion')?.value||'').trim(),
      observaciones:String(q('#alcaldiaEditObservaciones')?.value||'').trim(),
      estado:String(q('#alcaldiaEditEstado')?.value||'ACTIVO').trim().toUpperCase()
    };

    const st=q('#alcaldiaEditState');
    if(!patch.fecha){
      if(st) st.textContent='Seleccione la fecha del evento.';
      return;
    }

    if(!patch.nombreEvento){
      if(st) st.textContent='Ingrese el nombre de la actividad.';
      return;
    }

    const btn=q('#alcaldiaEditSave');
    const original=btn?.textContent||'Guardar cambios';

    try{
      if(btn){
        btn.disabled=true;
        btn.textContent='Guardando…';
      }
      if(st) st.textContent='Guardando cambios…';

      const saved=await serverCall('updateAlcaldiaEvent',editingEventId,patch);
      const e=events.find(x=>String(x.id)===String(editingEventId));
      if(e) Object.assign(e,patch,(saved&&typeof saved==='object')?saved:{});

      selectedDate=patch.fecha;
      closeEditModal();
      renderDaily();
      renderHistory();
    }catch(err){
      if(st) st.textContent='No se pudo guardar: '+String(err?.message||err).slice(0,220);
    }finally{
      if(btn){
        btn.disabled=false;
        btn.textContent=original;
      }
    }
  }

  async function deleteAlcaldiaEventFromUi(id,button){
    const e=events.find(x=>String(x.id)===String(id));
    if(!e) return;

    const name=String(e.nombreEvento||'esta actividad').trim();
    const ok=window.confirm(
      '¿Borrar definitivamente esta actividad de la cartelera?\n\n'+name+'\n\nEsta acción no se puede deshacer.'
    );
    if(!ok) return;

    const original=button?.textContent||'🗑️ Borrar';

    try{
      if(button){
        button.disabled=true;
        button.textContent='Borrando…';
      }

      await serverCall('deleteAlcaldiaEvent',String(id));
      events=events.filter(x=>String(x.id)!==String(id));
      renderDaily();
      renderHistory();
    }catch(err){
      window.alert('No se pudo borrar: '+String(err?.message||err).slice(0,220));
      if(button){
        button.disabled=false;
        button.textContent=original;
      }
    }
  }

  async function updateTracking(id,patch){
    const e=events.find(x=>String(x.id)===String(id));
    if(!e) return;

    const previous={responsable:e.responsable,asistio:e.asistio};
    Object.assign(e,patch);
    renderDaily();

    try{
      const saved=await serverCall('updateAlcaldiaEvent',String(id),patch);
      if(saved&&typeof saved==='object') Object.assign(e,saved);
    }catch(err){
      Object.assign(e,previous);
      renderDaily();
      window.alert('No se pudo actualizar: '+String(err?.message||err).slice(0,180));
    }
  }

  async function loadData(silent=false){
    if(!window.AgendaApi?.isConfigured?.()) return;

    try{
      const data=await serverCall('getAlcaldiaData');
      events=Array.isArray(data?.events)?data.events:[];
      assignables=Array.isArray(data?.assignables)?data.assignables:[];
      loadedOnce=true;
      renderDaily();
      renderHistory();
    }catch(err){
      if(!silent && q('#alcaldiaProcessState')){
        q('#alcaldiaProcessState').textContent='El módulo visual está listo; falta habilitar sus funciones en Apps Script.';
      }
      console.warn('Agenda de Alcaldía backend pendiente:',err);
    }
  }

  function bind(){
    qa('#alcaldiaSubnav [data-alcaldia-view]').forEach(btn=>{
      btn.onclick=()=>showView(btn.dataset.alcaldiaView);
    });

    q('#alcaldiaPrevDay').onclick=()=>{
      selectedDate=shiftDate(selectedDate,-1);
      renderDaily();
    };

    q('#alcaldiaNextDay').onclick=()=>{
      selectedDate=shiftDate(selectedDate,1);
      renderDaily();
    };

    q('#alcaldiaToday').onclick=()=>{
      selectedDate=isoToday();
      renderDaily();
    };

    q('#alcaldiaDatePicker').onchange=e=>{
      if(e.target.value){
        selectedDate=e.target.value;
        renderDaily();
      }
    };

    q('#alcaldiaSearch').oninput=renderHistory;

    q('#alcaldiaPickFile').onclick=()=>q('#alcaldiaSourceFile').click();

    q('#alcaldiaSourceFile').onchange=()=>{
      pastedSourceFile=null;
      const pasteZone=q('#alcaldiaPasteZone');
      if(pasteZone){
        pasteZone.classList.remove('has-image');
        pasteZone.innerHTML='';
      }
      q('#alcaldiaFileName').textContent=q('#alcaldiaSourceFile').files[0]?.name||'Sin captura seleccionada';
    };

    const pasteZone=q('#alcaldiaPasteZone');

    if(pasteZone){
      pasteZone.addEventListener('click',()=>{
        pasteZone.focus();
      });

      pasteZone.addEventListener('keydown',e=>{
        const key=String(e.key||'').toLowerCase();
        const isPaste=(e.ctrlKey||e.metaKey)&&key==='v';
        const isFocusKey=['tab','shift','control','meta'].includes(key);
        if(!isPaste&&!isFocusKey) e.preventDefault();
      });

      pasteZone.addEventListener('paste',e=>{
        e.preventDefault();

        const items=[...(e.clipboardData?.items||[])];
        const imageItem=items.find(item=>item.kind==='file' && /^image\//i.test(item.type||''));

        if(!imageItem){
          q('#alcaldiaProcessState').textContent='El portapapeles no contiene una imagen. Realice el recorte y vuelva a presionar Ctrl+V.';
          return;
        }

        const blob=imageItem.getAsFile();
        if(!blob) return;

        const ext=(String(blob.type||'image/png').split('/')[1]||'png').replace(/[^a-z0-9]+/gi,'')||'png';
        pastedSourceFile=new File(
          [blob],
          'captura_agenda_'+Date.now()+'.'+ext,
          {type:blob.type||'image/png'}
        );

        const input=q('#alcaldiaSourceFile');
        if(input) input.value='';

        pasteZone.innerHTML='';
        pasteZone.classList.add('has-image');

        q('#alcaldiaFileName').textContent='Captura pegada desde el portapapeles';
        q('#alcaldiaProcessState').textContent='Captura lista para procesar.';
      });
    }

    q('#alcaldiaProcess').onclick=processAgenda;

    q('#alcaldiaAddActivity').onclick=()=>{
      extracted=collectPreview();
      extracted.push({
        horaInicio:'',
        horaFin:'',
        llegadaAlcaldesa:'',
        nombreEvento:'',
        lugar:'',
        ubicacionUrl:'',
        observaciones:'',
        estado:'ACTIVO'
      });
      renderPreview();
    };

    q('#alcaldiaClear').onclick=clearLoad;
    q('#alcaldiaSave').onclick=saveAgenda;

    q('#alcaldiaEditClose').onclick=closeEditModal;
    q('#alcaldiaEditCancel').onclick=closeEditModal;
    q('#alcaldiaEditSave').onclick=saveEditedAlcaldiaEvent;
    q('#alcaldiaEditModal').onclick=e=>{
      if(e.target===q('#alcaldiaEditModal')) closeEditModal();
    };

    const moduleBtn=q('#moduleNav [data-module="alcaldia"]');
    if(moduleBtn){
      moduleBtn.addEventListener('click',()=>{
        renderDaily();
        if(!loadedOnce) loadData(true);
      });
    }
  }

  document.addEventListener('DOMContentLoaded',()=>{
    bind();
    renderDaily();
  });
})();