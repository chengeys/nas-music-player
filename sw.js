/* 知行音乐 Service Worker v1 */
const CACHE = "zmusic-v70";
// 注意：catalog.js 不预缓存（走网络优先），避免大文件导致安装失败
const SHELL = ["./","./index.html","./style.css?v=9.44","./app.js?v=9.44","./cloud.js?v=9.44","./manifest.json","./icon.svg"];

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
const SW_TOKEN = "44cfc15c832bcbb1fe205427f728f001"; // 门禁令牌与 app.js 同值，SW 预置（v9.25 知行建议）：媒体请求不再等凭据送达
let DAV_TOKEN = SW_TOKEN;
async function getCreds(){
  if(DAV_AUTH) return {auth:DAV_AUTH, token:""};
  DAV_AUTH = await idbGetAuth();
  if(DAV_AUTH) return {auth:DAV_AUTH, token:""};
  return {auth:"", token:SW_TOKEN}; // 令牌预置：零等待（v9.25）
}
self.addEventListener("message", e=>{
  if(e.data && e.data.type==="SET_AUTH"){
    if(e.data.auth){ DAV_AUTH=e.data.auth; idbSetAuth(DAV_AUTH); }
    else { DAV_AUTH=""; idbSetAuth(""); } // 页面切回令牌模式：清掉自填凭据，令牌用预置常量
  }
});
self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(
    ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
function davNote(info){
  try{ self.clients.matchAll({type:"window"}).then(cs=>cs.forEach(c=>c.postMessage({type:"DIAG", info}))).catch(()=>{}); }catch(e){}
}
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
        if(r.status===401 && cred.auth){
          // 自填凭据可能刚改过：从持久化重读一次再试（令牌模式 401 是服务器端作废，不重试）
          const sa=await idbGetAuth();
          if(sa && sa!==cred.auth){ DAV_AUTH=sa; r = await send({auth:sa, token:""}); }
        }
        if(r.status>=400) davNote(r.status + " " + u.pathname.split("/").slice(-1)[0]);
        return r;
      }catch(err){ davNote("NETERR " + u.pathname.split("/").slice(-1)[0]); return fetch(e.request); }
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
