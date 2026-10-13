const CACHE_PREFIX = 'agenda-higiene-static-';
const CACHE_NAME = CACHE_PREFIX + '2026-10-12-v2';
const BASE = '/agenda-higiene/';

const APP_SHELL = [
  BASE,
  BASE + 'index.html',
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
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.all(
        APP_SHELL.map(asset =>
          cache.add(new Request(asset, { cache: 'reload' })).catch(() => null)
        )
      );
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );

    if ('navigationPreload' in self.registration) {
      try {
        await self.registration.navigationPreload.enable();
      } catch (_) {}
    }

    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function fetchWithTimeout(request, ms = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);

  return fetch(request, {
    cache: 'no-store',
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));
}

async function navigationResponse(event) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const preload = await event.preloadResponse;
    if (preload) {
      cache.put(BASE, preload.clone()).catch(() => {});
      return preload;
    }

    const response = await fetchWithTimeout(event.request, 8000);

    if (response && response.ok && response.type === 'basic') {
      cache.put(BASE, response.clone()).catch(() => {});
    }

    return response;
  } catch (_) {
    return (
      await cache.match(BASE) ||
      await cache.match(BASE + 'index.html') ||
      Response.error()
    );
  }
}

async function staticResponse(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetchWithTimeout(request, 8000);

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

  // Nunca interceptar Google Apps Script, Drive ni ningún servicio externo.
  if (url.origin !== self.location.origin) return;

  // Mantener fuera del caché cualquier ruta de backend.
  if (url.pathname.includes('/backend/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(event));
    return;
  }

  const cacheableDestination = [
    'script',
    'style',
    'image',
    'font',
    'manifest'
  ].includes(request.destination);

  if (cacheableDestination) {
    event.respondWith(staticResponse(request));
  }
});
