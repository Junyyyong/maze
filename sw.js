/* Paper Shelf 서비스 워커
   - 앱 셸(html/css/js)은 network-first: 온라인이면 항상 최신 코드를 받고,
     오프라인일 때만 캐시로 폴백한다. (배포 후 핸드폰이 옛 코드를 쓰는 문제 방지)
   - 용량 큰 PDF.js 라이브러리는 cache-first로 빠르게 로드한다. */
const CACHE = 'paper-shelf-v18';

const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
];
const VENDOR = [
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/ort.wasm.min.js',
  // doclaynet-yolo.onnx / ort-wasm-simd-threaded.wasm are large (11MB each)
  // → cached on-demand by the cache-first fetch handler
];

// 항상 최신으로 받아야 하는 앱 셸 경로 판별
function isShell(url) {
  const p = url.pathname;
  return p.endsWith('/') ||
         p.endsWith('/index.html') ||
         p.endsWith('/style.css') ||
         p.endsWith('/app.js') ||
         p.endsWith('/manifest.json');
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll([...SHELL, ...VENDOR]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // 앱 셸(또는 페이지 내비게이션): network-first → 항상 최신 코드 반영
  if (sameOrigin && (req.mode === 'navigate' || isShell(url))) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // 그 외(PDF.js 등): cache-first
  e.respondWith(
    caches.match(req).then(cached =>
      cached ||
      fetch(req).then(res => {
        if (res.ok && sameOrigin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
    )
  );
});
