const CACHE_PREFIX = 'agenda-higiene-static-';
const CACHE_NAME = CACHE_PREFIX + '2026-10-13-v3';
const BASE = '/agenda-higiene/';

const STATIC_ASSETS = [
  BASE + 'app.js',
  BASE + 'api.js',
  BASE + 'config.js',
  BASE + 'tasa.js',
  BASE + 'alcaldia.js',
  BASE + 'roles.js',
  BASE + 'manifest.webmanifest',
  BASE + 'icon.svg',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
  BASE + 'icons/apple-touch-icon.png',
  BASE + 'icons/favicon-32.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.all(
        STATIC_ASSETS.map(asset =>
          cache.add(new Request(asset, { cache: 'reload' })).catch(() => null)
        )
      );
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function staticNetworkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request, { cache: 'no-store' });

    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {});
    }

    return response;
  } catch (_) {
    return (
      await cache.match(request, { ignoreSearch: true }) ||
      Response.error()
    );
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // MUY IMPORTANTE:
  // Las navegaciones/documentos se dejan completamente al navegador.
  // Así el service worker no puede bloquear el arranque desde el icono instalado.
  if (request.mode === 'navigate' || request.destination === 'document') return;

  // Nunca tocar Google Apps Script, Drive ni otros servicios externos.
  if (url.origin !== self.location.origin) return;

  // Mantener fuera del caché cualquier backend o recurso dinámico.
  if (url.pathname.includes('/backend/')) return;

  const cacheableDestination = [
    'script',
    'style',
    'image',
    'font',
    'manifest'
  ].includes(request.destination);

  if (cacheableDestination) {
    event.respondWith(staticNetworkFirst(request));
  }
});
