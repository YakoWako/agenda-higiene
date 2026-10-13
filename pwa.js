(() => {
  if (!('serviceWorker' in navigator)) return;

  let reloading = false;
  let activeRegistration = null;

  const notice = () => document.getElementById('pwaUpdateNotice');
  const updateBtn = () => document.getElementById('pwaUpdateBtn');
  const dismissBtn = () => document.getElementById('pwaUpdateDismiss');

  function hideNotice() {
    notice()?.classList.remove('show');
  }

  function showNotice(registration) {
    activeRegistration = registration;
    notice()?.classList.add('show');
  }

  function bindUpdateControls() {
    updateBtn()?.addEventListener('click', () => {
      const waiting = activeRegistration?.waiting;
      if (waiting) {
        waiting.postMessage({ type: 'SKIP_WAITING' });
      } else {
        window.location.reload();
      }
    });

    dismissBtn()?.addEventListener('click', hideNotice);
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    bindUpdateControls();

    try {
      const registration = await navigator.serviceWorker.register(
        './service-worker.js',
        {
          scope: './',
          updateViaCache: 'none'
        }
      );

      if (registration.waiting && navigator.serviceWorker.controller) {
        showNotice(registration);
      }

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener('statechange', () => {
          if (
            worker.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            showNotice(registration);
          }
        });
      });

      // Comprueba nuevas versiones sin obligar a reinstalar la PWA.
      setInterval(() => {
        registration.update().catch(() => {});
      }, 60 * 60 * 1000);

      registration.update().catch(() => {});
    } catch (error) {
      console.warn('PWA: no se pudo registrar el service worker.', error);
    }
  });
})();
