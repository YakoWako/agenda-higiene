(() => {
  if (!('serviceWorker' in navigator)) return;

  let registrationRef = null;
  let updateAccepted = false;

  const notice = () => document.getElementById('pwaUpdateNotice');
  const updateBtn = () => document.getElementById('pwaUpdateBtn');
  const dismissBtn = () => document.getElementById('pwaUpdateDismiss');

  function hideNotice() {
    notice()?.classList.remove('show');
  }

  function showNotice(registration) {
    registrationRef = registration;
    notice()?.classList.add('show');
  }

  window.addEventListener('load', async () => {
    updateBtn()?.addEventListener('click', () => {
      const waiting = registrationRef?.waiting;

      if (waiting) {
        updateAccepted = true;
        waiting.postMessage({ type: 'SKIP_WAITING' });
      } else {
        window.location.reload();
      }
    });

    dismissBtn()?.addEventListener('click', hideNotice);

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Solo recargar cuando el usuario aceptó expresamente una actualización.
      // Nunca recargar durante el lanzamiento inicial de la app instalada.
      if (updateAccepted) {
        window.location.reload();
      }
    });

    try {
      const registration = await navigator.serviceWorker.register(
        './service-worker.js',
        {
          scope: './',
          updateViaCache: 'none'
        }
      );

      registrationRef = registration;

      if (registration.waiting && navigator.serviceWorker.controller) {
        showNotice(registration);
      }

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener('statechange', () => {
          if (
            worker.state === 'installed' &&
            navigator.serviceWorker.controller &&
            registration.waiting
          ) {
            showNotice(registration);
          }
        });
      });

      // Comprobar actualizaciones al abrir y periódicamente.
      registration.update().catch(() => {});
      setInterval(() => {
        registration.update().catch(() => {});
      }, 60 * 60 * 1000);
    } catch (error) {
      console.warn('PWA: no se pudo registrar el service worker.', error);
    }
  });
})();
