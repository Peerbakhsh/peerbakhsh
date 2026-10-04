/* Karobar Hisaab — service worker (network-first: naya version hamesha pehle, internet na ho to purani copy) */
const CACHE="karobar-hisaab-shell-v2";
self.addEventListener("install",e=>{self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(self.clients.claim());});
self.addEventListener("message",e=>{
  const d=e.data||{};
  if(d.type==="CACHE_URL"&&d.url){e.waitUntil(caches.open(CACHE).then(c=>c.add(d.url)).catch(()=>{}));}
});
self.addEventListener("fetch",e=>{
  const req=e.request;
  if(req.method!=="GET")return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;        /* Firebase / Google ko haath nahi lagana */
  e.respondWith(
    fetch(req).then(res=>{
      if(res&&res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});}
      return res;
    }).catch(()=>caches.match(req,{ignoreSearch:true}).then(r=>r||caches.match("./")))
  );
});
