/* =========================================================
   KAROBAR HISAAB — SERVICE WORKER
   Maqsad: is app ko GitHub Pages (ya kisi bhi hosting) URL se
   ek baar internet ke sath khol lene ke baad, offline mein bhi
   usi URL se khulne dena.

   Data (hisaab, products, bills waghera) is cache se bilkul alag
   hai — wo hamesha localStorage/IndexedDB aur Firebase mein hi
   save hota hai. Ye service worker sirf app ki files (HTML/CSS/JS)
   ko offline available rakhta hai.

   NOTE: Ye version file ka naam hardcode NAHI karta (pehle
   "Personal.html" hardcoded tha, jo asal filename se match nahi
   karta tha aur is wajah se offline kaam nahi kar raha tha).
   Iski jagah, jab bhi page khud ko register karta hai, wo apna
   asal URL (chahe jo bhi naam ho) seedha cache mein daal deta
   hai — is se filename ka koi farq nahi parta.
========================================================= */

const CACHE_NAME = "karobar-hisaab-shell-v2";

/* App shell — sirf wo files jo har hosting setup mein tay hain.
   Asal HTML file (chahe jo naam ho) page ke apne registration
   code se khud add hoti hai. */
const APP_SHELL = [
  "./",
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

/* Page se ek chhota message: "abhi is URL par ho" — taake asal
   HTML file ka URL bhi (chahe jo filename ho) shell cache mein
   pakka save ho jaye. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CACHE_URL" && event.data.url) {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) =>
        fetch(event.data.url)
          .then((res) => { if (res && res.ok) return cache.put(event.data.url, res.clone()); })
          .catch(() => {})
      )
    );
  }
});

/* Network-first, cache-fallback:
   - Internet ho to hamesha sabse nayi/updated file milti hai (aur cache
     bhi refresh ho jati hai).
   - Internet na ho to jo pichli baar cache hui thi wo mil jati hai.
   - Agar exact URL cache mein na mile (misal: navigation kisi thora
     alag URL se hui) aur ye ek page-navigation request hai, to cache
     mein jo bhi HTML page mojood hai wo de dete hain — filename farq
     hone ke bawajood app offline khul jaye. */
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
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === "navigate" || event.request.destination === "document") {
            return caches.open(CACHE_NAME).then((cache) =>
              cache.keys().then((keys) => {
                const htmlKey =
                  keys.find((k) => k.url.endsWith(".html")) ||
                  keys.find((k) => k.url.endsWith("/"));
                return htmlKey ? cache.match(htmlKey) : undefined;
              })
            );
          }
          return undefined;
        })
      )
  );
});
