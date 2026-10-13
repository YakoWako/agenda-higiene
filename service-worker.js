const CACHE_PREFIX = 'agenda-higiene-static-';
const CACHE_NAME = CACHE_PREFIX + '2026-10-12-v1';

const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './api.js',
  './config.js',
  './tasa.js',
  './alcaldia.js',
  './roles.js',
  './manifest.webmanifest',
  './icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
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

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request, { cache: 'no-store' });

    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {});
    }

    return response;
  } catch (_) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }

    throw _;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // No intervenir en Google Apps Script, Google Drive ni otros servicios externos.
  if (url.origin !== self.location.origin) return;

  // No cachear rutas que puedan corresponder a recursos internos o de backend.
  if (url.pathname.includes('/backend/')) return;

  const cacheableDestination = [
    'document',
    'script',
    'style',
    'image',
    'font',
    'manifest'
  ].includes(request.destination);

  if (request.mode === 'navigate' || cacheableDestination) {
    event.respondWith(networkFirst(request));
  }
});
