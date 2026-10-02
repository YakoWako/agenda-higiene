(() => {
  'use strict';

  let role = 'LECTURA';

  function normalizeRole(value){
    const r = String(value || '').trim().toUpperCase();
    return ['ADMIN','EDITOR','LECTURA'].includes(r) ? r : 'LECTURA';
  }

  function applyRole(){
    const canEdit = role === 'ADMIN' || role === 'EDITOR';
    const directory = document.querySelector('.nav button[data-view="directory"]');
    const register = document.querySelector('.nav button[data-view="register"]');

    [directory, register].forEach(btn => {
      if (!btn) return;
      btn.disabled = !canEdit;
      btn.style.opacity = canEdit ? '' : '0.5';
      btn.style.cursor = canEdit ? 'pointer' : 'not-allowed';
      btn.title = canEdit ? '' : 'Acceso de solo lectura';
    });

    document.querySelectorAll('#reopenEventBtn').forEach(btn => {
      btn.style.display = role === 'ADMIN' ? '' : 'none';
    });

    let label = document.getElementById('connectionRole');
    if (!label) {
      const state = document.getElementById('connectionState');
      if (state) {
        label = document.createElement('div');
        label.id = 'connectionRole';
        label.className = 'hint';
        label.style.marginTop = '6px';
        label.style.fontWeight = '800';
        state.insertAdjacentElement('afterend', label);
      }
    }
    if (label) label.textContent = 'Perfil: ' + role;
  }

  async function refreshRole(){
    try {
      if (!window.AgendaApi?.isConfigured?.()) return;
      const ping = await window.AgendaApi.call('ping');
      role = normalizeRole(ping?.role);
      applyRole();
    } catch (_) {}
  }

  document.addEventListener('click', event => {
    const nav = event.target.closest('.nav button');
    if (nav && role === 'LECTURA' && ['directory','register'].includes(nav.dataset.view)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const reopen = event.target.closest('#reopenEventBtn');
    if (reopen && role !== 'ADMIN') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (event.target.closest('#saveConnection')) {
      setTimeout(refreshRole, 900);
    }

    if (event.target.closest('#clearConnection')) {
      role = 'LECTURA';
      setTimeout(applyRole, 50);
    }
  }, true);

  const observer = new MutationObserver(applyRole);
  observer.observe(document.documentElement, {childList:true, subtree:true});

  window.addEventListener('load', () => {
    refreshRole();
    setTimeout(refreshRole, 1200);
  });
})();