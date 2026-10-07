/* 知行音乐 Service Worker v1 */
const CACHE = "zmusic-v12";
const SHELL = ["./","./index.html","./style.css","./app.js","./catalog.js","./manifest.json","./icon.svg"];

// NAS 认证头（由页面 postMessage 传入，存在内存）
let DAV_AUTH = "";
self.addEventListener("message", e=>{
  if(e.data && e.data.type==="SET_AUTH" && e.data.auth) DAV_AUTH = e.data.auth;
});
self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(
    ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", e=>{
  const u = new URL(e.request.url);
  // NAS 音频：注入认证头，支持 <audio> 流式直播
  if(u.hostname.endsWith("yjm.ccwu.cc") && u.pathname.startsWith("/dav/")){
    e.respondWith((async()=>{
      try{
        if(!DAV_AUTH) return fetch(e.request);
        const h = new Headers(e.request.headers);
        h.set("Authorization", DAV_AUTH);
        return fetch(new Request(e.request, {headers:h}));
      }catch(err){ return fetch(e.request); }
    })());
    return;
  }
  if(u.pathname.startsWith("/dav/")){
    return; // 其他 dav 路径直连
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
