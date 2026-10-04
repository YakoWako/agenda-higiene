/**
 * Agenda Higiene · Módulo Eventos con Tasa de Aseo
 * Archivo independiente para mantener aislado el núcleo de Agenda Local.
 * Requiere los helpers ya existentes en Code.gs:
 * getSS_, ensureSheet_, readObjects_, upsertObject_, getConfig_, setConfigValue_,
 * makeId_, extractResponseText_ y AH.TZ.
 */

const TASA_ASEO_SHEET = 'TASA_ASEO';

const TASA_ASEO_HEADERS = [
  'id',
  'createdAt',
  'updatedAt',
  'numeroDocumento',
  'fechaEmision',
  'nombreEvento',
  'fechaEvento',
  'horaInicio',
  'horaFin',
  'lugar',
  'aforo',
  'organizador',
  'identificacion',
  'tasaPagada',
  'cronogramaJson',
  'pdfUrl',
  'pdfFileName'
];

function ensureTasaAseoSheet_() {
  return ensureSheet_(getSS_(), TASA_ASEO_SHEET, TASA_ASEO_HEADERS);
}

function getTasaAseoData() {
  ensureTasaAseoSheet_();

  return readObjects_(TASA_ASEO_SHEET)
    .map(tasaAseoRowToObject_)
    .sort(function(a,b){
      return String(b.fechaEvento || '').localeCompare(String(a.fechaEvento || ''));
    });
}

function tasaAseoRowToObject_(row) {
  row = row || {};

  let cronograma = [];
  try {
    cronograma = JSON.parse(String(row.cronogramaJson || '[]'));
    if (!Array.isArray(cronograma)) cronograma = [];
  } catch (_) {
    cronograma = [];
  }

  return {
    id: String(row.id || ''),
    createdAt: String(row.createdAt || ''),
    updatedAt: String(row.updatedAt || ''),
    numeroDocumento: String(row.numeroDocumento || ''),
    fechaEmision: normalizeTasaDate_(row.fechaEmision),
    nombreEvento: String(row.nombreEvento || ''),
    fechaEvento: normalizeTasaDate_(row.fechaEvento),
    horaInicio: normalizeTasaTime_(row.horaInicio),
    horaFin: normalizeTasaTime_(row.horaFin),
    lugar: String(row.lugar || ''),
    aforo: String(row.aforo || ''),
    organizador: String(row.organizador || ''),
    identificacion: String(row.identificacion || ''),
    tasaPagada: row.tasaPagada === '' || row.tasaPagada == null ? '' : String(row.tasaPagada),
    cronograma: cronograma.map(function(c){
      return {
        fase: String(c && c.fase || ''),
        fecha: normalizeTasaDate_(c && c.fecha),
        inicio: normalizeTasaTime_(c && c.inicio),
        fin: normalizeTasaTime_(c && c.fin)
      };
    }),
    pdfUrl: String(row.pdfUrl || ''),
    pdfFileName: String(row.pdfFileName || '')
  };
}

function saveTasaAseoEvent(payload, role) {
  ensureTasaAseoSheet_();
  payload = payload || {};

  if (payload.id && String(role || '').toUpperCase() !== 'ADMIN') {
    throw new Error('PERMISO_INSUFICIENTE');
  }

  const nombreEvento = String(payload.nombreEvento || '').trim();
  const fechaEvento = normalizeTasaDate_(payload.fechaEvento);

  if (!nombreEvento) throw new Error('Ingrese el nombre del evento.');
  if (!fechaEvento) throw new Error('Ingrese la fecha principal del evento.');

  const now = new Date().toISOString();
  const id = String(payload.id || '').trim() || makeId_('TAS');

  let pdfUrl = String(payload.pdfUrl || '').trim();
  let pdfFileName = String(payload.pdfFileName || '').trim();

  if (payload.pdfDataUrl) {
    const m = String(payload.pdfDataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error('El PDF no tiene un formato válido.');

    const folder = getTasaAseoFolder_();
    pdfFileName = pdfFileName || ('Certificacion_' + id + '.pdf');
    const blob = Utilities.newBlob(
      Utilities.base64Decode(m[2]),
      payload.pdfMimeType || m[1] || 'application/pdf',
      pdfFileName
    );
    const file = folder.createFile(blob);
    pdfUrl = file.getUrl();
  }

  const cronograma = Array.isArray(payload.cronograma)
    ? payload.cronograma.map(function(c){
        return {
          fase: String(c && c.fase || '').trim(),
          fecha: normalizeTasaDate_(c && c.fecha),
          inicio: normalizeTasaTime_(c && c.inicio),
          fin: normalizeTasaTime_(c && c.fin)
        };
      }).filter(function(c){
        return c.fase || c.fecha || c.inicio || c.fin;
      })
    : [];

  const existing = readObjects_(TASA_ASEO_SHEET)
    .find(function(r){ return String(r.id || '') === id; });

  const row = {
    id: id,
    createdAt: existing && existing.createdAt ? existing.createdAt : now,
    updatedAt: now,
    numeroDocumento: String(payload.numeroDocumento || '').trim(),
    fechaEmision: normalizeTasaDate_(payload.fechaEmision),
    nombreEvento: nombreEvento,
    fechaEvento: fechaEvento,
    horaInicio: normalizeTasaTime_(payload.horaInicio),
    horaFin: normalizeTasaTime_(payload.horaFin),
    lugar: String(payload.lugar || '').trim(),
    aforo: String(payload.aforo || '').trim(),
    organizador: String(payload.organizador || '').trim(),
    identificacion: String(payload.identificacion || '').trim(),
    tasaPagada: payload.tasaPagada === '' || payload.tasaPagada == null
      ? ''
      : String(payload.tasaPagada).trim(),
    cronogramaJson: JSON.stringify(cronograma),
    pdfUrl: pdfUrl,
    pdfFileName: pdfFileName
  };

  upsertObject_(TASA_ASEO_SHEET, 'id', row, TASA_ASEO_HEADERS);
  return tasaAseoRowToObject_(row);
}

function deleteTasaAseoEvent(id) {
  ensureTasaAseoSheet_();

  const targetId = String(id || '').trim();
  if (!targetId) throw new Error('ID_INVALIDO');

  const ss = getSS_();
  const sh = ss.getSheetByName(TASA_ASEO_SHEET);
  if (!sh) throw new Error('HOJA_TASA_ASEO_NO_ENCONTRADA');

  const values = sh.getDataRange().getValues();
  if (!values.length) throw new Error('REGISTRO_NO_ENCONTRADO');

  const headers = values[0].map(String);
  const idCol = headers.indexOf('id');
  const pdfCol = headers.indexOf('pdfUrl');

  if (idCol < 0) throw new Error('COLUMNA_ID_NO_ENCONTRADA');

  let rowIndex = -1;
  let pdfUrl = '';

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol] || '') === targetId) {
      rowIndex = i + 1;
      if (pdfCol >= 0) pdfUrl = String(values[i][pdfCol] || '');
      break;
    }
  }

  if (rowIndex < 0) throw new Error('REGISTRO_NO_ENCONTRADO');

  sh.deleteRow(rowIndex);

  if (pdfUrl) {
    try {
      const m = pdfUrl.match(/\/d\/([A-Za-z0-9_-]+)/) || pdfUrl.match(/[?&]id=([A-Za-z0-9_-]+)/);
      if (m && m[1]) {
        DriveApp.getFileById(m[1]).setTrashed(true);
      }
    } catch (_) {}
  }

  return {ok:true, id:targetId};
}

function extractTasaAseo(payload) {
  payload = payload || {};

  const key = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY no está configurada.');

  const model = PropertiesService.getScriptProperties().getProperty('OPENAI_MODEL') || 'gpt-5.6-luna';
  const content = [{
    type: 'input_text',
    text: buildTasaAseoPrompt_()
  }];

  if (payload.dataUrl) {
    const mime = String(payload.mimeType || '').toLowerCase();

    if (mime === 'application/pdf' || /\.pdf$/i.test(String(payload.fileName || ''))) {
      content.push({
        type: 'input_file',
        file_data: String(payload.dataUrl),
        filename: payload.fileName || 'certificacion_tasa_aseo.pdf',
        detail: 'high'
      });
    } else if (mime.indexOf('image/') === 0) {
      content.push({
        type: 'input_image',
        image_url: String(payload.dataUrl),
        detail: 'high'
      });
    }
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      numeroDocumento: {type:'string'},
      fechaEmision: {type:'string'},
      nombreEvento: {type:'string'},
      fechaEvento: {type:'string'},
      horaInicio: {type:'string'},
      horaFin: {type:'string'},
      lugar: {type:'string'},
      aforo: {type:'string'},
      organizador: {type:'string'},
      identificacion: {type:'string'},
      tasaPagada: {type:'string'},
      cronograma: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            fase: {type:'string'},
            fecha: {type:'string'},
            inicio: {type:'string'},
            fin: {type:'string'}
          },
          required: ['fase','fecha','inicio','fin']
        }
      }
    },
    required: [
      'numeroDocumento',
      'fechaEmision',
      'nombreEvento',
      'fechaEvento',
      'horaInicio',
      'horaFin',
      'lugar',
      'aforo',
      'organizador',
      'identificacion',
      'tasaPagada',
      'cronograma'
    ]
  };

  const body = {
    model: model,
    input: [{role:'user', content:content}],
    text: {
      format: {
        type: 'json_schema',
        name: 'evento_tasa_aseo',
        strict: true,
        schema: schema
      }
    }
  };

  const resp = UrlFetchApp.fetch('https://api.openai.com/v1/responses', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {Authorization:'Bearer ' + key},
    payload: JSON.stringify(body)
  });

  const code = resp.getResponseCode();
  const txt = resp.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error('Error de IA (' + code + '): ' + txt.slice(0,500));
  }

  const json = JSON.parse(txt);
  const out = extractResponseText_(json);

  if (!out) throw new Error('La IA no devolvió datos estructurados.');

  const parsed = JSON.parse(out);

  parsed.fechaEmision = normalizeTasaDate_(parsed.fechaEmision);
  parsed.fechaEvento = normalizeTasaDate_(parsed.fechaEvento);
  parsed.horaInicio = normalizeTasaTime_(parsed.horaInicio);
  parsed.horaFin = normalizeTasaTime_(parsed.horaFin);

  if (!Array.isArray(parsed.cronograma)) parsed.cronograma = [];
  parsed.cronograma = parsed.cronograma.map(function(c){
    return {
      fase: String(c && c.fase || '').trim(),
      fecha: normalizeTasaDate_(c && c.fecha),
      inicio: normalizeTasaTime_(c && c.inicio),
      fin: normalizeTasaTime_(c && c.fin)
    };
  });

  return parsed;
}

function buildTasaAseoPrompt_() {
  return [
    'Analiza una CERTIFICACIÓN DE TASA DE ASEO emitida por la Dirección de Higiene y Salubridad de Manta.',
    'Extrae únicamente datos del evento y del documento.',
    '',
    'REGLAS OBLIGATORIAS:',
    '1. numeroDocumento: extrae el número que figure en la cabecera como Oficio Nro., Memorando Nro. o equivalente. No inventes.',
    '2. fechaEmision: fecha de emisión del documento en formato YYYY-MM-DD.',
    '3. nombreEvento: devuelve SOLO el nombre propio del evento. Elimina frases como "CERTIFICACIÓN DE TASA DE ASEO PARA EL PLAN DE CONTINGENCIA DEL EVENTO".',
    '4. NO devuelvas ni clasifiques si el evento es con fines o sin fines de lucro.',
    '5. organizador: nombre completo de la persona organizadora o responsable.',
    '6. identificacion: cédula o identificación del organizador tal como aparece en el documento.',
    '7. lugar: conserva la descripción útil del sitio donde se realizará el evento.',
    '8. aforo: devuelve solo la cantidad indicada, sin inventar.',
    '9. fechaEvento, horaInicio y horaFin corresponden a la fase real de INICIO Y FINALIZACIÓN DEL EVENTO, no al montaje, preparación ni reacondicionamiento.',
    '10. Las fechas deben ir en YYYY-MM-DD y las horas en HH:MM de 24 horas. Si el documento dice 24H00, devuelve 24:00.',
    '11. cronograma: incluye TODAS las fases que figuren en la tabla (montaje, preparación, evento, reacondicionamiento u otras), cada una con su fecha, inicio y fin.',
    '12. tasaPagada: ESTE CAMPO ES ESPECIAL. Devuelve un valor únicamente cuando el documento indique de manera expresa que la tasa de aseo YA FUE PAGADA, CANCELADA o existe constancia inequívoca de pago. Si el documento solo dice "valor a cancelar", establece un valor, dice USD $0,00, tasa cero o no confirma pago efectivo, devuelve cadena vacía.',
    '13. Si un dato no aparece, devuelve cadena vacía. No infieras ni inventes información.',
    '14. Ignora membretes, saludos, firmas, copias, cargos institucionales, fundamentos jurídicos y texto protocolario que no forme parte de los campos solicitados.'
  ].join('\n');
}

function normalizeTasaDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, AH.TZ, 'yyyy-MM-dd');
  }

  const s = String(value || '').trim();
  if (!s) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (m) {
    return m[3] + '-' + String(m[2]).padStart(2,'0') + '-' + String(m[1]).padStart(2,'0');
  }

  return s;
}

function normalizeTasaTime_(value) {
  const s = String(value || '').trim().toUpperCase();
  if (!s) return '';

  const m = s.match(/^(\d{1,2})(?:[:H\.])(\d{2})$/);
  if (!m) return s;

  const h = Number(m[1]);
  const min = Number(m[2]);

  if (h === 24 && min === 0) return '24:00';
  if (h < 0 || h > 23 || min < 0 || min > 59) return s;

  return String(h).padStart(2,'0') + ':' + String(min).padStart(2,'0');
}

function getTasaAseoFolder_() {
  const cfg = getConfig_();

  if (cfg.TASA_ASEO_FOLDER_ID) {
    try {
      return DriveApp.getFolderById(cfg.TASA_ASEO_FOLDER_ID);
    } catch (_) {}
  }

  const name = 'Agenda Higiene - Certificaciones Tasa de Aseo';
  const it = DriveApp.getFoldersByName(name);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(name);

  setConfigValue_('TASA_ASEO_FOLDER_ID', folder.getId());
  return folder;
}
