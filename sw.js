/* 知行音乐 Service Worker v1 */
const CACHE = "zmusic-v5";
const SHELL = ["./","./index.html","./style.css","./app.js","./catalog.js","./manifest.json","./icon.svg"];
self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(
    ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", e=>{
  const u = new URL(e.request.url);
  if(u.pathname.startsWith("/dav/") || u.hostname.includes("yjm.ccwu.cc")){
    return; // NAS 音频直连，不缓存
  }
  // 曲库每次走网络拿最新，失败回退缓存
  if(u.pathname.endsWith("catalog.js")){
    e.respondWith(
      fetch(e.request).then(r=>{
        if(r.ok){ const cp=r.clone();
          caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{}); }
        return r;
      }).catch(()=>caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{
      if(!r.ok) return r;
      const cp=r.clone();
      caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{});
      return r;
    }).catch(()=>caches.match("./index.html")))
  );
});
