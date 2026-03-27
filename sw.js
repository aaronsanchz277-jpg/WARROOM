// =============================================
// WARROOM v3.0 — Service Worker
// Cache, notificaciones push, validación 7/30d
// =============================================

const CACHE_NAME = 'warroom-v3.0';
const CACHE_ASSETS = [
  '/index.html',
  '/manifest.json'
];

// ─── INSTALL ───
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

// ─── ACTIVATE ───
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// ─── FETCH — Network first, cache fallback ───
self.addEventListener('fetch', (event) => {
  // Solo cachear requests propios
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clone);
        });
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// ─── PUSH NOTIFICATIONS ───
self.addEventListener('push', (event) => {
  let data = { titulo: 'WARROOM', cuerpo: 'Nueva alerta', caso: 'INFO' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.cuerpo = event.data.text();
    }
  }

  const iconColor = data.caso === 'A' ? '🟢' : data.caso === 'B' ? '🟡' : data.caso === 'C' ? '🟠' : '🔴';

  const options = {
    body: `${iconColor} ${data.cuerpo}`,
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="15" fill="%230a0a0f"/><text x="50" y="68" font-size="55" text-anchor="middle" fill="%2300ff88">⚔</text></svg>',
    badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%2300ff88"/></svg>',
    vibrate: [200, 100, 200],
    tag: data.activo || 'warroom-general',
    renotify: true,
    data: { url: '/index.html', activo: data.activo },
    actions: [
      { action: 'ver', title: 'Ver análisis' },
      { action: 'cerrar', title: 'Cerrar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.titulo || 'WARROOM', options)
  );
});

// ─── NOTIFICATION CLICK ───
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'cerrar') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/index.html') && 'focus' in client) {
          client.focus();
          client.postMessage({
            tipo: 'ABRIR_ANALISIS',
            activo: event.notification.data?.activo
          });
          return;
        }
      }
      return clients.openWindow('/index.html');
    })
  );
});

// ─── MESSAGE — Recibir comandos desde index.html ───
self.addEventListener('message', (event) => {
  const { tipo, payload } = event.data || {};

  switch (tipo) {
    case 'PROGRAMAR_VALIDACION':
      // Programar verificación a 7 y 30 días
      programarValidacion(payload);
      break;
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
  }
});

// ─── VALIDACIÓN PROGRAMADA ───
// Usa el periodic sync API si está disponible,
// sino se maneja desde el cliente con setInterval
function programarValidacion(payload) {
  // Guardar en IndexedDB las validaciones pendientes
  const request = indexedDB.open('warroom_sw', 1);

  request.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains('validaciones_pendientes')) {
      db.createObjectStore('validaciones_pendientes', { keyPath: 'id' });
    }
  };

  request.onsuccess = (e) => {
    const db = e.target.result;
    const tx = db.transaction('validaciones_pendientes', 'readwrite');
    const store = tx.objectStore('validaciones_pendientes');

    store.put({
      id: payload.analisis_id,
      activo: payload.activo,
      tipo_activo: payload.tipo_activo,
      precio_entrada: payload.precio_entrada,
      fecha_analisis: new Date().toISOString(),
      fecha_validacion_7d: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      fecha_validacion_30d: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      validado_7d: false,
      validado_30d: false
    });
  };
}

// ─── PERIODIC BACKGROUND SYNC ───
// Para validaciones automáticas (requiere permiso del browser)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'warroom-validacion') {
    event.waitUntil(ejecutarValidacionesPendientes());
  }
});

async function ejecutarValidacionesPendientes() {
  // Este código notifica al cliente que hay validaciones pendientes
  const allClients = await clients.matchAll({ type: 'window' });
  for (const client of allClients) {
    client.postMessage({ tipo: 'EJECUTAR_VALIDACIONES' });
  }
}
