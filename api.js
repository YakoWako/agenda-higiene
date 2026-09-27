(() => {
  'use strict';
  const CFG = window.AGENDA_CONFIG || {};
  const URL_KEY = 'agendaHigiene.backendUrl';
  const ACCESS_KEY = 'agendaHigiene.accessKey';
  const pending = new Map();

  function configuredUrl(){ return (localStorage.getItem(URL_KEY) || CFG.backendUrl || '').trim(); }
  function configuredKey(){ return (localStorage.getItem(ACCESS_KEY) || '').trim(); }
  function normalizeUrl(url){
    url = String(url || '').trim();
    if (!url) return '';
    if (!/^https:\/\/script\.google\.com\/macros\/s\//i.test(url) || !/\/exec(?:\?.*)?$/i.test(url)) {
      throw new Error('La URL debe ser la del Web App de Apps Script y terminar en /exec.');
    }
    return url;
  }
  function configure(url,key){
    const u = normalizeUrl(url || CFG.backendUrl || '');
    if (!u) throw new Error('Falta la URL del backend.');
    if (!String(key || '').trim()) throw new Error('Falta la clave de acceso.');
    localStorage.setItem(URL_KEY,u);
    localStorage.setItem(ACCESS_KEY,String(key).trim());
    return true;
  }
  function clear(){ localStorage.removeItem(URL_KEY); localStorage.removeItem(ACCESS_KEY); }
  function isConfigured(){ return !!(configuredUrl() && configuredKey()); }

  window.addEventListener('message', ev => {
    const m = ev.data;
    if (!m || m.source !== 'agenda-higiene-backend' || !m.requestId) return;
    const p = pending.get(m.requestId);
    if (!p) return;
    pending.delete(m.requestId);
    clearTimeout(p.timer);
    try { p.iframe.remove(); p.form.remove(); } catch (_) {}
    if (m.ok) p.resolve(m.data);
    else p.reject(new Error(m.error || 'Error del backend.'));
  });

  function call(action, ...args){
    const url = configuredUrl();
    const key = configuredKey();
    if (!url) return Promise.reject(new Error('BACKEND_NO_CONFIGURADO'));
    if (!key) return Promise.reject(new Error('CLAVE_NO_CONFIGURADA'));
    const requestId = `REQ-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
    return new Promise((resolve,reject) => {
      const iframe = document.createElement('iframe');
      iframe.name = `agenda_transport_${requestId}`;
      iframe.style.display = 'none';
      iframe.setAttribute('aria-hidden','true');
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = url;
      form.target = iframe.name;
      form.style.display = 'none';
      const fields = {
        action,
        payload: JSON.stringify(args),
        requestId,
        origin: location.origin,
        accessKey: key
      };
      Object.entries(fields).forEach(([name,value]) => {
        const el = name === 'payload' ? document.createElement('textarea') : document.createElement('input');
        el.name = name;
        if (el.tagName === 'INPUT') el.type = 'hidden';
        el.value = String(value ?? '');
        el.style.display = 'none';
        form.appendChild(el);
      });
      document.body.appendChild(iframe);
      document.body.appendChild(form);
      const timer = setTimeout(() => {
        pending.delete(requestId);
        try { iframe.remove(); form.remove(); } catch (_) {}
        reject(new Error('El backend tardó demasiado en responder.'));
      }, 120000);
      pending.set(requestId,{resolve,reject,iframe,form,timer});
      form.submit();
    });
  }

  window.AgendaApi = {
    call, configure, clear, isConfigured,
    getBackendUrl: configuredUrl,
    getAccessKey: configuredKey
  };
})();
