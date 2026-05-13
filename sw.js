const CACHE_NAME = 'asysauto-v1';

// Instalación: saltar espera para activar cambios rápido
self.addEventListener('install', e => {
  self.skipWaiting();
});

// Activación: limpiar cachés viejos si los hubiera
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))));
});

// Estrategia: Red primero, si falla, nada (puedes mejorar esto luego)
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request));
});
