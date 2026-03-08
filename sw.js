// 定義快取版本和名稱
const CACHE_NAME = 'pmis-cache-v1';

// 需要離線快取的資源
const urlsToCache = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/defects.html',
  '/dailylog.html',
  '/workers.html',
  '/photos.html',
  '/css/style.css',
  '/js/main.js',
  '/js/firebase-config.js'
];

// 安裝 Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('快取已開啟');
        return cache.addAll(urlsToCache);
      })
  );
});

// 攔截網路請求
self.addEventListener('fetch', event => {
  // 對於 Firebase API 請求，我們不進行緩存
  if (event.request.url.includes('firestore.googleapis.com')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // 如果在緩存中找到匹配的資源，則返回緩存的版本
        if (response) {
          return response;
        }
        
        // 否則發出網路請求
        return fetch(event.request)
          .then(networkResponse => {
            // 如果請求失敗，直接返回失敗
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            
            // 將網路響應複製一份，存入快取
            const responseToCache = networkResponse.clone();
            
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
              
            return networkResponse;
          });
      })
  );
});

// 激活 Service Worker，清理舊緩存
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});