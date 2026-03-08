// 定義快取版本和名稱
const CACHE_NAME = 'pmis-cache-v2'; // 增加版本號強制更新

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
  // 立即激活新版本
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('快取已開啟');
        return cache.addAll(urlsToCache);
      })
  );
});

// 檢查請求是否可緩存的輔助函數
function isRequestCacheable(request) {
  try {
    const url = new URL(request.url);
    return (url.protocol === 'http:' || url.protocol === 'https:') && 
           !request.url.includes('firestore.googleapis.com');
  } catch (error) {
    console.error('檢查請求協議時出錯:', error);
    return false;
  }
}

// 攔截網路請求
self.addEventListener('fetch', event => {
  // 檢查請求URL是否可緩存
  if (!isRequestCacheable(event.request)) {
    // 對於無法緩存的請求，直接返回不處理
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
        return fetch(event.request.clone())
          .then(networkResponse => {
            // 如果請求失敗，直接返回失敗
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            
            // 再次檢查請求協議，確保只緩存 http/https 請求
            if (isRequestCacheable(event.request)) {
              const responseToCache = networkResponse.clone();
              
              caches.open(CACHE_NAME)
                .then(cache => {
                  try {
                    cache.put(event.request, responseToCache);
                  } catch (error) {
                    console.error('緩存請求時出錯:', error);
                  }
                })
                .catch(error => {
                  console.error('開啟緩存時出錯:', error);
                });
            }
              
            return networkResponse;
          })
          .catch(error => {
            console.error('獲取請求時出錯:', error);
            // 可以在這裡返回自定義的離線頁面
            return new Response('網絡請求失敗，請檢查網絡連接');
          });
      })
  );
});

// 激活 Service Worker，清理舊緩存
self.addEventListener('activate', event => {
  // 立即接管頁面
  clients.claim();
  
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