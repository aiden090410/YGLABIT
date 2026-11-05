/**
 * LABIT - Service Worker (v1.0.0)
 * 상대 경로 기반 캐스케이딩 캐싱 & 오프라인 지원
 */

const CACHE_NAME = 'labit-static-v3';
const OFFLINE_URL = './offline.html';

// 캐싱할 정적 파일 목록 (상대 경로 적용)
const STATIC_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './manifest.json',
  './assets/css/style.css',
  './assets/js/config.js',
  './assets/js/api.js',
  './assets/js/app.js'
];

// 1. Install Event: 정적 리소스 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate Event: 구버전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Event: 네트워크 우선, 실패 시 캐시/오프라인 화면 반환
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // POST 요청, GAS API, Auth 인증 요청 등 민감 데이터는 절대로 공용 캐시에 저장하지 않음
  if (request.method !== 'GET' || request.url.includes('script.google.com') || request.url.includes('oauth2')) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // 성공적인 네트워크 응답은 캐시에 업데이트
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        // 네트워크 단절 시 캐시 검색
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }

        // HTML 페이지 요청인데 캐시에도 없는 경우 오프라인 fallback 페이지 반환
        if (request.mode === 'navigate') {
          const offlineCache = await caches.match(OFFLINE_URL);
          if (offlineCache) {
            return offlineCache;
          }
        }
      })
  );
});
