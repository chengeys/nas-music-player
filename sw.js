/* 知行音乐 Service Worker v1 */
const CACHE = "zmusic-v50";
// 注意：catalog.js 不预缓存（走网络优先），避免大文件导致安装失败
const SHELL = ["./","./index.html","./style.css?v=9.24","./app.js?v=9.24","./cloud.js?v=9.24","./manifest.json","./icon.svg"];

// NAS 认证头（由页面 postMessage 传入）
// v9.12 起同步持久化到 IndexedDB：SW 内存变量在 SW 被系统回收重启后会清零
// （iOS 锁屏/切后台时极常见），这正是"第一首能播、之后直链 401"的根源——
// 页面 fetch 自带认证头不受影响，所以会出现"测试连接正常、点歌被拒"。
let DAV_AUTH = "";
function idbOpen(){
  return new Promise(res=>{
    try{
      const rq=indexedDB.open("zmusic-auth",1);
      rq.onupgradeneeded=()=>{ try{ rq.result.createObjectStore("kv"); }catch(e){} };
      rq.onsuccess=()=>res(rq.result);
      rq.onerror=()=>res(null);
    }catch(e){ res(null); }
  });
}
async function idbGetKey(k){
  const db=await idbOpen(); if(!db) return "";
  return new Promise(res=>{
    try{
      const g=db.transaction("kv").objectStore("kv").get(k);
      g.onsuccess=()=>res(g.result||"");
      g.onerror=()=>res("");
    }catch(e){ res(""); }
  });
}
async function idbSetKey(k,v){
  const db=await idbOpen(); if(!db) return;
  try{ db.transaction("kv","readwrite").objectStore("kv").put(v,k); }catch(e){}
}
const idbGetAuth=()=>idbGetKey("davAuth");
const idbSetAuth=v=>idbSetKey("davAuth",v);
// 取凭据：内存优先，没有就从 IndexedDB 读回；仍为空时稍等再读一次，
// 兜住页面 SET_AUTH 消息与 <audio> 请求前后脚到达的竞态
let DAV_TOKEN = "";
let __credWaiters=[];
function __wakeCredWaiters(){ const w=__credWaiters; __credWaiters=[]; w.forEach(r=>r()); }
function __waitCred(ms){ return new Promise(res=>{ __credWaiters.push(res); setTimeout(res, ms); }); }
async function getCreds(){
  if(DAV_AUTH || DAV_TOKEN) return {auth:DAV_AUTH, token:DAV_TOKEN};
  DAV_AUTH=await idbGetAuth(); DAV_TOKEN=await idbGetKey("davToken");
  if(DAV_AUTH || DAV_TOKEN) return {auth:DAV_AUTH, token:DAV_TOKEN};
  // 冷启动竞态（v9.24 实测坐实）：SW 被媒体请求唤醒时页面的 SET_AUTH 可能还没送达，
  // 凭据为空就裸奔请求会被 NAS 以 401 拒绝、直链当场报错。改为等 SET_AUTH 到达（最长 2.5 秒）。
  await __waitCred(2500);
  if(DAV_AUTH || DAV_TOKEN) return {auth:DAV_AUTH, token:DAV_TOKEN};
  DAV_AUTH=await idbGetAuth(); DAV_TOKEN=await idbGetKey("davToken");
  return {auth:DAV_AUTH, token:DAV_TOKEN};
}
self.addEventListener("message", e=>{
  if(e.data && e.data.type==="SET_AUTH"){
    if(e.data.auth){ DAV_AUTH=e.data.auth; DAV_TOKEN=""; idbSetAuth(DAV_AUTH); idbSetKey("davToken",""); }
    else if(e.data.token){ DAV_TOKEN=e.data.token; DAV_AUTH=""; idbSetKey("davToken",DAV_TOKEN); idbSetAuth(""); }
    __wakeCredWaiters();
  }
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
  // NAS 音频：凡是 /dav/ 路径（老通道 yjm.ccwu.cc 或新直达 app.ipls.cn/dav）都注入认证头，支持 <audio> 流式直播
  if(u.pathname.startsWith("/dav/")){
    e.respondWith((async()=>{
      // 带认证发请求。关键坑（v9.13）：<audio> 直链是 no-cors 请求，
      // 克隆它再塞 Authorization 会被 fetch 规范静默过滤（CORS 安全清单外），
      // 表现就是"页面 fetch 能过、媒体请求必 401"。GET 一律改走 cors 模式重发。
      const send = async cred=>{
        const h = new Headers(e.request.headers);
        if(cred.auth) h.set("Authorization", cred.auth);
        else if(cred.token) h.set("X-App-Token", cred.token);
        if(e.request.method==="GET"){
          return fetch(e.request.url, {method:"GET", headers:h, mode:"cors", credentials:"omit", redirect:"follow"});
        }
        return fetch(new Request(e.request, {headers:h}));
      };
      try{
        const cred=await getCreds();
        if(!cred.auth && !cred.token) return fetch(e.request);
        let r = await send(cred);
        if(r.status===401){
          // 内存里的凭据可能已过期（如刚改过密码）：从持久化重读一次再试
          const sa=await idbGetAuth(), st=await idbGetKey("davToken");
          if((sa && sa!==cred.auth) || (st && st!==cred.token)){
            DAV_AUTH=sa; DAV_TOKEN=st;
            r = await send({auth:sa, token:st});
          } else {
            // 再等一封新的 SET_AUTH（页面每次点播都会重推凭据），变了就重试一次
            await __waitCred(1500);
            if((DAV_AUTH && DAV_AUTH!==cred.auth) || (DAV_TOKEN && DAV_TOKEN!==cred.token)){
              r = await send({auth:DAV_AUTH, token:DAV_TOKEN});
            }
          }
        }
        return r;
      }catch(err){ return fetch(e.request); }
    })());
    return;
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
