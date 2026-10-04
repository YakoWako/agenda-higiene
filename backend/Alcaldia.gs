/**
 * Agenda Higiene · Módulo Agenda de Alcaldía
 * Archivo independiente para mantener aislado el núcleo de Agenda Local.
 * Requiere los helpers existentes en Código.gs:
 * getSS_, ensureSheet_, readObjects_, upsertObject_, makeId_,
 * extractResponseText_ y AH.TZ.
 */

const ALCALDIA_SHEET = 'AGENDA_ALCALDIA';

const ALCALDIA_HEADERS = [
  'id',
  'createdAt',
  'updatedAt',
  'fecha',
  'horaInicio',
  'horaFin',
  'llegadaAlcaldesa',
  'nombreEvento',
  'lugar',
  'ubicacionUrl',
  'observaciones',
  'responsable',
  'asistio',
  'estado'
];

function ensureAlcaldiaSheet_() {
  return ensureSheet_(
    getSS_(),
    ALCALDIA_SHEET,
    ALCALDIA_HEADERS
  );
}

function getAlcaldiaData() {
  ensureAlcaldiaSheet_();

  const rows = readObjects_(ALCALDIA_SHEET)
    .map(alcaldiaRowToObject_)
    .sort(function(a,b){
      const av =
        String(b.fecha || '') + ' ' +
        String(b.horaInicio || '');

      const bv =
        String(a.fecha || '') + ' ' +
        String(a.horaInicio || '');

      return av.localeCompare(bv);
    });

  return {
    events: rows,
    assignables: getAlcaldiaAssignables_()
  };
}

function getAlcaldiaAssignables_() {
  try {
    return readObjects_('PERSONAL')
      .filter(function(row){
        return (
          isTruthyAlcaldia_(row.activo) &&
          isTruthyAlcaldia_(row.puedeSerAsignado)
        );
      })
      .map(function(row){
        return String(row.nombre || '').trim();
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function isTruthyAlcaldia_(value) {
  if (value === true || value === 1) return true;

  const s = String(value || '')
    .trim()
    .toUpperCase();

  return (
    s === 'TRUE' ||
    s === 'VERDADERO' ||
    s === 'SI' ||
    s === 'SÍ' ||
    s === '1' ||
    s === 'X'
  );
}

function alcaldiaRowToObject_(row) {
  row = row || {};

  return {
    id: String(row.id || ''),
    createdAt: String(row.createdAt || ''),
    updatedAt: String(row.updatedAt || ''),
    fecha: normalizeAlcaldiaDate_(row.fecha),
    horaInicio: normalizeAlcaldiaTime_(row.horaInicio),
    horaFin: normalizeAlcaldiaTime_(row.horaFin),
    llegadaAlcaldesa: normalizeAlcaldiaTime_(row.llegadaAlcaldesa),
    nombreEvento: String(row.nombreEvento || ''),
    lugar: String(row.lugar || ''),
    ubicacionUrl: String(row.ubicacionUrl || ''),
    observaciones: String(row.observaciones || ''),
    responsable: String(row.responsable || ''),
    asistio: isTruthyAlcaldia_(row.asistio),
    estado: normalizeAlcaldiaStatus_(row.estado)
  };
}

function saveAlcaldiaAgenda(payload) {
  ensureAlcaldiaSheet_();

  payload = payload || {};

  const incoming = Array.isArray(payload.events)
    ? payload.events
    : [];

  if (!incoming.length) {
    throw new Error('No hay actividades para guardar.');
  }

  const existingRows = readObjects_(ALCALDIA_SHEET);
  const now = new Date().toISOString();
  const saved = [];

  incoming.forEach(function(item){
    item = item || {};

    const fecha =
      normalizeAlcaldiaDate_(item.fecha);

    const nombreEvento =
      String(item.nombreEvento || '').trim();

    if (!fecha || !nombreEvento) {
      return;
    }

    const horaInicio =
      normalizeAlcaldiaTime_(item.horaInicio);

    const key =
      buildAlcaldiaIdentity_(
        fecha,
        horaInicio,
        nombreEvento
      );

    const existing =
      existingRows.find(function(row){
        return (
          buildAlcaldiaIdentity_(
            normalizeAlcaldiaDate_(row.fecha),
            normalizeAlcaldiaTime_(row.horaInicio),
            String(row.nombreEvento || '')
          ) === key
        );
      });

    const id =
      existing && existing.id
        ? String(existing.id)
        : makeId_('ALC');

    const row = {
      id: id,
      createdAt:
        existing && existing.createdAt
          ? existing.createdAt
          : now,
      updatedAt: now,
      fecha: fecha,
      horaInicio: horaInicio,
      horaFin:
        normalizeAlcaldiaTime_(item.horaFin),
      llegadaAlcaldesa:
        normalizeAlcaldiaTime_(item.llegadaAlcaldesa),
      nombreEvento: nombreEvento,
      lugar:
        String(item.lugar || '').trim(),
      ubicacionUrl:
        normalizeAlcaldiaUrl_(item.ubicacionUrl),
      observaciones:
        String(item.observaciones || '').trim(),
      responsable:
        existing
          ? String(existing.responsable || '')
          : String(item.responsable || '').trim(),
      asistio:
        existing
          ? isTruthyAlcaldia_(existing.asistio)
          : !!item.asistio,
      estado:
        normalizeAlcaldiaStatus_(
          item.estado ||
          (existing && existing.estado) ||
          'ACTIVO'
        )
    };

    upsertObject_(
      ALCALDIA_SHEET,
      'id',
      row,
      ALCALDIA_HEADERS
    );

    saved.push(alcaldiaRowToObject_(row));
  });

  if (!saved.length) {
    throw new Error(
      'No se encontraron actividades válidas para guardar.'
    );
  }

  return {
    ok: true,
    events: saved
  };
}

function updateAlcaldiaEvent(id, patch) {
  ensureAlcaldiaSheet_();

  const targetId =
    String(id || '').trim();

  if (!targetId) {
    throw new Error('ID_INVALIDO');
  }

  patch = patch || {};

  const existing =
    readObjects_(ALCALDIA_SHEET)
      .find(function(row){
        return String(row.id || '') === targetId;
      });

  if (!existing) {
    throw new Error('REGISTRO_NO_ENCONTRADO');
  }

  const row = {
    id: targetId,
    createdAt:
      existing.createdAt ||
      new Date().toISOString(),
    updatedAt:
      new Date().toISOString(),
    fecha:
      normalizeAlcaldiaDate_(existing.fecha),
    horaInicio:
      normalizeAlcaldiaTime_(existing.horaInicio),
    horaFin:
      normalizeAlcaldiaTime_(existing.horaFin),
    llegadaAlcaldesa:
      normalizeAlcaldiaTime_(existing.llegadaAlcaldesa),
    nombreEvento:
      String(existing.nombreEvento || ''),
    lugar:
      String(existing.lugar || ''),
    ubicacionUrl:
      String(existing.ubicacionUrl || ''),
    observaciones:
      String(existing.observaciones || ''),
    responsable:
      Object.prototype.hasOwnProperty.call(
        patch,
        'responsable'
      )
        ? String(patch.responsable || '').trim()
        : String(existing.responsable || ''),
    asistio:
      Object.prototype.hasOwnProperty.call(
        patch,
        'asistio'
      )
        ? !!patch.asistio
        : isTruthyAlcaldia_(existing.asistio),
    estado:
      Object.prototype.hasOwnProperty.call(
        patch,
        'estado'
      )
        ? normalizeAlcaldiaStatus_(patch.estado)
        : normalizeAlcaldiaStatus_(existing.estado)
  };

  upsertObject_(
    ALCALDIA_SHEET,
    'id',
    row,
    ALCALDIA_HEADERS
  );

  return alcaldiaRowToObject_(row);
}

function extractAlcaldia(payload) {
  payload = payload || {};

  const key =
    PropertiesService
      .getScriptProperties()
      .getProperty('OPENAI_API_KEY');

  if (!key) {
    throw new Error(
      'OPENAI_API_KEY no está configurada.'
    );
  }

  const model =
    PropertiesService
      .getScriptProperties()
      .getProperty('OPENAI_MODEL') ||
    'gpt-5.6-luna';

  const content = [{
    type: 'input_text',
    text:
      buildAlcaldiaPrompt_() +
      (
        payload.rawText
          ? '\n\nTEXTO PEGADO POR EL USUARIO:\n' +
            String(payload.rawText)
          : ''
      )
  }];

  if (payload.dataUrl) {
    const mime =
      String(payload.mimeType || '')
        .toLowerCase();

    if (
      mime === 'application/pdf' ||
      /\.pdf$/i.test(
        String(payload.fileName || '')
      )
    ) {
      content.push({
        type: 'input_file',
        file_data: String(payload.dataUrl),
        filename:
          payload.fileName ||
          'agenda_alcaldia.pdf',
        detail: 'high'
      });
    } else if (
      mime.indexOf('image/') === 0
    ) {
      content.push({
        type: 'input_image',
        image_url: String(payload.dataUrl),
        detail: 'high'
      });
    }
  }

  const eventSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      fecha: {type:'string'},
      horaInicio: {type:'string'},
      horaFin: {type:'string'},
      llegadaAlcaldesa: {type:'string'},
      nombreEvento: {type:'string'},
      lugar: {type:'string'},
      ubicacionUrl: {type:'string'},
      observaciones: {type:'string'},
      estado: {type:'string'}
    },
    required: [
      'fecha',
      'horaInicio',
      'horaFin',
      'llegadaAlcaldesa',
      'nombreEvento',
      'lugar',
      'ubicacionUrl',
      'observaciones',
      'estado'
    ]
  };

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      fechaAgenda: {type:'string'},
      events: {
        type: 'array',
        items: eventSchema
      }
    },
    required: [
      'fechaAgenda',
      'events'
    ]
  };

  const body = {
    model: model,
    input: [{
      role: 'user',
      content: content
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'agenda_alcaldia_diaria',
        strict: true,
        schema: schema
      }
    }
  };

  const resp =
    UrlFetchApp.fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        headers: {
          Authorization:
            'Bearer ' + key
        },
        payload:
          JSON.stringify(body)
      }
    );

  const code =
    resp.getResponseCode();

  const txt =
    resp.getContentText();

  if (
    code < 200 ||
    code >= 300
  ) {
    throw new Error(
      'Error de IA (' +
      code +
      '): ' +
      txt.slice(0,500)
    );
  }

  const json =
    JSON.parse(txt);

  const out =
    extractResponseText_(json);

  if (!out) {
    throw new Error(
      'La IA no devolvió datos estructurados.'
    );
  }

  const parsed =
    JSON.parse(out);

  parsed.fechaAgenda =
    normalizeAlcaldiaDate_(
      parsed.fechaAgenda
    );

  if (!Array.isArray(parsed.events)) {
    parsed.events = [];
  }

  parsed.events =
    parsed.events
      .map(function(e){
        e = e || {};

        return {
          fecha:
            normalizeAlcaldiaDate_(
              e.fecha ||
              parsed.fechaAgenda
            ),
          horaInicio:
            normalizeAlcaldiaTime_(
              e.horaInicio
            ),
          horaFin:
            normalizeAlcaldiaTime_(
              e.horaFin
            ),
          llegadaAlcaldesa:
            normalizeAlcaldiaTime_(
              e.llegadaAlcaldesa
            ),
          nombreEvento:
            String(
              e.nombreEvento || ''
            ).trim(),
          lugar:
            String(
              e.lugar || ''
            ).trim(),
          ubicacionUrl:
            normalizeAlcaldiaUrl_(
              e.ubicacionUrl
            ),
          observaciones:
            String(
              e.observaciones || ''
            ).trim(),
          estado:
            normalizeAlcaldiaStatus_(
              e.estado
            )
        };
      })
      .filter(function(e){
        return (
          e.nombreEvento ||
          e.horaInicio ||
          e.lugar
        );
      });

  if (
    !parsed.fechaAgenda &&
    parsed.events.length &&
    parsed.events[0].fecha
  ) {
    parsed.fechaAgenda =
      parsed.events[0].fecha;
  }

  return parsed;
}

function buildAlcaldiaPrompt_() {
  return [
    'Analiza una AGENDA DIARIA DE ALCALDÍA del GAD Municipal de Manta.',
    'La fuente suele ser una captura de WhatsApp o texto reenviado que contiene varias actividades del mismo día.',
    'Debes separar cada actividad como un registro independiente.',
    '',
    'REGLAS OBLIGATORIAS:',
    '1. fechaAgenda: identifica la fecha general de la agenda y devuelve YYYY-MM-DD.',
    '2. Si una introducción dice por ejemplo "Agenda del sábado 03 de octubre de 2026", aplica esa fecha a las actividades que no repitan fecha.',
    '3. events: incluye TODAS las actividades visibles o descritas en la agenda, respetando su orden cronológico.',
    '4. horaInicio y horaFin: extrae el rango principal de cada actividad. Devuelve HH:MM en formato de 24 horas.',
    '5. llegadaAlcaldesa: si aparece una frase como "(LLEGADA DE LA ALCALDESA 08:30)" o equivalente, extrae únicamente esa hora. Si no aparece, devuelve cadena vacía.',
    '6. nombreEvento: devuelve un título breve y fiel de la actividad. No incluyas el rango horario, la palabra Lugar ni la URL.',
    '7. lugar: extrae todo el texto útil que sigue a "Lugar:" o que identifique claramente el sitio del evento.',
    '8. ubicacionUrl: copia únicamente el enlace EXPLÍCITO que aparezca junto a la palabra "Ubicación:" o como vínculo visible dentro del mismo bloque/mensaje de esa actividad. Debe conservarse carácter por carácter; no reconstruyas, completes, acortes ni generes una URL a partir del nombre del lugar o de coordenadas.',
    '9. Si el enlace visible está partido por salto de línea en la captura, une solamente los fragmentos que forman claramente el mismo URL. Si algún carácter no es legible con suficiente certeza, devuelve cadena vacía antes que una dirección incorrecta.',
    '10. Una miniatura de Google Maps, una tarjeta de vista previa o unas coordenadas NO autorizan a crear un enlace. Nunca conviertas coordenadas en una URL.',
    '11. En capturas de WhatsApp con varios mensajes, asocia cada enlace o miniatura únicamente con la actividad del mismo mensaje/bloque. No traslades una ubicación a la actividad anterior o siguiente. Si la asociación es ambigua, deja ubicacionUrl vacía.',
    '12. observaciones: conserva información operativa secundaria útil que no encaje en los campos anteriores, por ejemplo códigos TE, indicaciones especiales o aclaraciones. No copies saludos ni metadatos de WhatsApp.',
    '13. estado: devuelve ACTIVO salvo que la fuente diga explícitamente que la actividad fue suspendida o reprogramada; en esos casos devuelve SUSPENDIDO o REPROGRAMADO.',
    '14. Ignora nombres de remitentes de WhatsApp, horas de envío del mensaje, "Reenviado", respuestas del grupo como "por fa su ayuda", menciones posteriores de asignación interna y elementos de la interfaz del teléfono.',
    '15. Si un dato no consta, devuelve cadena vacía. No infieras nombres, lugares ni horarios.',
    '16. No combines dos actividades distintas aunque se desarrollen en el mismo lugar.',
    '17. La salida debe representar la agenda institucional, no la conversación de WhatsApp.'
  ].join('\n');
}

function buildAlcaldiaIdentity_(
  fecha,
  horaInicio,
  nombreEvento
) {
  return [
    String(fecha || '').trim(),
    String(horaInicio || '').trim(),
    normalizeAlcaldiaText_(
      nombreEvento
    )
  ].join('|');
}

function normalizeAlcaldiaText_(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,' ')
    .trim()
    .replace(/\s+/g,' ');
}

function normalizeAlcaldiaStatus_(value) {
  const s =
    String(value || 'ACTIVO')
      .trim()
      .toUpperCase();

  if (
    s === 'SUSPENDIDO' ||
    s === 'REPROGRAMADO'
  ) {
    return s;
  }

  return 'ACTIVO';
}

function normalizeAlcaldiaUrl_(value) {
  const s =
    String(value || '')
      .trim()
      .replace(/[),.;]+$/,'');

  return /^https?:\/\//i.test(s)
    ? s
    : '';
}

function normalizeAlcaldiaDate_(value) {
  if (
    value instanceof Date &&
    !isNaN(value.getTime())
  ) {
    return Utilities.formatDate(
      value,
      AH.TZ,
      'yyyy-MM-dd'
    );
  }

  const s =
    String(value || '')
      .trim();

  if (!s) return '';

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(s)
  ) {
    return s;
  }

  const m =
    s.match(
      /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/
    );

  if (m) {
    return (
      m[3] +
      '-' +
      String(m[2]).padStart(2,'0') +
      '-' +
      String(m[1]).padStart(2,'0')
    );
  }

  return s;
}

function normalizeAlcaldiaTime_(value) {
  if (
    value instanceof Date &&
    !isNaN(value.getTime())
  ) {
    return Utilities.formatDate(
      value,
      AH.TZ,
      'HH:mm'
    );
  }

  const s =
    String(value || '')
      .trim()
      .toUpperCase();

  if (!s) return '';

  let m =
    s.match(
      /^(\d{1,2})(?:[:H\.])(\d{2})(?::\d{2})?$/
    );

  if (!m) {
    m =
      s.match(
        /\b(\d{1,2}):(\d{2}):\d{2}\s+GMT/i
      ) ||
      s.match(
        /\b(\d{1,2}):(\d{2})\b/
      );
  }

  if (!m) return s;

  const h = Number(m[1]);
  const min = Number(m[2]);

  if (
    h === 24 &&
    min === 0
  ) {
    return '24:00';
  }

  if (
    h < 0 ||
    h > 23 ||
    min < 0 ||
    min > 59
  ) {
    return s;
  }

  return (
    String(h).padStart(2,'0') +
    ':' +
    String(min).padStart(2,'0')
  );
}
