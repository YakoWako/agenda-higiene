// Agenda Higiene - service worker mínimo y no intrusivo.
// No intercepta navegaciones, backend, formularios, evidencias ni credenciales.

self.addEventListener('install', () => {
  // En la primera instalación Chrome activará el worker normalmente.
  // En actualizaciones esperamos confirmación del usuario desde pwa.js.
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Se mantiene un listener de fetch para compatibilidad PWA,
// pero NO usa respondWith(), por lo que todas las solicitudes
// siguen siendo gestionadas directamente por el navegador.
self.addEventListener('fetch', () => {});
