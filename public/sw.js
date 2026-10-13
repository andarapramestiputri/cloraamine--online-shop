/* Service worker Cloraamine — cache aset statis, jaringan dulu untuk halaman & API. */
// Versi cache dinaikkan tiap kali aset diubah agar perubahan JS/CSS
// langsung terpakai (cache lama dibuang saat aktivasi).
const CACHE = 'cloraamine-v2';
const ASET = [
  '/css/style.css',
  '/js/util.js',
  '/manifest.json',
  '/img/ikon-192.png',
  '/img/ikon-512.png',
  '/img/placeholder-photocard.svg',
  '/img/placeholder-album.svg',
  '/img/placeholder-merch.svg',
  '/img/placeholder-stiker.svg',
  '/img/placeholder-pin.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASET)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API dan unggahan selalu dari jaringan
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/') || e.request.method !== 'GET') {
    return;
  }
  // Halaman: jaringan dulu, cadangan dari cache bila offline
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const salinan = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, salinan));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // JS & CSS: jaringan dulu agar perubahan kode langsung terpakai;
  // bila gagal (offline), pakai cadangan cache.
  if (url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const salinan = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, salinan));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // Aset lain (gambar, manifest): cache dulu, lalu jaringan
  e.respondWith(
    caches.match(e.request).then(
      (ada) =>
        ada ||
        fetch(e.request).then((res) => {
          const salinan = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, salinan));
          return res;
        })
    )
  );
});
