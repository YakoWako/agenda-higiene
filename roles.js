(() => {
  'use strict';

  let role = 'LECTURA';

  function normalizeRole(value){
    const r = String(value || '').trim().toUpperCase();
    return ['ADMIN','EDITOR','LECTURA'].includes(r) ? r : 'LECTURA';
  }

  let applyingRole = false;

  function applyRole(){
    if (applyingRole) return;
    applyingRole = true;

    try {
      const canEdit = role === 'ADMIN' || role === 'EDITOR';
      const directory = document.querySelector('.nav button[data-view="directory"]');
      const register = document.querySelector('.nav button[data-view="register"]');

      [directory, register].forEach(btn => {
        if (!btn) return;

        const shouldDisable = !canEdit;
        const opacity = canEdit ? '' : '0.5';
        const cursor = canEdit ? 'pointer' : 'not-allowed';
        const title = canEdit ? '' : 'Acceso de solo lectura';

        if (btn.disabled !== shouldDisable) btn.disabled = shouldDisable;
        if (btn.style.opacity !== opacity) btn.style.opacity = opacity;
        if (btn.style.cursor !== cursor) btn.style.cursor = cursor;
        if (btn.title !== title) btn.title = title;
      });

      document.querySelectorAll('#reopenEventBtn').forEach(btn => {
        const display = role === 'ADMIN' ? '' : 'none';
        if (btn.style.display !== display) btn.style.display = display;
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

      const desiredText = 'Perfil: ' + role;

      if (label && label.textContent !== desiredText) {
        label.textContent = desiredText;
      }

    } finally {
      applyingRole = false;
    }
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

  const observer = new MutationObserver(mutations => {
    if (applyingRole) return;

    const relevant = mutations.some(mutation =>
      [...mutation.addedNodes].some(node =>
        node.nodeType === 1 &&
        (
          node.matches?.('#reopenEventBtn, #connectionState, .nav') ||
          node.querySelector?.('#reopenEventBtn, #connectionState, .nav')
        )
      )
    );

    if (relevant) applyRole();
  });

  observer.observe(document.body, {childList:true, subtree:true});

  window.addEventListener('load', () => {
    refreshRole();
    setTimeout(refreshRole, 1200);
  });
})();