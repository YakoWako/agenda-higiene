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
  let sourceFiles=[];
  const MAX_ALCALDIA_FILES=4;
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

  function splitLocationUrls(value){
    const raw=String(value||'').trim();
    if(!raw) return [];

    const chunks=raw
      .replace(/(https?:\/\/)/gi,'\n$1')
      .split(/\n+/)
      .map(x=>x.trim())
      .filter(x=>/^https?:\/\//i.test(x))
      .map(x=>x.split(/\s+/)[0].replace(/[),.;]+$/g,''))
      .filter(Boolean);

    return [...new Set(chunks)];
  }

  function repairLocalCoordinates(url){
    let out=String(url||'').trim();
    if(!out) return '';

    out=out.replace(
      /([?&](?:q|query)=)(-?\d{1,2}(?:\.\d+)?)(,|%2C)(-?\d{2,3}(?:\.\d+)?)/i,
      (m,prefix,lat,sep,lon)=>{
        let la=Number(lat);
        let lo=Number(lon);

        if(
          Number.isFinite(la) &&
          Number.isFinite(lo) &&
          Math.abs(la)<=1.8 &&
          Math.abs(lo)>=79 &&
          Math.abs(lo)<=82
        ){
          la=-Math.abs(la);
          lo=-Math.abs(lo);
          return prefix+String(la)+sep+String(lo);
        }
        return m;
      }
    );

    return out;
  }

  function normalizeLocationField(value){
    return splitLocationUrls(value)
      .map(repairLocalCoordinates)
      .filter(Boolean)
      .join('\n');
  }

  function fallbackPlaceSearch(lugar){
    const place=String(lugar||'').trim();
    if(!place) return '';
    return 'https://www.google.com/maps/search/?api=1&query='+
      encodeURIComponent(place+', Manta, Ecuador');
  }

  function safeLocationHref(url,lugar){
    const clean=repairLocalCoordinates(url);

    if(/https?:\/\/maps\.app\.goo\.gl\//i.test(clean)){
      return fallbackPlaceSearch(lugar)||clean;
    }

    return clean;
  }

  function locationLinksHtml(e){
    const urls=splitLocationUrls(e?.ubicacionUrl)
      .map(repairLocalCoordinates)
      .filter(Boolean);

    if(!urls.length) return '';

    return '<div class="alcaldia-location-links">'+
      urls.map((url,index)=>{
        const href=safeLocationHref(url,e?.lugar);
        const label=urls.length===1
          ? 'Abrir ubicación ↗'
          : 'Ubicación '+(index+1)+' ↗';
        return '<a href="'+esc(href)+'" target="_blank" rel="noopener">'+esc(label)+'</a>';
      }).join('')+
    '</div>';
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
              ${locationLinksHtml(e)}
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
              <button class="secondary" type="button" data-alcaldia-edit="${esc(e.id)}" title="Editar" aria-label="Editar actividad">✏️</button>
              <button class="danger" type="button" data-alcaldia-delete="${esc(e.id)}" title="Borrar" aria-label="Borrar actividad">🗑️</button>
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
          <div class="field wide"><label>Enlace(s) de ubicación</label><textarea data-a-field="ubicacionUrl" rows="3" placeholder="Un enlace por línea">${esc(normalizeLocationField(e.ubicacionUrl||''))}</textarea></div>
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
        ubicacionUrl:normalizeLocationField(get('ubicacionUrl')),
        observaciones:get('observaciones'),
        estado:get('estado')||'ACTIVO'
      };
    }).filter(e=>e.nombreEvento||e.horaInicio||e.lugar);
  }

  function refreshSourceFilesUi(){
    const label=q('#alcaldiaFileName');
    const zone=q('#alcaldiaPasteZone');

    if(label){
      if(!sourceFiles.length){
        label.textContent='Sin capturas seleccionadas';
      }else{
        label.innerHTML=sourceFiles
          .map((file,index)=>'Captura '+(index+1)+': '+esc(file.name||('imagen_'+(index+1))))
          .join('<br>');
      }
    }

    if(zone){
      zone.classList.toggle('has-image',sourceFiles.length>0);
      zone.innerHTML='';
      if(sourceFiles.length){
        zone.dataset.count=String(sourceFiles.length);
      }else{
        delete zone.dataset.count;
      }
    }
  }

  function setSourceFiles(files){
    const list=[...(files||[])].filter(Boolean).slice(0,MAX_ALCALDIA_FILES);
    sourceFiles=list;
    refreshSourceFilesUi();
    return sourceFiles.length;
  }

  function appendSourceFiles(files){
    const incoming=[...(files||[])].filter(Boolean);
    let added=0;

    for(const file of incoming){
      if(sourceFiles.length>=MAX_ALCALDIA_FILES) break;
      sourceFiles.push(file);
      added++;
    }

    refreshSourceFilesUi();
    return added;
  }

  function clearLoad(){
    extracted=[];
    renderPreview();

    const file=q('#alcaldiaSourceFile');
    if(file) file.value='';
    sourceFiles=[];
    refreshSourceFilesUi();

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

  function loadAgendaImage(file){
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file);
      const img=new Image();

      img.onload=()=>{
        URL.revokeObjectURL(url);
        resolve(img);
      };

      img.onerror=()=>{
        URL.revokeObjectURL(url);
        reject(new Error('No se pudo preparar una de las capturas.'));
      };

      img.src=url;
    });
  }

  function canvasToAgendaFile(canvas){
    return new Promise((resolve,reject)=>{
      canvas.toBlob(blob=>{
        if(!blob){
          reject(new Error('No se pudo crear la imagen consolidada.'));
          return;
        }

        resolve(new File(
          [blob],
          'agenda_alcaldia_'+Date.now()+'.jpg',
          {type:'image/jpeg'}
        ));
      },'image/jpeg',0.9);
    });
  }

  async function combineAgendaImages(files){
    const images=await Promise.all(files.map(loadAgendaImage));
    const widest=Math.max(...images.map(img=>img.naturalWidth||img.width||1));
    const targetWidth=Math.min(1600,Math.max(1200,widest));
    const gap=14;

    const parts=images.map(img=>{
      const w=img.naturalWidth||img.width||1;
      const h=img.naturalHeight||img.height||1;
      const scale=targetWidth/w;
      return {
        img,
        width:targetWidth,
        height:Math.max(1,Math.round(h*scale))
      };
    });

    const totalHeight=
      parts.reduce((sum,p)=>sum+p.height,0)+
      gap*Math.max(0,parts.length-1);

    const canvas=document.createElement('canvas');
    canvas.width=targetWidth;
    canvas.height=totalHeight;

    const ctx=canvas.getContext('2d',{alpha:false});
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality='high';

    let y=0;
    parts.forEach((part,index)=>{
      ctx.drawImage(part.img,0,y,part.width,part.height);
      y+=part.height;

      if(index<parts.length-1){
        ctx.fillStyle='#ffffff';
        ctx.fillRect(0,y,targetWidth,gap);
        y+=gap;
      }
    });

    return canvasToAgendaFile(canvas);
  }

  function serverCallWithTimeout(fn,timeoutMs,...args){
    let timeoutId;

    const timeout=new Promise((_,reject)=>{
      timeoutId=setTimeout(()=>{
        reject(new Error('TIEMPO_AGOTADO'));
      },timeoutMs);
    });

    return Promise.race([
      serverCall(fn,...args),
      timeout
    ]).finally(()=>clearTimeout(timeoutId));
  }

  async function processAgenda(){
    const files=[...sourceFiles];
    const rawText=String(q('#alcaldiaRawText')?.value||'').trim();
    const st=q('#alcaldiaProcessState');

    if(!files.length&&!rawText){
      if(st) st.textContent='Seleccione o pegue al menos una captura, o pegue el texto de la agenda.';
      return;
    }

    if(files.length>1 && files.some(file=>!/^image\//i.test(file.type||''))){
      const msg='Para procesar varias capturas a la vez use únicamente imágenes. Los PDF deben procesarse de uno en uno.';
      if(st) st.textContent=msg;
      window.alert(msg);
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

    try{
      let payloadFile=null;
      let instruction=rawText;

      if(files.length>1){
        if(st) st.textContent='Consolidando '+files.length+' capturas en una sola lectura…';
        payloadFile=await combineAgendaImages(files);

        instruction=[
          rawText,
          'NOTA TÉCNICA: la imagen contiene '+files.length+' capturas consecutivas de la misma agenda de WhatsApp, apiladas verticalmente. Analízalas como una sola agenda. La fecha general puede aparecer únicamente en la primera captura. No dupliques una actividad si aparece parcialmente repetida entre dos capturas.'
        ].filter(Boolean).join('\n\n');
      }else if(files.length===1){
        payloadFile=files[0];
      }

      if(st) st.textContent='Analizando la agenda completa con IA…';

      const out=await serverCallWithTimeout(
        'extractAlcaldia',
        120000,
        {
          rawText:instruction,
          fileName:payloadFile?.name||'',
          mimeType:payloadFile?.type||'',
          dataUrl:payloadFile?await fileToDataURL(payloadFile):''
        }
      );

      const rows=(Array.isArray(out?.events)?out.events:[]).map(e=>({
        ...e,
        ubicacionUrl:normalizeLocationField(e?.ubicacionUrl||'')
      }));

      const agendaDate=String(
        out?.fechaAgenda ||
        rows.find(e=>String(e?.fecha||'').trim())?.fecha ||
        ''
      ).trim();

      const dated=rows.map(e=>({
        ...e,
        fecha:String(e?.fecha||'').trim()||agendaDate
      }));

      // Protección adicional contra solapamientos entre capturas.
      const merged=[];
      dated.forEach(row=>{
        const duplicate=merged.find(existing=>sameAlcaldiaEvent(row,existing));

        if(!duplicate){
          merged.push(row);
          return;
        }

        const urls=[
          ...splitLocationUrls(duplicate.ubicacionUrl),
          ...splitLocationUrls(row.ubicacionUrl)
        ];
        duplicate.ubicacionUrl=normalizeLocationField(urls.join('\n'));

        if(!duplicate.observaciones && row.observaciones){
          duplicate.observaciones=row.observaciones;
        }
      });

      extracted=merged;

      if(q('#alcaldiaAgendaDate')) q('#alcaldiaAgendaDate').value=agendaDate;
      renderPreview();

      if(st) st.textContent=extracted.length
        ? (agendaDate
            ? extracted.length+' actividades detectadas y consolidadas. Revise los datos antes de guardar.'
            : extracted.length+' actividades detectadas. La captura no contiene una fecha reconocible; ingrésela manualmente antes de guardar.')
        : 'La IA no detectó actividades.';
    }catch(err){
      const raw=String(err?.message||err);
      const msg=/TIEMPO_AGOTADO/i.test(raw)
        ? 'El análisis tardó demasiado y se detuvo automáticamente. Intente nuevamente o reduzca el número de capturas.'
        : 'No se pudo procesar: '+raw.slice(0,220);

      if(st) st.textContent=msg;
      if(/TIEMPO_AGOTADO/i.test(raw)) window.alert(msg);
    }finally{
      if(timer) clearInterval(timer);
      if(btn){
        btn.disabled=false;
        btn.textContent=original;
      }
    }
  }

  function normalizeDupText(value){
    return String(value||'')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  function extractEventCodes(e){
    const text=[
      e?.nombreEvento,
      e?.observaciones,
      e?.lugar
    ].filter(Boolean).join(' ');

    return [...new Set(
      (String(text).match(/\bTE\d{8,}\b/gi)||[])
        .map(x=>x.toUpperCase())
    )];
  }

  function tokenSimilarity(a,b){
    const stop=new Set(['de','del','la','las','los','el','y','a','para','en','un','una','al','por','con']);
    const A=new Set(normalizeDupText(a).split(' ').filter(x=>x.length>2&&!stop.has(x)));
    const B=new Set(normalizeDupText(b).split(' ').filter(x=>x.length>2&&!stop.has(x)));
    if(!A.size||!B.size) return 0;

    let intersection=0;
    A.forEach(x=>{ if(B.has(x)) intersection++; });
    const union=new Set([...A,...B]).size;
    return union?intersection/union:0;
  }

  function sameAlcaldiaEvent(a,b){
    if(!a||!b) return false;
    if(String(a.fecha||'')!==String(b.fecha||'')) return false;

    const aCodes=extractEventCodes(a);
    const bCodes=extractEventCodes(b);
    if(aCodes.length&&bCodes.length&&aCodes.some(code=>bCodes.includes(code))) return true;

    const sameStart=normalizeTime(a.horaInicio||'')===normalizeTime(b.horaInicio||'');
    const sameEnd=normalizeTime(a.horaFin||'')===normalizeTime(b.horaFin||'');
    const placeA=normalizeDupText(a.lugar);
    const placeB=normalizeDupText(b.lugar);
    const samePlace=!!placeA&&!!placeB&&(placeA===placeB||placeA.includes(placeB)||placeB.includes(placeA));
    const nameScore=tokenSimilarity(a.nombreEvento,b.nombreEvento);

    // Coincidencia horaria fuerte + lugar, o coincidencia horaria fuerte + nombre muy parecido.
    if(sameStart&&sameEnd&&(samePlace||nameScore>=0.46)) return true;

    // Para agendas con hora fin omitida: misma hora de inicio + lugar + nombre razonablemente parecido.
    if(sameStart&&samePlace&&nameScore>=0.34) return true;

    return false;
  }

  function duplicateLabel(e){
    const time=normalizeTime(e.horaInicio||'')||'sin hora';
    const name=String(e.nombreEvento||'Actividad sin nombre').trim();
    return time+' · '+name;
  }

  function findDuplicateRows(rows,existingRows){
    const duplicates=[];
    const accepted=[];

    rows.forEach((row,index)=>{
      const againstExisting=(existingRows||[]).find(e=>sameAlcaldiaEvent(row,e));
      const againstBatch=accepted.find(e=>sameAlcaldiaEvent(row,e));

      if(againstExisting||againstBatch){
        duplicates.push({
          index,
          row,
          match:againstExisting||againstBatch
        });
      }else{
        accepted.push(row);
      }
    });

    return {duplicates,accepted};
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
        btn.textContent='Verificando'+'.'.repeat(dots);
      };
      tick();
      timer=setInterval(tick,450);
    }

    if(st) st.textContent='Verificando que no existan actividades duplicadas…';

    try{
      // Se consulta nuevamente la base justo antes de guardar para evitar
      // duplicados incluso si otro usuario registró la agenda hace unos segundos.
      const fresh=await serverCall('getAlcaldiaData');
      const freshEvents=Array.isArray(fresh?.events)?fresh.events:[];
      const check=findDuplicateRows(rows,freshEvents);

      if(check.duplicates.length){
        const lines=check.duplicates
          .map(x=>'• '+duplicateLabel(x.row))
          .join('\n');

        if(!check.accepted.length){
          const msg=
            'No se guardó ninguna actividad porque ya está registrada en la cartelera.\n\n'+
            lines;
          if(st) st.textContent='Registro detenido: la agenda ya existe en la cartelera.';
          window.alert(msg);
          return;
        }

        const proceed=window.confirm(
          'Se detectaron '+check.duplicates.length+' actividad(es) ya registradas y NO se volverán a guardar:\n\n'+
          lines+
          '\n\n¿Desea guardar únicamente las '+check.accepted.length+' actividad(es) nuevas?'
        );

        if(!proceed){
          if(st) st.textContent='Guardado cancelado para evitar duplicados.';
          return;
        }

        rows=check.accepted;
      }

      if(btn){
        let dots=0;
        const tick=()=>{
          dots=(dots%3)+1;
          btn.textContent='Guardando'+'.'.repeat(dots);
        };
        if(timer) clearInterval(timer);
        tick();
        timer=setInterval(tick,450);
      }

      if(st) st.textContent='Guardando cartelera en la base maestra…';

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
    q('#alcaldiaEditUbicacion').value=normalizeLocationField(e.ubicacionUrl||'');
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
      ubicacionUrl:normalizeLocationField(q('#alcaldiaEditUbicacion')?.value||''),
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

    const original=button?.textContent||'🗑️';

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
      const raw=String(err?.message||err);
      const msg=/PERMISO_INSUFICIENTE/i.test(raw)
        ? 'No se pudo borrar: el backend está restringiendo esta acción por permisos. Debe habilitarse deleteAlcaldiaEvent para el mismo perfil que ya puede guardar la cartelera.'
        : 'No se pudo borrar: '+raw.slice(0,220);

      window.alert(msg);

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
      events=(Array.isArray(data?.events)?data.events:[]).map(e=>({
        ...e,
        ubicacionUrl:normalizeLocationField(e?.ubicacionUrl||'')
      }));
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
      const files=[...(q('#alcaldiaSourceFile').files||[])];

      if(files.length>MAX_ALCALDIA_FILES){
        window.alert('Puede procesar hasta '+MAX_ALCALDIA_FILES+' capturas a la vez. Se usarán las primeras '+MAX_ALCALDIA_FILES+'.');
      }

      setSourceFiles(files.slice(0,MAX_ALCALDIA_FILES));
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
        const imageItems=items.filter(item=>item.kind==='file' && /^image\//i.test(item.type||''));

        if(!imageItems.length){
          q('#alcaldiaProcessState').textContent='El portapapeles no contiene una imagen. Realice el recorte y vuelva a presionar Ctrl+V.';
          return;
        }

        if(sourceFiles.length>=MAX_ALCALDIA_FILES){
          window.alert('Ya alcanzó el máximo de '+MAX_ALCALDIA_FILES+' capturas.');
          return;
        }

        const added=[];
        imageItems.forEach(item=>{
          if(sourceFiles.length+added.length>=MAX_ALCALDIA_FILES) return;

          const blob=item.getAsFile();
          if(!blob) return;

          const ext=(String(blob.type||'image/png').split('/')[1]||'png').replace(/[^a-z0-9]+/gi,'')||'png';
          added.push(new File(
            [blob],
            'captura_agenda_'+(sourceFiles.length+added.length+1)+'_'+Date.now()+'.'+ext,
            {type:blob.type||'image/png'}
          ));
        });

        appendSourceFiles(added);

        const input=q('#alcaldiaSourceFile');
        if(input) input.value='';

        q('#alcaldiaProcessState').textContent=
          sourceFiles.length===1
            ? '1 captura lista para procesar.'
            : sourceFiles.length+' capturas listas para procesar.';
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