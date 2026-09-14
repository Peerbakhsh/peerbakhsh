/* =========================================================
   KAROBAR HISAAB — SERVICE WORKER
   Maqsad: is app ko GitHub Pages (ya kisi bhi hosting) URL se
   ek baar internet ke sath khol lene ke baad, offline mein bhi
   usi URL se khulne dena.

   Data (hisaab, products, bills waghera) is cache se bilkul alag
   hai — wo hamesha localStorage/IndexedDB aur Firebase mein hi
   save hota hai. Ye service worker sirf app ki files (HTML/CSS/JS)
   ko offline available rakhta hai.
========================================================= */

const CACHE_NAME = "karobar-hisaab-shell-v1";

/* App shell — jo files offline chalne ke liye chahiye.
   "./" aur "./Personal.html" dono add kiye hain taake chahe URL
   root se khule ya filename ke sath, dono surat mein kaam kare. */
const APP_SHELL = [
  "./",
  "./Personal.html",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        APP_SHELL.map((url) =>
          fetch(url)
            .then((res) => {
              if (res && res.ok) return cache.put(url, res.clone());
            })
            .catch(() => {
              /* Is waqt file na milay (misal: 404 ya path farq) to
                 baaki files cache hoti rahen, poora install fail na ho. */
            })
        )
      );
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* Network-first, cache-fallback:
   - Internet ho to hamesha sabse nayi/updated file milti hai (aur cache
     bhi refresh ho jata hai).
   - Internet na ho to jo pichli baar cache hui thi wo mil jati hai. */
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.ok) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match("./Personal.html"))
      )
  );
});
