/* Karobar Hisaab — service worker (network-first: naya version hamesha pehle, internet na ho to purani copy) */
const CACHE="karobar-hisaab-shell-v3";
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

/* =========================================================
   BACKGROUND SYNC — app band ho tab bhi net aate hi data Firebase + Google Sheet par.
   Android Chrome / installed app par chalta hai (iPhone par nahi). Chrome apni marzi ke waqt
   (aam tor par net aane ke chand second se 1-2 minute mein) ye event chalata hai.
   Safety: Firebase par SIRF tab likhta hai jab cloud par kisi aur device ne kuch na badla ho
   (lastModifiedAt wahi ho jo is device ne aakhri baar dekha). Warna kuch overwrite nahi karta,
   sirf notification deta hai ke app khol kar merge karein.
========================================================= */
const BG_DB="KarobarHisaabOffline_v1", BG_STORE="snapshots";
function bgOpen(){return new Promise((res,rej)=>{const r=indexedDB.open(BG_DB,1);
  r.onupgradeneeded=()=>{try{if(!r.result.objectStoreNames.contains(BG_STORE))r.result.createObjectStore(BG_STORE,{keyPath:"id"});}catch(e){}};
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
function bgGet(db,id){return new Promise(res=>{try{const q=db.transaction(BG_STORE,"readonly").objectStore(BG_STORE).get(id);
  q.onsuccess=()=>res(q.result||null);q.onerror=()=>res(null);}catch(e){res(null);}});}
function bgPut(db,row){return new Promise(res=>{try{const tx=db.transaction(BG_STORE,"readwrite");tx.objectStore(BG_STORE).put(row);
  tx.oncomplete=()=>res(true);tx.onerror=tx.onabort=()=>res(false);}catch(e){res(false);}});}

async function bgFetchWithTimeout(url,opt,ms){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),ms||25000);
  try{return await fetch(url,Object.assign({},opt,{signal:c.signal}));}finally{clearTimeout(t);}
}
async function bgToken(meta){
  try{
    const r=await bgFetchWithTimeout("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key="+encodeURIComponent(meta.apiKey),
      {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({returnSecureToken:true})},20000);
    const d=await r.json().catch(()=>({}));
    return (r.ok&&d.idToken)?d.idToken:"";
  }catch(e){return "";}
}
async function bgFb(meta,token,method,path,body){
  const mk=tk=>meta.fbUrl.replace(/\/$/,"")+"/"+path+".json"+(tk?"?auth="+encodeURIComponent(tk):"");
  const opt={method,headers:{"Content-Type":"application/json"}};
  if(body!==undefined)opt.body=body;
  let r=await bgFetchWithTimeout(mk(token),opt);
  if(!r.ok&&token&&(r.status===401||r.status===403))r=await bgFetchWithTimeout(mk(""),opt);
  return r;
}

/* return true agar app kholna zaroori hai (cloud par doosre device ne badlav kiya) */
async function bgPushFirebase(db,meta){
  const latest=await bgGet(db,"latest");
  if(!latest||!latest.pendingSync||!latest.data)return false;
  let snap;try{snap=JSON.parse(latest.data);}catch(e){return false;}
  const myStamp=Number(snap&&snap.lastModifiedAt||0);
  const sw=(await bgGet(db,"bg_sw"))||{id:"bg_sw"};
  const pushed=Number(sw.pushedStamp||0);
  if(myStamp&&myStamp===pushed)return false;              /* ye snapshot pehle hi cloud par ja chuka */
  const base=Number(meta.baseStamp||0);
  if(!(base>0))return true;                               /* is device ne cloud kabhi confirm nahi kiya: app se hi hoga */
  const token=await bgToken(meta);
  const r=await bgFb(meta,token,"GET",meta.key+"/lastModifiedAt");
  if(!r.ok)throw new Error("Firebase stamp HTTP "+r.status);
  const cs=Number(await r.json());
  if(!(cs===base||(pushed&&cs===pushed)))return true;     /* cloud badal chuka — overwrite nahi karna */
  const w=await bgFb(meta,token,"PUT",meta.key,latest.data);
  if(!w.ok)throw new Error("Firebase write HTTP "+w.status);
  sw.pushedStamp=myStamp;sw.at=Date.now();
  await bgPut(db,sw);
  return false;
}

async function bgPushGoogle(db,meta){
  if(!meta.googleUrl)return;
  const qrow=await bgGet(db,"bg_google_queue");
  const sentRow=(await bgGet(db,"bg_google_sent"))||{id:"bg_google_sent",seqs:[]};
  const sent=new Set(sentRow.seqs||[]);
  let q=((qrow&&qrow.queue)||[]).filter(p=>p&&!sent.has(p.seq));
  const post=async packet=>{
    const r=await bgFetchWithTimeout(meta.googleUrl,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify({action:"append",sheetName:"Karobar Backup",packet:packet})},25000);
    const t=await r.text();let d={};try{d=JSON.parse(t||"{}");}catch(e){}
    if(!r.ok||d.ok===false)throw new Error(d.error||("Google HTTP "+r.status));
  };
  while(q.length){
    let batch=[],bytes=0;
    for(const p of q){const sz=JSON.stringify(p).length;if(batch.length&&(batch.length>=25||bytes+sz>350000))break;batch.push(p);bytes+=sz;}
    const last=batch[batch.length-1];
    const merged=batch.length===1?batch[0]:{seq:last.seq,savedAt:last.savedAt,entryId:last.entryId,
      changes:[].concat.apply([],batch.map(p=>Array.isArray(p.changes)?p.changes:[]))};
    let done=batch;
    try{await post(merged);}
    catch(e){if(batch.length<=1)throw e;await post(batch[0]);done=[batch[0]];}
    done.forEach(p=>sent.add(p.seq));
    sentRow.seqs=Array.from(sent);
    await bgPut(db,sentRow);                              /* har batch ke baad likho taake duplicate na ho */
    const ds=new Set(done.map(p=>p.seq));
    q=q.filter(p=>!ds.has(p.seq));
  }
}

async function bgSync(){
  const cl=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  if(cl.some(c=>c.visibilityState==="visible")){        /* app khuli hai: wahi sync karegi */
    cl.forEach(c=>c.postMessage({type:"BG_SYNC_NOW"}));
    return;
  }
  const db=await bgOpen();
  const meta=await bgGet(db,"bg_meta");
  if(!meta||!meta.key||!meta.fbUrl)return;
  let needApp=false,err=null;
  try{needApp=await bgPushFirebase(db,meta);}catch(e){err=e;}
  try{await bgPushGoogle(db,meta);}catch(e){err=err||e;}
  try{db.close();}catch(e){}
  if(needApp){
    try{await self.registration.showNotification("Karobar Hisaab",{body:"Net aa gaya. Cloud par doosre device ka data bhi hai — sync ke liye app ek dafa kholein.",tag:"karobar-needs-app"});}catch(e){}
  }
  if(err)throw err;                                      /* Chrome khud dobara koshish karega */
}
self.addEventListener("sync",e=>{ if(e.tag==="karobar-sync")e.waitUntil(bgSync()); });
