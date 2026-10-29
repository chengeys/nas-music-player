/* 知行音乐 v1 — NAS 私有曲库播放器 */
"use strict";
const $ = id => document.getElementById(id);
const APP_VER = "v9.56 2026-10-29";

/* v9.43 换域名搬家：新地址带 #mv1=<base64> 打开时，先把旧地址带来的本地数据写入本域名（必须在读 cfg 前） */
(function(){ try{
  if(location.hash.indexOf("#mv1=")===0){
    const d=JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(5)))));
    const allow=["zmusic.cfg.v1","zmusic.fav.v1","zmusic.hist.v1","zmusic.search.v1","zmusic.sleep.v1","zmusic.cloud.token","zmusic.cloud.user"];
    let n=0; for(const k of allow){ if(typeof d[k]==="string"){ localStorage.setItem(k,d[k]); n++; } }
    history.replaceState(null,"",location.pathname+location.search);
    if(n) sessionStorage.setItem("zmusic.mvmsg","1");
  }
}catch(e){} })();

/* ---------- 配置 ---------- */
const CFG_KEY = "zmusic.cfg.v1";
function loadCfg(){
try{ return Object.assign({dav:"https://nas.yjm.ccwu.cc/dav",user:"",pass:""},
JSON.parse(localStorage.getItem(CFG_KEY)||"{}"));}
catch(e){ return {dav:"https://nas.yjm.ccwu.cc/dav",user:"",pass:""};}
}
let cfg = loadCfg();
function saveCfg(){ localStorage.setItem(CFG_KEY, JSON.stringify(cfg));}

/* ---------- 主题（v9.43）：auto 跟随系统（系统可按日落自动切换）/ light / dark，存 cfg.theme ---------- */
function effTheme(){
  const t=cfg.theme||"auto";
  if(t==="light"||t==="dark") return t;
  return (window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches)?"light":"dark";
}
function applyTheme(){
  const e=effTheme();
  document.documentElement.classList.toggle("light", e==="light");
  const m=document.querySelector('meta[name="theme-color"]');
  if(m) m.setAttribute("content", e==="light"?"#f4f3ef":"#101014");
  document.querySelectorAll("#themeRow button").forEach(b=>b.classList.toggle("on", b.dataset.theme===(cfg.theme||"auto")));
}
applyTheme();
if(window.matchMedia){ const mq=matchMedia("(prefers-color-scheme: light)"); const onMq=()=>{ if((cfg.theme||"auto")==="auto") applyTheme(); };
  if(mq.addEventListener) mq.addEventListener("change", onMq); }

/* ---------- 工具 ---------- */
function b64encodeUnicode(s){
const bytes = new TextEncoder().encode(s);
let bin = ""; bytes.forEach(b=>bin+=String.fromCharCode(b));
return btoa(bin);
}
function authHeader(){ return "Basic " + b64encodeUnicode(cfg.user+":"+cfg.pass);}
/* 门禁令牌（v9.22 服务器代管）：密码不进网页，由 app-portal 入口凭此令牌代为注入
   只读账号 music 的凭据。令牌可随时在服务器端作废重发，与 NAS 密码无关。
   设置里自填了密码则优先用自填账号，令牌不参与。 */
const APP_TOKEN = "44cfc15c832bcbb1fe205427f728f001";
function davHeaders(extra){
  const h = Object.assign({}, extra||{});
  if(cfg.pass) h.Authorization = authHeader();
  else h["X-App-Token"] = APP_TOKEN;
  return h;
}
/* 取歌通道：在 app.ipls.cn 域名下走本站 /dav 直达转发（经 Cloudflare 就近直达家里 NAS，
   不再绕香港那台服务器的反代）；其他域名仍用设置里填的地址。账号密码始终用设置里的 */
function davBase(){
if(location.hostname==="app.ipls.cn"||location.hostname==="mp3.ipls.cn") return location.origin+"/dav";
return cfg.dav.replace(/\/+$/,"");
}
function songUrl(song){
const base = davBase();
return base + song.p.split("/").map(encodeURIComponent).join("/");
}
function norm(s){
return (s||"").toLowerCase()
.replace(/[　\s\-_·•・,，.。、！？!?:：；;（）()\[\]《》""''～~×x×]/g,"")
.replace(/&amp;/g,"");
}
function fmtTime(sec){
if(!isFinite(sec)||sec<0) sec=0;
const m=Math.floor(sec/60), s=Math.floor(sec%60);
return m+":"+String(s).padStart(2,"0");
}
let toastTimer=null;
function toast(msg, cls="", ms=4000){
const el=$("toast"); el.textContent=msg; el.className=cls; el.style.display="flex"; // v9.44：毛玻璃药丸用 flex 排版（转圈 ::before）
clearTimeout(toastTimer);
if(ms>0) toastTimer=setTimeout(()=>{ el.style.display="none"; }, ms);
}
function hideToast(){ $("toast").style.display="none"; clearTimeout(toastTimer); }

/* ---------- ID3 歌词/封面解析 ---------- */
function decodeTextBytes(bytes, enc){
  try{
    if(enc===3) return new TextDecoder("utf-8").decode(bytes);
    if(enc===1) return new TextDecoder("utf-16").decode(bytes);
    if(enc===2) return new TextDecoder("utf-16be").decode(bytes);
  }catch(e){}
  let s=""; for(let i=0;i<bytes.length;i++) s+=String.fromCharCode(bytes[i]);
  return s;
}
function findTerm(bytes, enc, from){
  if(enc===1||enc===2){
    for(let i=from;i+1<bytes.length;i+=2) if(bytes[i]===0&&bytes[i+1]===0) return i;
    return -1;
  }
  for(let i=from;i<bytes.length;i++) if(bytes[i]===0) return i;
  return -1;
}
function parseID3(buf){
  const out={lyrics:null, coverUrl:null};
  try{
    const u8=new Uint8Array(buf);
    if(u8.length<10||u8[0]!==0x49||u8[1]!==0x44||u8[2]!==0x33) return out;
    const ver=u8[3];
    const sz=(u8[6]<<21)|(u8[7]<<14)|(u8[8]<<7)|u8[9];
    let pos=10; const end=Math.min(10+sz, u8.length);
    while(pos+10<=end){
      const fid=String.fromCharCode(u8[pos],u8[pos+1],u8[pos+2],u8[pos+3]);
      if(!/^[A-Z0-9]{4}$/.test(fid)) break;
      let fsz;
      if(ver===4) fsz=(u8[pos+4]<<21)|(u8[pos+5]<<14)|(u8[pos+6]<<7)|u8[pos+7];
      else fsz=(u8[pos+4]<<24)|(u8[pos+5]<<16)|(u8[pos+6]<<8)|u8[pos+7];
      const fs=pos+10;
      if(fsz<=0||fs+fsz>u8.length) break;
      if((fid==="USLT"&&!out.lyrics)||(fid==="APIC"&&!out.coverUrl)){
        const fd=u8.slice(fs,fs+fsz), enc=fd[0];
        if(fid==="USLT"){
          const rest=fd.slice(4), ni=findTerm(rest,enc,0);
          const tb=ni>=0?rest.slice(ni+(enc===1||enc===2?2:1)):rest;
          const txt=decodeTextBytes(tb,enc).replace(/^\uFEFF/,"");
          if(txt.trim()) out.lyrics=txt;
        }else{
          let p=1; const mi=fd.indexOf(0,p);
          const mime=decodeTextBytes(fd.slice(p,mi<0?p:mi),0)||"image/jpeg";
          p=(mi<0?p:mi)+2;
          const di=findTerm(fd,enc,p);
          p=di<0?fd.length:di+(enc===1||enc===2?2:1);
          if(p<fd.length){
            out.coverUrl=URL.createObjectURL(new Blob([fd.slice(p)],{type:mime}));
          }
        }
      }
      pos=fs+fsz;
      if(out.lyrics&&out.coverUrl) break;
    }
  }catch(e){}
  return out;
}
function parseLRC(text){
  const lines=[], re=/\[(\d+):(\d+)(?:[.:](\d+))?\]/g;
  text.split(/\r?\n/).forEach(ln=>{
    const tags=[]; let m; re.lastIndex=0;
    while((m=re.exec(ln))){
      tags.push((+m[1])*60+(+m[2])+(m[3]?(+m[3])/(m[3].length===3?1000:100):0));
    }
    const txt=ln.replace(/\[.*?\]/g,"").trim();
    if(tags.length&&txt) tags.forEach(t=>lines.push({t,txt}));
    else if(txt&&!tags.length) lines.push({t:-1,txt});
  });
  lines.sort((a,b)=>a.t-b.t);
  return lines;
}
let curLyrics=[], curLrcIdx=-1, metaCache={};
let curCoverUrl="", lyricsLoading=false;
/* 歌词/封面：只取 ID3 标签的实际大小，不阻塞播放。
   此前固定取满 2MB 等下完才解析，慢网下歌词比开播还慢；
   先取 10 字节读出标签大小，再按需取（一般标签只有几百 KB） */
function getSongMeta(song){
  if(metaCache[song.p]) return metaCache[song.p];
  const p=(async()=>{
    const m={lyrics:null,coverUrl:null};
    try{
      const H=davHeaders();
      let buf=null;
      const r1=await fetch(songUrl(song),{headers:Object.assign({},H,{Range:"bytes=0-9"})});
      if(r1.ok){
        const h=new Uint8Array(await r1.arrayBuffer());
        if(h.length>=10 && h[0]===0x49 && h[1]===0x44 && h[2]===0x33){ // "ID3"
          const tagTotal=10+((h[6]<<21)|(h[7]<<14)|(h[8]<<7)|h[9]);
          const want=Math.max(10, Math.min(tagTotal, 2097152));
          if(want>10){
            const r2=await fetch(songUrl(song),{headers:Object.assign({},H,{Range:"bytes=0-"+(want-1)})});
            if(r2.ok) buf=await r2.arrayBuffer();
          }
        }
      }
      if(!buf){ // 非 ID3（如 FLAC）或按需取失败：回退原来的整段取法
        const r=await fetch(songUrl(song),{headers:Object.assign({},H,{Range:"bytes=0-2097151"})});
        if(r.ok) buf=await r.arrayBuffer();
      }
      if(buf){
        const id3=parseID3(buf);
        m.coverUrl=id3.coverUrl;
        if(id3.lyrics) m.lyrics=parseLRC(id3.lyrics);
      }
    }catch(e){}
    return m;
  })();
  metaCache[song.p]=p;
  return p;
}
/* 歌词/封面到达后应用：播放页只显示歌词，封面进详情页（迷你条小图保留） */
function applyMeta(song){
  lyricsLoading=true;
  getSongMeta(song).then(m=>{
    if(queue[qi]!==song) return;
    lyricsLoading=false;
    curLyrics=m.lyrics||[]; renderLyrics();
    curCoverUrl=m.coverUrl||"";
    if(curCoverUrl){ $("miniCover").src=curCoverUrl; $("miniCover").classList.remove("hide"); }
    const ci=$("fpCoverImg"), cp=$("fpCoverPh"); // v9.39：唱片中心标
    if(ci){ if(curCoverUrl){ ci.src=curCoverUrl; ci.style.display="block"; if(cp) cp.style.display="none"; } else { ci.style.display="none"; if(cp) cp.style.display="flex"; } }
    if($("fpDetail").style.display!=="none") renderDetail(song);
    updateLikeBtn(song);
  }).catch(()=>{});
}
/* 诊断日志（v9.26）：把播放链路的关键事件记到本机，设置页可看、供截图定位 */
const DIAG_KEY = "zmusic.diag.v1";
function diag(kind, info){
  // v9.37：按用户指示删除诊断日志——不再记录、不再展示（保留空函数兼容各调用点）。
}
if("serviceWorker" in navigator){
  navigator.serviceWorker.addEventListener("message", e=>{
    if(e.data && e.data.type === "DIAG") diag("DAV", e.data.info);
  });
}
/* 把认证头推给 SW，用于 <audio> 直链 */
function pushAuthToSW(){
  const msg={type:"SET_AUTH", auth:(cfg.pass?authHeader():""), token:APP_TOKEN};
  try{
    if(navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage(msg);
    if("serviceWorker" in navigator){
      navigator.serviceWorker.ready.then(reg=>{ if(reg.active) reg.active.postMessage(msg); }).catch(()=>{});
    }
  }catch(e){}
}
function renderLyrics(){
  const el=$("fpLyrics"); el.innerHTML=""; curLrcIdx=-1;
  const cl0=$("fpCurLine"); if(cl0) cl0.textContent=""; // v9.39
  if(!curLyrics.length){
    el.innerHTML='<div class="lrc-line">'+(lyricsLoading?"歌词加载中…":"这首歌没有内嵌歌词")+'</div>'; return;
  }
  curLyrics.forEach(l=>{
    const d=document.createElement("div");
    d.className="lrc-line"+(l.t<0?" passed":"");
    d.textContent=l.txt||" "; el.appendChild(d);
  });
  el.scrollTop=0;
}
function syncLyrics(){
  if(!curLyrics.length) return;
  const t=audio.currentTime; let idx=-1;
  for(let i=0;i<curLyrics.length;i++){
    if(curLyrics[i].t<0) continue;
    if(curLyrics[i].t<=t) idx=i; else break;
  }
  if(idx===curLrcIdx||idx<0) return;
  const el=$("fpLyrics"), ch=el.children;
  if(curLrcIdx>=0&&ch[curLrcIdx]) ch[curLrcIdx].className="lrc-line passed";
  curLrcIdx=idx;
  const cl=$("fpCurLine"); if(cl) cl.textContent=(curLyrics[idx]&&curLyrics[idx].txt)||""; // v9.39 唱片视图当前行
  if(ch[idx]){
    ch[idx].className="lrc-line active";
    if(Date.now()>=lrcHoldUntil) ch[idx].scrollIntoView({block:"center",behavior:"smooth"});
  }
}
/* 滑动歌词跳转（v9.16）：滑动歌词停稳后，按停留在列表中央那行的时间跳播；
   浏览期间暂停自动跟随滚动防抢夺；点某行也可直接跳；中央行时间以浮标提示 */
let lrcTouchAt=0, lrcHoldUntil=0, lrcSeekTimer=null, lrcChipTimer=null;
function lrcCenterIdx(){
  const el=$("fpLyrics"), ch=el.children;
  if(!ch.length) return -1;
  const mid=el.getBoundingClientRect().top+el.clientHeight/2;
  let best=-1, bd=1e18;
  for(let i=0;i<ch.length;i++){
    const r=ch[i].getBoundingClientRect();
    const d=Math.abs(r.top+r.height/2-mid);
    if(d<bd){ bd=d; best=i; }
  }
  return best;
}
function lrcTimedIdx(i){ while(i>=0 && (!curLyrics[i] || curLyrics[i].t<0)) i--; return i; }
/* v9.37：统一 seek 入口——歌词拖动与进度条都走这里。（教训：v9.35 的 seekClamp 定义在 bind() 的
   函数作用域内，顶层的 lrcSeekTo 根本调不到、每次歌词拖动都抛 ReferenceError，等于把功能改死。）
   首段阶段数据只有开头：目标超出首段估算时长时，先钳到首段尾附近（避免元素 seek 到无数据处
   error 卡死），同时记 _pendingSeek，整曲换源时一步落到目标位。 */
function prefixHorizon(song){
  if(!song || !song._prefixTotal || !song._prefixBytes || song._prefixTotal<=song._prefixBytes) return 0;
  if(!isFinite(audio.duration) || !audio.duration) return 0;
  const start=song._prefixAudioStart||0; // v9.38：封面/元数据不算音频字节
  const audioBytes=song._prefixBytes-start, totalAudio=song._prefixTotal-start;
  if(audioBytes<=0 || totalAudio<=audioBytes) return 0;
  return audio.duration * (audioBytes/totalAudio) * 0.92;
}
function applySeek(t){
  const song=queue[qi];
  if(song && song._onPrefix){
    const lim=prefixHorizon(song);
    if(lim>0 && t>lim){ song._pendingSeek=t; try{ audio.currentTime=Math.max(0, lim); }catch(e){} return; }
  }
  if(song) song._pendingSeek=null;
  try{ audio.currentTime=t; }catch(e){}
}
function lrcSeekTo(i){
  const idx=lrcTimedIdx(i);
  if(idx<0) return;
  const t=curLyrics[idx].t;
  if(isFinite(t) && Math.abs(audio.currentTime-t)>=1){
    applySeek(t); // v9.37：走统一 seek 入口
    curLrcIdx=-1; syncLyrics();
  }
}
function lrcShowChip(){
  const el=$("lrcSeekChip"); if(!el) return;
  const idx=lrcTimedIdx(lrcCenterIdx());
  if(idx<0){ el.style.display="none"; return; }
  el.textContent="▶ "+fmtTime(curLyrics[idx].t);
  el.style.display="block";
  clearTimeout(lrcChipTimer);
  lrcChipTimer=setTimeout(()=>{ el.style.display="none"; },1800);
}
(function(){
  const el=$("fpLyrics"); if(!el) return;
  const onTouch=()=>{ lrcTouchAt=Date.now(); lrcHoldUntil=Date.now()+4000; };
  el.addEventListener("touchstart",onTouch,{passive:true});
  el.addEventListener("wheel",onTouch,{passive:true});
  el.addEventListener("touchend",()=>{ lrcHoldUntil=Math.min(lrcHoldUntil, Date.now()+1500); },{passive:true});
  el.addEventListener("scroll",()=>{
    if(!lrcTouchAt || Date.now()-lrcTouchAt>2000) return; // 自动跟随滚动不触发跳转
    lrcHoldUntil=Date.now()+2500;
    lrcShowChip();
    clearTimeout(lrcSeekTimer);
    lrcSeekTimer=setTimeout(()=>{
      lrcSeekTo(lrcCenterIdx());
      lrcTouchAt=0; lrcHoldUntil=Date.now()+800;
    },450);
  },{passive:true});
  el.addEventListener("click",e=>{
    const line=e.target.closest ? e.target.closest(".lrc-line") : null;
    if(!line) return;
    const i=Array.prototype.indexOf.call(el.children, line);
    if(i>=0){ lrcHoldUntil=Date.now()+800; lrcSeekTo(i); }
  });
  const chip=$("lrcSeekChip");
  if(chip) chip.addEventListener("click",()=>{ lrcHoldUntil=Date.now()+800; lrcSeekTo(lrcCenterIdx()); });
})();
function renderDetail(s){
  const fmt=(s.p.split(".").pop()||"").toUpperCase();
  $("fpDetail").innerHTML=
    (curCoverUrl?'<img class="fp-detail-cover" src="'+curCoverUrl+'" alt="封面">':"")+
    "<div><b>歌名：</b>"+escapeHtml(dispTitle(s))+"</div>"+
    "<div><b>歌手：</b>"+escapeHtml(dispArtist(s)||"未知")+"</div>"+
    "<div><b>合集：</b>"+escapeHtml(s.f||"-")+"</div>"+
    "<div><b>格式：</b>"+escapeHtml(fmt)+"</div>";
}
function escapeHtml(x){ return (x||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function songKey(s){ return s.p;}
function dispTitle(s){ return s.t || s.p.split("/").pop().replace(/\.[^.]+$/,"");}
function dispArtist(s){ return s.a || "未知歌手";}

let recExpanded=false, recCache=[];
function renderRec(){
  if(!recCache.length) recCache=recommend(20);
  renderSongs($("recList"), recExpanded?recCache:recCache.slice(0,5), false);
  const mb=$("recMore");
  mb.style.display=recCache.length>5?"block":"none";
  mb.textContent=recExpanded?"收起 ▴":"展开更多 ▾（共"+recCache.length+"首）";
}

/* 我喜欢 */
const FAV_KEY="zmusic.fav.v1";
let fav={};
try{ fav=JSON.parse(localStorage.getItem(FAV_KEY)||"{}"); }catch(e){ fav={}; }
function saveFav(){ localStorage.setItem(FAV_KEY, JSON.stringify(fav)); }
function updateLikeBtn(song){
  const liked=!!fav[song.p];
  $("fpLike").textContent=liked?"♥":"♡";
  $("fpLike").classList.toggle("liked",liked);
}
let repeatOne=false;

/* ---------- 播放历史 ---------- */
const HIST_KEY="zmusic.hist.v1";
let hist={};
try{ hist=JSON.parse(localStorage.getItem(HIST_KEY)||"{}");}catch(e){ hist={};}
function saveHist(){ try{localStorage.setItem(HIST_KEY,JSON.stringify(hist));}catch(e){}}
function logPlay(song, completed){
if(runMode) return; // 跑步模式：播放不计入历史/评价/推荐（v9.21 用户要求）
const k=songKey(song), h=hist[k]||{c:0,l:0};
h.c++; h.l=Date.now(); if(completed) h.done=(h.done||0)+1;
hist[k]=h; saveHist();
}

/* ---------- 口味信号：有效收听时长 + 搜索意图（v9.56） ----------
   旧推荐只数“点开次数”，听 5 秒切掉与完整听完同权，且结果永远按同一
   顺序取前 20 首，所以看起来从不变化。现在按实际播放进度累计秒数：
   长听/完播加权，短时跳过降权；搜索词与点开的搜索结果也进入口味画像。 */
const SEARCH_TASTE_KEY="zmusic.search.v1";
let searchTaste={terms:{},queries:[]};
try{ const st=JSON.parse(localStorage.getItem(SEARCH_TASTE_KEY)||"null"); if(st && st.terms) searchTaste=st; }catch(e){}
function saveSearchTaste(){ try{ localStorage.setItem(SEARCH_TASTE_KEY, JSON.stringify(searchTaste)); }catch(e){} }
const TASTE_STOP=new Set(["song","music","audio","video","official","the","and","feat","featuring","ft"]);
function tasteTokens(text){
  const raw=(text||"").toLowerCase(), out=new Set();
  for(const w of (raw.match(/[a-z0-9]{2,}/g)||[])) if(!TASTE_STOP.has(w)) out.add(w);
  for(const seq of (raw.match(/[一-龥]{2,}/g)||[])){
    if(seq.length<=6) out.add(seq);
    for(let i=0;i+1<seq.length;i++) out.add(seq.slice(i,i+2));
  }
  return [...out];
}
function recordSearchIntent(q, weight=1){
  if(runMode) return;
  q=(q||"").trim(); if(q.length<2) return;
  const now=Date.now();
  for(const t of tasteTokens(q)){
    const cur=searchTaste.terms[t]||{w:0,ts:0,n:0};
    cur.w=Math.min(30,(cur.w||0)+weight); cur.ts=now; cur.n=(cur.n||0)+1;
    searchTaste.terms[t]=cur;
  }
  searchTaste.queries=[q].concat((searchTaste.queries||[]).filter(x=>x!==q)).slice(0,20);
  const terms=Object.entries(searchTaste.terms).sort((a,b)=>((b[1].ts||0)-(a[1].ts||0))||((b[1].w||0)-(a[1].w||0)));
  searchTaste.terms=Object.fromEntries(terms.slice(0,160));
  saveSearchTaste();
}
let pendingSearchQuery="", pendingSearchAt=0;
function recordSearchPlay(song){
  if(!song || !pendingSearchQuery || Date.now()-pendingSearchAt>30*60*1000) return;
  recordSearchIntent(pendingSearchQuery, 2);
  pendingSearchQuery=""; pendingSearchAt=0;
}

let listenSession=null;
function flushListenSession(finalize=false, completed=false){
  if(!listenSession) return;
  const p=listenSession.p, h=hist[p]||{c:0,l:Date.now()};
  const add=Math.max(0, listenSession.sec-(listenSession.flushed||0));
  if(add>0){ h.sec=(h.sec||0)+add; listenSession.flushed=listenSession.sec; }
  if(listenSession.dur) h.dur=listenSession.dur;
  let ratio=0;
  if(listenSession.dur>0) ratio=Math.min(1, listenSession.sec/Math.max(1,listenSession.dur));
  if(completed && ratio>=0.35) ratio=Math.max(ratio,0.85);
  if(ratio>(h.best||0)) h.best=ratio;
  if(finalize && !listenSession.counted){
    if(completed || ratio>=0.5 || listenSession.sec>=45) h.long=(h.long||0)+1;
    else if(listenSession.sec>=5 && listenSession.sec<20 && ratio<0.25) h.skip=(h.skip||0)+1;
    listenSession.counted=true;
  }
  h.l=Date.now(); hist[p]=h; saveHist();
  if(finalize) listenSession=null;
}
function beginListen(song){
  if(!song) return;
  if(listenSession && listenSession.p===song.p) return;
  flushListenSession(true,false);
  if(runMode){ listenSession=null; return; }
  listenSession={p:song.p,lastPos:0,sec:0,flushed:0,maxPos:0,dur:0,counted:false};
}
function sampleListen(){
  if(sleepDeadline && Date.now()>=sleepDeadline){ stopForSleep(); return; }
  const song=queue[qi]; if(!song) return;
  if(!listenSession || listenSession.p!==song.p) beginListen(song);
  if(!listenSession) return;
  const pos=audio.currentTime||0;
  if(audio.duration && isFinite(audio.duration)) listenSession.dur=audio.duration;
  const delta=pos-(listenSession.lastPos||0);
  if(!audio.paused && delta>0 && delta<=3) listenSession.sec+=delta;
  if(pos>=0) listenSession.maxPos=Math.max(listenSession.maxPos||0,pos);
  listenSession.lastPos=pos;
  if(listenSession.sec-(listenSession.flushed||0)>=10) flushListenSession(false,false);
}
window.addEventListener("pagehide",()=>flushListenSession(false,false));
document.addEventListener("visibilitychange",()=>{ if(document.hidden) flushListenSession(false,false); });

/* ---------- 音频播放 ---------- */
const audio = new Audio();
audio.preload="auto";
audio.autoplay=true; // 换源后自动播，iOS 当连续播放处理
audio.preload="auto";
let queue=[], qi=-1, objCache={}, blobCache={}, loading=false;

const blobInflight={};
/* 下载闸（v9.29 改优先级抢占）：任何时刻只下一首整曲；新点播到达时——
   排队中的旧任务直接作废，正在下的若不是这首歌立刻中止让路。
   （v9.28 的纯串行队列会让连点下一首时每首排队挨个下，新点的歌半天轮不上、还在放原来的——用户实测。） */
let pauseGen=0; // v9.35：pause 事件代次（阶段二换源的防抢播守卫）
let userPlayGen=0, wantPlay=false;
/* ---------- 定时关闭（v9.56） ---------- */
const SLEEP_KEY="zmusic.sleep.v1";
let sleepDeadline=0, sleepAfterSong=false, sleepTimer=null;
try{ const sv=JSON.parse(localStorage.getItem(SLEEP_KEY)||"null"); if(sv){ sleepDeadline=sv.deadline||0; sleepAfterSong=!!sv.afterSong; } }catch(e){}
function saveSleepState(){ try{ localStorage.setItem(SLEEP_KEY, JSON.stringify({deadline:sleepDeadline, afterSong:sleepAfterSong})); }catch(e){} }
function sleepRemainingText(){
  if(sleepAfterSong) return "本曲播完后停";
  if(!sleepDeadline) return "未设置";
  const sec=Math.max(0, Math.ceil((sleepDeadline-Date.now())/1000));
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), ss=sec%60;
  return (h?h+":"+String(m).padStart(2,"0")+":"+String(ss).padStart(2,"0") : m+":"+String(ss).padStart(2,"0")) + " 后停";
}
function updateSleepUI(){
  const active=!!sleepDeadline || sleepAfterSong;
  const label=active ? sleepRemainingText() : "未设置";
  const badge=$("fpSleepBadge"); if(badge) badge.textContent=sleepAfterSong?"曲末":(sleepDeadline?Math.max(1,Math.ceil((sleepDeadline-Date.now())/60000))+"m":"");
  const fp=$("fpSleep"); if(fp){ fp.classList.toggle("sleep-on", active); fp.title="定时关闭："+label; }
  const sb=$("settingsSleep"); if(sb) sb.textContent="⏰ 定时关闭："+label;
  const st=$("sleepStatus"); if(st) st.textContent=active?("当前设置："+label):"未设置定时关闭。";
  document.querySelectorAll("[data-sleep-min]").forEach(b=>{
    const end=sleepDeadline ? Math.round((sleepDeadline-Date.now())/60000) : 0;
    b.classList.toggle("on", !sleepAfterSong && !!sleepDeadline && Math.abs(end-Number(b.dataset.sleepMin))<=1);
  });
  const sa=$("sleepAfterSong"); if(sa) sa.classList.toggle("on", sleepAfterSong);
  const off=$("sleepOff"); if(off) off.style.display=active?"":"none";
}
function stopForSleep(){
  sleepDeadline=0; sleepAfterSong=false; saveSleepState();
  if(sleepTimer){ clearInterval(sleepTimer); sleepTimer=null; }
  wantPlay=false;
  try{ audio.pause(); }catch(e){}
  updateSleepUI();
  setPlayStatus("定时关闭，已停止播放");
  toast("⏰ 定时到了，已停止播放", "ok", 3500);
}
function armSleepTimer(){
  if(sleepTimer){ clearInterval(sleepTimer); sleepTimer=null; }
  if(sleepDeadline){
    if(sleepDeadline<=Date.now()){ sleepDeadline=0; saveSleepState(); }
    else sleepTimer=setInterval(()=>{ if(Date.now()>=sleepDeadline) stopForSleep(); else updateSleepUI(); }, 1000);
  }
  updateSleepUI();
}
function setSleepMinutes(min){
  sleepAfterSong=false; sleepDeadline=Date.now()+min*60*1000; saveSleepState(); armSleepTimer();
  toast("⏰ "+min+" 分钟后停止播放", "ok", 2500);
}
function setSleepAfterSong(){
  sleepDeadline=0; sleepAfterSong=true; saveSleepState(); armSleepTimer();
  toast("⏰ 本曲播完后停止", "ok", 2500);
}
function cancelSleep(showToast=true){
  sleepDeadline=0; sleepAfterSong=false; saveSleepState(); armSleepTimer();
  if(showToast) toast("已取消定时关闭", "", 1800);
}
function consumeSleepAfterSong(){
  if(!sleepAfterSong) return false;
  stopForSleep();
  return true;
}
function openSleepModal(){ updateSleepUI(); const m=$("sleepModal"); if(m) m.style.display="flex"; }
function closeSleepModal(){ const m=$("sleepModal"); if(m) m.style.display="none"; }
 // v9.47：播放意图（区别于元素状态）——后台被系统掐停后靠它自愈；只由用户级动作改写 // v9.42：用户意图代次——只由 togglePlay 的恢复动作 +1。注意不能用 'play' 事件计数：换源幻影自播也会触发 'play' 事件（test31 实证），会把守卫骗下岗
/* v9.46：iOS/WebKit 媒体解锁。新域名＝全新站点，元素从没被"手势内播放"解锁过时，
   程序化 play()（点歌后异步加载完再调）会被 NotAllowedError 拦下且被旧代码静默吞掉，
   表现为"选了歌不自动播、按播放键却能播"。两道保险：
   ① 首次触摸时（手势内）用静音片段把元素解锁——仅当还没选过歌、不打扰任何现有状态；
   ② play() 若被 NotAllowedError 拦下，记 _resumeOnTap，下一次任意触摸时补播当前歌
      （触摸落在播放按钮上时不补——让 togglePlay 自己在手势里播，免得补播又被它暂停）。 */
const SILENT_WAV="data:audio/wav;base64,UklGRiQFAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
let _mediaUnlocked=false, _resumeOnTap=false;
document.addEventListener("pointerdown",e=>{
  if(_resumeOnTap){ _resumeOnTap=false;
    const onToggle=e.target&&e.target.closest&&e.target.closest("#miniToggle,#fpToggle");
    if(!onToggle&&queue[qi]&&audio.paused) audio.play().catch(()=>{});
  }
  if(_mediaUnlocked) return; _mediaUnlocked=true;
  if(queue[qi]||loading) return;
  try{ audio.src=SILENT_WAV; const pr=audio.play();
    if(pr&&pr.then) pr.then(()=>{ audio.pause(); try{ audio.removeAttribute("src"); audio.load(); }catch(_){} }).catch(()=>{});
  }catch(_){}
},true);
let dlRunning=null, dlQueued=null;
function dlGate(song){
  return new Promise((resolve, reject)=>{
    const job={song, resolve, reject, ctl:new AbortController()};
    if(dlQueued){ dlQueued.reject({code:0, msg:"已被新点播取代", superseded:true}); dlQueued=null; }
    if(dlRunning){
      dlQueued=job;
      if(dlRunning.song.p!==song.p) dlRunning.ctl.abort(); // 正在下的不是这首：掐掉让路
    } else runDl(job);
  });
}
async function runDl(job){
  dlRunning=job;
  try{ job.resolve(await blobDownload(job.song, job.ctl)); }
  catch(e){ job.reject(e); }
  finally{
    if(dlRunning===job) dlRunning=null;
    if(dlQueued){ const nx=dlQueued; dlQueued=null; runDl(nx); }
  }
}
async function blobUrl(song){
if(objCache[song.p]) return objCache[song.p];
if(blobInflight[song.p]) return blobInflight[song.p]; // 在途去重（v9.27）：别把同一首歌下两遍
const job=dlGate(song);
blobInflight[song.p]=job;
try{ return await job; } finally{ delete blobInflight[song.p]; }
}
/* v9.50：流式读完响应体，只用闲置超时判死（连续 idleMs 无新数据才放弃），不设总时限——
   慢但在动的下载给足时间。总死线是真机元凶：40 秒内下不完 8MB+ 的歌、两轮重试各从零
   开始，首段一耗尽歌就死（《大风吹》8.96MB/222s，2MB 首段正好 52 秒，与用户实测分秒不差）。 */
async function readBlobIdle(resp, idleMs, ctl){
  if(!resp.body || !resp.body.getReader) return await resp.blob();
  const reader=resp.body.getReader(); const chunks=[];
  let aborted=false;
  const onAbort=()=>{ aborted=true; try{ reader.cancel(); }catch(e){} };
  if(ctl) ctl.signal.addEventListener("abort", onAbort, {once:true});
  try{
    for(;;){
      let timer=null;
      const timeout=new Promise((_,rej)=>{ timer=setTimeout(()=>rej({code:0, msg:"下载停滞", idle:true}), idleMs); });
      let res;
      try{ res=await Promise.race([reader.read(), timeout]); }
      catch(e){ try{ reader.cancel(); }catch(_){} throw e; }
      finally{ if(timer) clearTimeout(timer); }
      if(aborted) throw {code:0, msg:"已取消", superseded:true};
      if(res.done) break;
      chunks.push(res.value);
    }
  } finally { if(ctl) ctl.signal.removeEventListener("abort", onAbort); }
  return new Blob(chunks, {type: (resp.headers && resp.headers.get("Content-Type")) || ""});
}
async function blobDownload(song, extCtl){
if(extCtl && extCtl.signal.aborted) throw {code:0, msg:"已取消", superseded:true};
const url=songUrl(song);
let lastErr=null;
for(let attempt=0;attempt<2;attempt++){
const ctl=new AbortController(); // v9.50：不再设总死线，停滞判定交给 readBlobIdle 的闲置超时
const onExt=()=>ctl.abort(); if(extCtl) extCtl.signal.addEventListener("abort", onExt, {once:true});
try{
const r=await fetch(url,{headers:davHeaders(), signal:ctl.signal});
if(r.status===401) throw {code:401,msg:"账号或密码不对（401），去设置页检查"};
if(r.status===502||r.status===503||r.status===504){
  lastErr={code:r.status,msg:"NAS 返回 "+r.status};
  toast("网络抖动，正在重试…("+(attempt+1)+"/2)","loading",2500);
  await new Promise(r2=>setTimeout(r2,1500)); continue;
}
if(!r.ok) throw {code:r.status,msg:"NAS 返回 "+r.status};
const blob=await readBlobIdle(r, 20000, ctl);
const ou=URL.createObjectURL(blob);
objCache[song.p]=ou; blobCache[song.p]=blob;
if(Object.keys(objCache).length>5){
const old=Object.keys(objCache)[0];
URL.revokeObjectURL(objCache[old]); delete objCache[old]; delete blobCache[old];
}
// v9.50：再按总字节封顶（几首大文件就上百 MB，iOS 会把页面挤爆重载）；不逐当前源与队列前三首
{
  let tot=0; for(const k in blobCache) tot+=blobCache[k].size;
  if(tot>120*1024*1024){
    const keep=new Set([song.p]); if(queue[qi]){ keep.add(queue[qi].p); const n1=queue[qi+1], n2=queue[qi+2]; if(n1) keep.add(n1.p); if(n2) keep.add(n2.p); }
    for(const k of Object.keys(blobCache)){
      if(tot<=120*1024*1024) break;
      if(keep.has(k) || objCache[k]===audio.src) continue;
      tot-=blobCache[k].size; URL.revokeObjectURL(objCache[k]); delete objCache[k]; delete blobCache[k];
    }
  }
}
return ou;
}catch(e){
if(e&&e.code===401) throw e;
if(extCtl && extCtl.signal.aborted) throw {code:0, msg:"已取消", superseded:true}; // 被新点播取代：立即停，不重试
if(e instanceof TypeError || (e&&e.name==="AbortError")){ lastErr={code:0,msg:"下载超时或网络中断"}; await new Promise(r2=>setTimeout(r2,1500)); continue; }
throw e;
}finally{ if(extCtl) extCtl.signal.removeEventListener("abort", onExt); }
}
throw lastErr||{code:0,msg:"重试后仍失败"};
}
/* 首段秒播（v9.31）：先取开头 2MB 立刻开播，整曲随后同位置换上。
   2MB 约值 128k 码率 2 分钟 / 320k 约 50 秒，一般够等整曲下完。 */
const PREFIX_BYTES=524288; // v9.52：512KB（320k 约 13 秒/FLAC 约 3 秒）——阶段一出声后约 1 秒即换直链流，首段只管开头；原 2MB 在约 1Mbps 下要等近 20 秒才出声
const prefixUrls={};
let curPrefixCtl=null;
async function prefixUrl(song, extCtl){
  if(objCache[song.p]) return objCache[song.p];
  if(prefixUrls[song.p]) return prefixUrls[song.p];
  const url=songUrl(song);
  let lastErr=null;
  for(let attempt=0; attempt<2; attempt++){
    if(extCtl && extCtl.signal.aborted) throw {code:0, msg:"已取消", superseded:true};
    const ctl=new AbortController(); // v9.50：同 blobDownload，不设总死线
    const onExt=()=>ctl.abort(); if(extCtl) extCtl.signal.addEventListener("abort", onExt, {once:true});
    try{
      const r=await fetch(url, {headers: Object.assign(davHeaders(), {Range:"bytes=0-"+(PREFIX_BYTES-1)}), signal: ctl.signal});
      if(r.status===401) throw {code:401, msg:"账号或密码不对（401），去设置页检查"};
      if(!r.ok && r.status!==206) throw {code:r.status, msg:"NAS 返回 "+r.status};
      const blob=await readBlobIdle(r, 15000, ctl);
      const total=parseInt(((r.headers.get("Content-Range")||"").split("/")[1])||"0", 10);
      const ou=URL.createObjectURL(blob);
      if(r.status===200 || (total>0 && total<=blob.size)){ objCache[song.p]=ou; blobCache[song.p]=blob; return ou; } // 拿到的就是整曲
      song._prefixTotal=total; song._prefixBytes=blob.size; // v9.37：供 applySeek 估算首段可播时长
      // v9.38：音频数据起点——ID3 封面图常占几百 KB，不排除会把可播时长高估、钳位 seek 仍越界报错（test29 实证）
      try{
        const h=new Uint8Array(await blob.slice(0,4).arrayBuffer());
        if(h[0]===0x49&&h[1]===0x44&&h[2]===0x33){ // "ID3"
          const b=new Uint8Array(await blob.slice(6,10).arrayBuffer());
          song._prefixAudioStart=10+(((b[0]&0x7f)<<21)|((b[1]&0x7f)<<14)|((b[2]&0x7f)<<7)|(b[3]&0x7f));
        } else if(h[0]===0x66&&h[1]===0x4c&&h[2]===0x61&&h[3]===0x43){ // "fLaC"
          let off=4;
          for(let n=0;n<16;n++){
            const bh=new Uint8Array(await blob.slice(off,off+4).arrayBuffer());
            if(bh.length<4) break;
            const last=(bh[0]&0x80)!==0, len=((bh[1]<<16)|(bh[2]<<8)|bh[3]);
            off+=4+len; if(last) break;
          }
          song._prefixAudioStart=off;
        }
      }catch(e){}
      prefixUrls[song.p]=ou;
      return ou;
    }catch(e){
      if(e && e.code===401) throw e;
      if(extCtl && extCtl.signal.aborted) throw {code:0, msg:"已取消", superseded:true};
      lastErr=e; await new Promise(r2=>setTimeout(r2, 800));
    }finally{ if(extCtl) extCtl.signal.removeEventListener("abort", onExt); }
  }
  throw lastErr||{code:0, msg:"首段加载失败"};
}

/* 双保险播放：先流式秒播，后台下载完整文件后无缝切换（保锁屏） */
let fbRetry=false;
let playSeq=0; // 播放代次（v9.28）：切歌后让上一首的异步加载自动作废
let loadingSong=null; // 正在整曲加载的歌（v9.30）：同歌重复点、加载中按钮语义都看它
let loadCancelled=null; // 被用户在加载中取消的歌（v9.30）：再按播放键应重新加载它，而不是续播旧歌
/* 连播容错：连续加载失败计数 + 卡住看门狗计时器 */
let failStreak=0;
let stallTimer=null;
/* 播放进度看门狗状态：上次进度时间/位置、自救次数 */
let lastProgAt=Date.now(), lastProgTime=0, stallActs=0;
/* 跟踪是否真正在播放（playing 事件），避免切源时撞车 */
let audioPlaying=false;
audio.addEventListener("pause",()=>{ pauseGen++; }); // v9.35
audio.addEventListener("playing",()=>{
  audioPlaying=true;
  const cs=queue[qi]; if(cs) cs._played=true;
  failStreak=0; clearTimeout(stallTimer);
  trySwapToBlob(queue[qi]); // 播起来了，补一次切本地
});
audio.addEventListener("pause",()=>{ audioPlaying=false; });
audio.addEventListener("waiting",()=>{ audioPlaying=false; });
function trySwapToBlob(song){
  if(!song || queue[qi]!==song || song._swapped) return;
  const ou=objCache[song.p];
  if(!ou) return;
  if(document.visibilityState!=="visible") return;
  if(!audioPlaying) return; // 必须真正在播，才换源
  try{
    song._swapped=true;
    audioPlaying=false;
    const t=audio.currentTime;
    audio.src=ou;
    audio.currentTime=t;
    const pr=audio.play();
    if(pr&&pr.then) pr.then(()=>{ audioPlaying=true; }).catch(()=>{ song._swapped=false; });
  }catch(e){ song._swapped=false; }
}
/* 预取下一首：音频+歌词封面，播完自动切时直接用本地，锁屏也能连播 */
function prefetchNext(){
  if(!queue.length) return;
  const n=queue[(qi+1)%queue.length];
  if(n && n!==queue[qi] && !n._prefetching){
    n._prefetching=true;
    const start=()=>{
      if(queue[(qi+1)%queue.length]!==n){ n._prefetching=false; return; }
      blobUrl(n).catch(()=>{}).finally(()=>{ n._prefetching=false; });
      getSongMeta(n).catch(()=>{});
    };
    /* 串行化（v9.27）：当前歌整曲还在下载时，预取排队等它下完——窄通道上两首整曲并发会互相堵死 */
    const cur=queue[qi];
    if(cur && blobInflight[cur.p]) blobInflight[cur.p].then(start, start);
    else start();
  }
  // v9.47：再往后一首也预取（后台连播的跑道从 1 首加深到 2 首，锁屏限流时更耐断）
  // v9.48 教训：dlGate 是单通道串行闸，新任务会掐掉正在下的歌——预取必须严格排队：
  // 等当前与 +1 都下完（或已缓存）才轮到 +2，绝不抢道（v9.47 初版抢道掐断当前歌整曲，实测致换源迟到）。
  const n2=queue[(qi+2)%queue.length];
  if(n2 && n2!==queue[qi] && n2!==n && !n2._prefetching && !objCache[n2.p]){
    n2._prefetching=true;
    const start2=()=>{
      if(queue[(qi+2)%queue.length]!==n2){ n2._prefetching=false; return; }
      const ahead=[queue[qi], queue[(qi+1)%queue.length]];
      for(const a of ahead){
        if(a && a!==n2 && !objCache[a.p] && blobInflight[a.p]){ blobInflight[a.p].then(start2, start2); return; }
        if(a && a!==n2 && !objCache[a.p] && a._prefetching){ setTimeout(start2, 1500); return; }
      }
      blobUrl(n2).catch(()=>{}).finally(()=>{ n2._prefetching=false; });
    };
    const cur2=queue[qi];
    if(cur2 && blobInflight[cur2.p]) blobInflight[cur2.p].then(start2, start2); else start2();
  }
}
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"){ try{ pushAuthToSW(); }catch(e){} trySwapToBlob(queue[qi]); }
});
/* v9.50 阶段二（重构）：首段开播约 1 秒后换成直链流（经 SW 带凭据）——流没有总下载死线、
   浏览器原生缓冲，慢网下顶多等待缓冲，不会再"整曲下载被判死→首段耗尽→跳到结尾/歌死"。
   拖到首段外的待落位由流的 Range 原生定位承接。流出错或 5 秒仍不可播 → 回退整曲 blob 换源；
   blob 失败重试一次，仍败才明确失败跳歌——关键路径不再有静默吞错的 .catch(()=>{})。 */
function stage2(song, pu){
  const pgAtReq=pauseGen, uplAtReq=userPlayGen;
  setTimeout(()=>{
    if(queue[qi]!==song || audio.src!==pu || song._swapped) return;
    const hadPending=(song._pendingSeek!=null);
    const ct=hadPending ? song._pendingSeek : (audio.currentTime||0);
    const wasPlaying=(pauseGen===pgAtReq) && (!audio.paused || hadPending);
    const intentPlay=wasPlaying;
    song._pendingSeek=null; song._onPrefix=false; song._onStream=true; song._swapped=true; song._streamRetry=false;
    song._swapAt=Date.now();
    audio.src=songUrl(song);
    try{ audio.currentTime=ct; }catch(e){}
    if(wasPlaying) audio.play().catch(()=>{});
    else if(pauseGen>pgAtReq){
      const stomp=()=>{ if(queue[qi]===song && !audio.paused && pauseGen>pgAtReq && userPlayGen===uplAtReq) audio.pause(); };
      audio.addEventListener("canplay", function h(){ audio.removeEventListener("canplay",h); setTimeout(stomp,50); });
      audio.addEventListener("playing", function h2(){ audio.removeEventListener("playing",h2); stomp(); });
      setTimeout(stomp, 800);
    }
    // v9.54 矫正重下：src 刚换就下达的 seek 偶被 WebKit 丢掉（流从 0 开播＝"开头重复"）。
    // 元数据到位时核对实际位置，偏离目标 >0.7 秒就补下一次——落位正常时是空操作，不必干等元数据才出声。
    audio.addEventListener("loadedmetadata", function hmS2(){ audio.removeEventListener("loadedmetadata",hmS2);
      if(queue[qi]===song && song._onStream && (audio.currentTime||0)<1.5 && ct-(audio.currentTime||0)>0.7){ try{ audio.currentTime=ct; }catch(e){} } }); // v9.55：只治"seek 被丢、从 0 起播"的签名；其间被拖动过的位置（读数≥1.5）不许拽回
    if(prefixUrls[song.p]){ URL.revokeObjectURL(prefixUrls[song.p]); delete prefixUrls[song.p]; }
    setTimeout(()=>{ if(queue[qi]===song && song._onStream && audio.readyState<2 && audio.networkState!==2){ song._onStream=false; swapToBlob(song, pgAtReq, uplAtReq, 0, intentPlay); } }, 5000);
    audio.addEventListener("error", function h(){ audio.removeEventListener("error",h); if(queue[qi]===song && song._onStream){ song._onStream=false; swapToBlob(song, pgAtReq, uplAtReq, 0, intentPlay); } });
  }, 1000);
}
function swapToBlob(song, pgAtReq, uplAtReq, attempt, intentPlay){
  blobUrl(song).then(ou=>{
    if(queue[qi]!==song) return;
    const hadPending=(song._pendingSeek!=null);
    const wasPlaying=((pauseGen===pgAtReq) && ((!audio.paused && !audio.ended) || (audio.ended && hadPending))) || !!(intentPlay && pauseGen===pgAtReq) || !!(audio.error && pauseGen===pgAtReq), ct=hadPending ? song._pendingSeek : (audio.currentTime||0);
    const stalled=!song._played && (audio.currentTime||0)<0.05;
    song._pendingSeek=null; song._onPrefix=false; song._onStream=false;
    song._swapAt=Date.now();
    audio.src=ou; song._swapped=true;
    try{ audio.currentTime=ct; }catch(e){}
    if(wasPlaying || stalled) audio.play().catch(()=>{});
    else if(pauseGen>pgAtReq){
      const stomp=()=>{ if(queue[qi]===song && !audio.paused && pauseGen>pgAtReq && userPlayGen===uplAtReq) audio.pause(); };
      audio.addEventListener("canplay", function h(){ audio.removeEventListener("canplay",h); setTimeout(stomp,50); });
      audio.addEventListener("playing", function h2(){ audio.removeEventListener("playing",h2); stomp(); });
      setTimeout(stomp, 800);
    }
    if(prefixUrls[song.p]){ URL.revokeObjectURL(prefixUrls[song.p]); delete prefixUrls[song.p]; }
  }).catch(e=>{
    if(queue[qi]!==song || (e && e.superseded)) return;
    if(attempt<1){ setTimeout(()=>{ if(queue[qi]===song) swapToBlob(song, pgAtReq, uplAtReq, attempt+1, intentPlay); }, 3000); return; }
    handleSongFailed(song, e);
  });
}
function playAt(i, autoplay=true){
if(autoplay) wantPlay=true;
if(i<0||i>=queue.length) return;
qi=i; const song=queue[qi]; fbRetry=false;
beginListen(song);
if(loadingSong===song) return; // 这首正在加载中，重复点不重启（v9.30）
if(loadCancelled!==song) loadCancelled=null;
diag("PLAY", song.t + " / " + (song.a || ""));
song._swapped=false; song._preSwitched=false; song._played=false; song._onStream=false; song._dlRetry=false; song._streamRetry=false;
stallActs=0; lastProgAt=Date.now(); lastProgTime=0;
try{ pushAuthToSW(); }catch(e){} // 每次播放前把 NAS 凭据再推给 SW（新域名 SW 刚就位时防直链 401）
// 有预取好的本地文件就直接用（锁屏连播可靠），否则走流式秒播
const cached=objCache[song.p];
audioPlaying=false;
loading=true; setPlayStatus("正在加载…");
if(autoplay) toast("正在加载《"+dispTitle(song)+"》…","loading",0);
curLyrics=[]; lyricsLoading=true; renderLyrics();
curCoverUrl="";
$("miniCover").classList.add("hide");
$("fpBg").style.backgroundImage="none";
renderPlayer(); updateMediaSession(song);
logPlay(song,false);
applyMeta(song);
const mySeq=++playSeq;
/* 下载看门狗：整曲 75 秒还没就绪（通道半死）就判失败跳下一首，别无限期干等（v9.28） */
clearTimeout(stallTimer);
if(autoplay){
  stallTimer=setTimeout(()=>{ if(playSeq===mySeq && queue[qi]===song && !song._played) handleSongFailed(song, {msg:"加载超时"}); }, 75000);
}
if(cached){
  // 已有本地整曲（预取/重播）：立即播，零等待
  audio.src=cached; song._swapped=true; song._onPrefix=false; song._onStream=false;
  if(song._resumeAt!=null){ try{ audio.currentTime=song._resumeAt; }catch(e){} song._resumeAt=null; }
  song._pendingSeek=null;
  if(autoplay){ audio.play().then(()=>{ loading=false; setPlayStatus(""); hideToast(); prefetchNext(); ensureQueue(); }).catch(e=>{ loading=false; if(e&&e.name==="NotAllowedError") _resumeOnTap=true; }); }
  else loading=false;
  return;
}
/* v9.31 首段秒播（替代 v9.28 整曲优先）：先取开头 2MB 立刻开播，整曲在后台下完后同位置无缝换上。
   整曲优先被用户真机否掉：通道慢时整曲迟迟下不完、连点切歌更是一首也落不了地。 */
audio.pause(); // v9.30：新歌还在加载时先停掉旧歌——不能再出现"标题是新歌、响的还是旧歌、按钮管不住"
loadingSong=song;
if(curPrefixCtl) curPrefixCtl.abort();
curPrefixCtl=new AbortController();
prefixUrl(song, curPrefixCtl).then(async pu=>{
  if(playSeq!==mySeq || queue[qi]!==song) return; // 已切走
  if(loadingSong===song) loadingSong=null;
  audio.src=pu; song._onPrefix=true; song._onStream=false; song._pendingSeek=(song._resumeAt!=null ? song._resumeAt : null); song._resumeAt=null; // v9.37 进入首段；v9.50 承接断点续播位
  if(autoplay){
    try{ await audio.play(); }catch(e){ if(e&&e.name==="NotAllowedError") _resumeOnTap=true; }
    loading=false; setPlayStatus(""); hideToast();
    setTimeout(()=>{ if(queue[qi]===song) prefetchNext(); }, 6000); ensureQueue(); // v9.55：预取让行 6 秒（慢管道先紧着当前歌换流）
  } else loading=false;
  if(objCache[song.p] && objCache[song.p]===pu){ song._swapped=true; song._onPrefix=false; return; } // 首段即整曲（小文件）
  stage2(song, pu); // v9.50：换直链流（回退 blob 在 stage2/swapToBlob 内）
}).catch(async e=>{
  if(playSeq!==mySeq || queue[qi]!==song){ if(loadingSong===song) loadingSong=null; return; } // 已被更新的点播取代
  // 首段也取不到：先试直链开播（v9.52，比等整曲快得多），流挂了再退回等整曲（v9.30 的路）
  if(autoplay){
    try{
      if(loadingSong===song) loadingSong=null;
      audio.src=songUrl(song); song._onStream=true; song._swapped=true; song._onPrefix=false;
      if(song._pendingSeek!=null){ const pt2=song._pendingSeek; song._pendingSeek=null; audio.addEventListener("loadedmetadata", function hh(){ audio.removeEventListener("loadedmetadata",hh); try{ audio.currentTime=pt2; }catch(e){} }); }
      else if(song._resumeAt>5){ const rt=song._resumeAt; song._resumeAt=0; audio.addEventListener("loadedmetadata", function hh(){ audio.removeEventListener("loadedmetadata",hh); try{ audio.currentTime=rt; }catch(e){} }); }
      audio.addEventListener("error", function h(){ audio.removeEventListener("error",h); if(queue[qi]===song && song._onStream){ song._onStream=false; swapToBlob(song, pauseGen, userPlayGen, 0, true); } });
      await audio.play();
      loading=false; setPlayStatus(""); hideToast();
      setTimeout(()=>{ if(queue[qi]===song) prefetchNext(); }, 6000); ensureQueue(); // v9.55：预取让行 6 秒（慢管道先紧着当前歌换流）
      return;
    }catch(se){ song._onStream=false; /* 直链也不行 → 落到整曲回退 */ }
  }
  try{
    const ou=await blobUrl(song);
    if(loadingSong===song) loadingSong=null;
    if(playSeq!==mySeq || queue[qi]!==song) return;
    audio.src=ou; song._swapped=true; song._onPrefix=false;
    if(song._pendingSeek!=null){ const pt=song._pendingSeek; song._pendingSeek=null; try{ audio.currentTime=pt; }catch(e){} } // v9.37
    if(autoplay){ try{ await audio.play(); }catch(err){ if(err&&err.name==="NotAllowedError") _resumeOnTap=true; } loading=false; setPlayStatus(""); hideToast(); prefetchNext(); ensureQueue(); }
    else loading=false;
  }catch(e2){
    if(loadingSong===song) loadingSong=null;
    if(e2 && e2.superseded) return;
    if(playSeq!==mySeq || queue[qi]!==song) return;
    handleSongFailed(song, e2);
  }
});
}
// 直链失败（如 SW 还没拿到凭据）→ 回退到 fetch+blob
audio.addEventListener("error",()=>{
  const code=(audio.error ? audio.error.code : "?");
  // v9.34：按结果分类——换源会中断旧资源上未完的 seek/加载、冒出过渡性 error；延迟 600ms 看元素
  // 是否已在正常出声：是＝良性过渡记 SWAPERR，否＝真错误记 AERR（v9.33 按时刻猜，老路径换源漏检）。
  setTimeout(()=>{
    if(!audio.paused && audio.readyState>=2) diag("SWAPERR", "过渡 code=" + code);
    else diag("AERR", "code=" + code + " rs=" + audio.readyState);
  },600);
  // v9.32：只记录，不再召唤 playFallback。首段架构下恢复由主流程负责（首段失败→等整曲；换源瞬间
  // 的过渡性 error 属正常现象），旧救援路一插手就会抢夺 <audio>，实测会把用户的暂停顶掉。
});
/* 一首歌彻底加载失败：自动跳下一首保住连播；连坏太多首（或队列只有一首）才停下报错 */
function handleSongFailed(song, e, msg){
  diag("FAIL", song.t + " " + ((e && (e.msg || e.message)) || msg || ""));
  if(queue[qi]!==song) return;
  if(e && e.name==="AbortError") return; // play() 被新一首的加载打断是正常切歌，不算失败（v9.13：此前会误判连环跳歌）
  loading=false;
  failStreak++;
  const cap=Math.min(queue.length||1, 8);
  if(queue.length<=1 || failStreak>=cap){
    wantPlay=false;
    const m=msg||("播放失败："+((e&&e.msg)||e||"加载失败"));
    setPlayStatus(m); toast(m,"err",8000);
    return;
  }
  toast("《"+dispTitle(song)+"》加载失败，自动下一首","err",3000);
  playAt((qi+1)%queue.length);
}
async function playFallback(song, origErr){
  diag("FALLBACK", (origErr && (origErr.message || origErr.msg)) || "");
  if(queue[qi]!==song) return;
  if(fbRetry) return; fbRetry=true; // 同一首只回退一次：error 事件与 play() 拒绝两条路此前会各跑一遍、互相打断（v9.13）
  toast("正在加载《"+dispTitle(song)+"》…","loading",0);
  try{
    audio.src=await blobUrl(song);
    await audio.play();
    loading=false; setPlayStatus(""); hideToast();
    renderPlayer();
  }catch(e){
    loading=false;
    if(e && e.name==="AbortError") return; // 被更新的加载打断，安静退出，控制权已交给新歌
    let msg="";
    if(e && e.code===401){ msg=e.msg; }
    else if(e instanceof TypeError){
      msg="连不上 NAS：可能是反代没开，或没配 CORS。去设置页点“测试连接”。";
    }
    else if(e && e.name==="NotAllowedError"){ msg="iOS 阻止了播放：请再点一次这首歌"; }
    else msg="播放失败："+((e&&e.msg)||e);
    if(e && e.code===401){ setPlayStatus(msg); toast(msg,"err",8000); alert(e.msg); return; }
    if(e && e.name==="NotAllowedError"){ setPlayStatus(msg); toast(msg,"err",8000); return; }
    handleSongFailed(song, e, msg);
  }
}
function togglePlay(){
if(loadingSong){ // 正在整曲加载（v9.30）：按钮取消加载意图，再点一次重新加载这首
  wantPlay=false;
  loadCancelled=loadingSong; loadingSong=null; playSeq++; loading=false;
  audio.pause(); setPlayStatus(""); renderPlayer();
  return;
}
if(audio.ended && queue[qi] && (queue[qi]._onPrefix || queue[qi]._pendingSeek!=null)){ // v9.50：首段假结束/待落位状态下按播放＝从断点续播，不从头
  const s=queue[qi]; s._resumeAt=(s._pendingSeek!=null ? s._pendingSeek : (audio.currentTime||0)); s._pendingSeek=null; wantPlay=true; return playAt(qi);
}
if(loadCancelled && loadCancelled===queue[qi]){ loadCancelled=null; return playAt(qi); }
if(!audio.src && queue.length) return playAt(0);
if(audio.paused){ wantPlay=true; userPlayGen++; const pr=audio.play(); if(pr&&pr.catch) pr.catch(()=>{}); } else { wantPlay=false; audio.pause(); } // v9.42：记一次真实恢复意图
}
function next(auto=false){
if(!queue.length) return;
if(repeatOne && auto){ playAt(qi); return; }
// 播到队尾：自动接上歌曲，不断流（跑步模式接节奏曲，普通模式接推荐）
if(qi>=queue.length-1){
  const recs=runMode ? runEnergySongs(new Set(queue.map(s=>s.p)),20)
                     : recommend(20).filter(s=>queue.indexOf(s)<0);
  if(recs.length){
    queue=queue.concat(recs);
    if(auto) toast(runMode?"🏃 已接上节奏燃曲 ♪":"已接上推荐歌单 ♪", "", 2500);
    // 刚接上的第一首立即预取
    const ns=queue[qi+1];
    if(ns && !objCache[ns.p]){ ns._prefetching=true; blobUrl(ns).catch(()=>{}).finally(()=>{ns._prefetching=false;}); getSongMeta(ns).catch(()=>{}); }
  }
}
const n=(qi+1)%queue.length;
playAt(n);
}
/* ---------- 跑步模式 · 180 步频 ---------- */
/* 已知 BPM 曲目表（关键词→BPM）：90 左右 = 每拍两步，正好 180 步频；180 左右 = 每拍一步 */
/* 已知 BPM 曲目表（关键词→BPM）：85-95 的歌每拍两步、168-188 的歌每拍一步，都贴合 180 步频。
   表里有的歌库里暂时没有，用户以后往 NAS 加了这些歌会自动匹配上。 */
const RUN_BPM={"faded":90,"cheap thrills":90,"despacito":89,"peaches":90,"starboy":93,"centuries":88,
"we are never":86,"sing me to sleep":85,"heathens":90,"closer":95,"孤勇者":89,"hall of fame":85,
"cold water":93,"all we know":90,"eastside":89,"bad liar":88,"roar":90,"africa":93,"back in black":92,
"diamonds":92,"umbrella":87,"as it was":174,"blinding lights":171,"bad blood":170,"till i collapse":171,"american idiot":186};
const RUN_FOLDERS=["10.欧美节奏控(清爽唤醒活力)(100首)","03-抖音热火DJ中英文嗨曲(240首)","20.精品中文DJ精选(200首)","18.百大DJ(电音之魂)(88首)","19.工体DJ(京城工体)(100首)","14.DJ超嗨电音夜店音乐DJ(104首)","20261007今日全网热门精选优质爆火歌曲"];
let runMode=false;
function shuffleArr(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function runStrictSongs(){
  const byKw={};
  CATALOG.forEach(s=>{
    const key=(s.t+" "+s.a).toLowerCase();
    for(const kw in RUN_BPM){
      if(key.includes(kw)){
        const b=RUN_BPM[kw];
        if((b>=85&&b<=95)||(b>=168&&b<=188)){ (byKw[kw]=byKw[kw]||[]).push(s); }
        break;
      }
    }
  });
  const out=[];
  for(const kw in byKw){
    // 同一首歌优先留原版（标题不带 Remix/Live/3D 等字样的），同名同歌手去重，最多 2 个版本
    const clean=byKw[kw].filter(s=>!/remix|live|3d|环绕|震胎|dj版/i.test(s.t+" "+s.p));
    const seen=new Set(), picked=[];
    for(const s of (clean.length?clean:byKw[kw])){
      const id=(s.t+"|"+s.a).toLowerCase();
      if(seen.has(id)) continue;
      seen.add(id); picked.push(s);
      if(picked.length>=2) break;
    }
    out.push(...picked);
  }
  return out;
}
function runEnergySongs(exclude,n){
  const pool=CATALOG.filter(s=>RUN_FOLDERS.includes(s.f) && !exclude.has(s.p));
  return shuffleArr(pool.slice()).slice(0,n);
}
function startRunRadio(){
  if(!CATALOG.length){ toast("曲库还没加载完，稍等一下","err",2500); return; }
  const strict=shuffleArr(runStrictSongs());
  const seen=new Set(strict.map(s=>s.p));
  const fill=runEnergySongs(seen, Math.max(0,40-strict.length));
  queue=strict.concat(fill);
  runMode=true;
  playAt(0);
  toast("🏃 跑步180开跑：共 "+queue.length+" 首连播，其中 "+strict.length+" 首 BPM 与 180 步频精准贴合，其余为节奏燃曲","",5000);
}
/* 队列剩3首时提前接歌，保证不断流；跑步模式下接的也是节奏曲 */
function ensureQueue(){
  if(!queue.length) return;
  if(queue.length-qi<=3){
    if(runMode){
      const seen=new Set(queue.map(s=>s.p));
      const more=runEnergySongs(seen,20);
      if(more.length) queue=queue.concat(more);
      return;
    }
    const recs=recommend(20).filter(s=>queue.indexOf(s)<0);
    if(recs.length) queue=queue.concat(recs);
  }
}
function prev(){
if(!queue.length) return;
if(audio.currentTime>3){ audio.currentTime=0; return;}
playAt((qi-1+queue.length)%queue.length);
}
audio.addEventListener("ended",()=>{ const s=queue[qi]; flushListenSession(true,true); if(s) logPlay(s,true);
  if(consumeSleepAfterSong()) return;
  if(s && s._onPrefix && !s._swapped && s._pendingSeek==null) s._pendingSeek=audio.duration||0; // v9.47：首段先播完、整曲还没到（多见于锁屏限流）——不是真结束，等换源落位续播
  if(s && s._pendingSeek!=null && !s._swapped){
    // v9.37：进度被拖到首段之后、整曲还没换上——别跳走，等换源落到目标位续播；45 秒没换上再跳歌兜底
    setTimeout(()=>{ if(queue[qi]===s && s._pendingSeek!=null && !s._swapped) next(true); }, 45000);
    return;
  }
  next(true);});
/* 播放卡死看门狗：一首歌已开播后，进度超过 10 秒不动（没暂停、没结束）就自救：
   先切到后台下好的本地整首续播；没有本地缓存（或切完还卡）就直接跳下一首。
   专治"卡在最后几秒不结束、也不切歌"——数据流尾巴断了时 ended 永不触发的情况 */
audio.addEventListener("timeupdate",()=>{ if(!audio.paused){ lastProgAt=Date.now(); lastProgTime=audio.currentTime; } });
audio.addEventListener("timeupdate", sampleListen);
audio.addEventListener("progress",()=>{ if(!audio.paused) lastProgAt=Date.now(); });
setInterval(()=>{
  if(!queue.length || qi<0) return;
  const song=queue[qi]; if(!song || !song._played) return; // 没开播的归开头加载看门狗管
  if(audio.paused || audio.ended) return;
  if(audio.currentTime>0 && Math.abs(audio.currentTime-lastProgTime)>0.05){ lastProgAt=Date.now(); lastProgTime=audio.currentTime; return; }
  if(Date.now()-lastProgAt<10000) return;
  // v9.50：直链流卡死 20 秒——有本地整曲就换本地，没有就重连流一次
  if(song._onStream && Date.now()-lastProgAt>=20000){
    const t=audio.currentTime||0;
    if(objCache[song.p]){ song._onStream=false; song._swapAt=Date.now(); audio.src=objCache[song.p]; try{ audio.currentTime=t; }catch(e){} if(wantPlay) audio.play().catch(()=>{}); lastProgAt=Date.now(); return; }
    if(!song._streamRetry){ song._streamRetry=true; audio.src=songUrl(song); try{ audio.currentTime=t; }catch(e){} if(wantPlay) audio.play().catch(()=>{}); lastProgAt=Date.now(); return; }
  }
  // v9.49：首段数据先耗尽、整曲还在下载（锁屏限流的典型断点）——元素是"饿着"不是"死了"：
  // 等下载落地由换源接上，别按卡死跳歌；在途就宽容等待，没在途就补发一次下载。
  if(song._onPrefix && !song._swapped){
    if(blobInflight[song.p]){ lastProgAt=Date.now(); return; }
    if(!song._dlRetry){ song._dlRetry=true; blobUrl(song).catch(()=>{}); lastProgAt=Date.now(); return; }
  }
  if(stallActs>=2) return;
  stallActs++; lastProgAt=Date.now();
  const ou=objCache[song.p];
  if(ou && !song._swapped){
    try{
      song._swapped=true;
      const t=audio.currentTime;
      audio.src=ou; audio.currentTime=t;
      const pr=audio.play(); if(pr&&pr.catch) pr.catch(()=>{});
      toast("播放卡住了，切换本地缓存续播","",2500);
      return;
    }catch(e){}
  }
  toast("《"+dispTitle(song)+"》卡住，自动下一首","err",3000);
  logPlay(song,true);
  next(true);
},4000);
audio.addEventListener("play",syncPlayBtns);
audio.addEventListener("pause",syncPlayBtns);
audio.addEventListener("playing",()=>{ try{ if("mediaSession" in navigator) navigator.mediaSession.playbackState="playing"; }catch(e){} });
audio.addEventListener("pause",()=>{ try{ if("mediaSession" in navigator) navigator.mediaSession.playbackState="paused"; }catch(e){} });
/* v8.5 方式：不上报位置，避免干扰 iOS 连播和按钮 */
function setPositionState(){}
let lastPosState=0;
audio.addEventListener("timeupdate",()=>{
if(audio.duration){ $("seek").value=Math.floor(audio.currentTime/audio.duration*1000);
$("tCur").textContent=fmtTime(audio.currentTime);
const pct=(audio.currentTime/audio.duration*100);
$("miniProgFill").style.width=pct+"%"; $("miniProgKnob").style.left=pct+"%";}
syncLyrics();
preSwitch();
});
/* 提前切歌：结束前2秒、还在出声时切下一首，iOS 当连续播放放行 */
function preSwitch(){
  if(audio.paused || !wantPlay || repeatOne) return; // v9.52：暂停中（含用户拖到结尾细听）与单曲循环不提前切
  if(sleepAfterSong) return; // 定时关闭选了“本曲后停”时不提前切，等本曲真正结束
  const song=queue[qi]; if(!song || song._preSwitched) return;
  if(!audio.duration || audio.duration<10) return;
  const remain=audio.duration-audio.currentTime;
  if(remain>2.5 || remain<0.3) return;
  if(qi>=queue.length-1){
    const recs=recommend(20).filter(s=>queue.indexOf(s)<0);
    if(recs.length) queue=queue.concat(recs);
  }
  const ni=(qi+1)%queue.length;
  const ns=queue[ni];
  if(!ns || ns===song) return;
  const blob=objCache[ns.p];
  const useBlob=!!blob;
  // v9.52：v9.33 时代因旧直链不可靠才规定"没备好整曲就不提前切"；v9.50 起直链流已是阶段二主通道，
  // 未缓存也提前切到直链——关键是赶在 ended 之前切。iOS 在 ended 之后会收回程序自动播放的资格，
  // 下一首的 play() 被静默扣下、必须手点（用户实测"放完卡住、暂停再播放才走"），提前切即绕开此坑。
  song._preSwitched=true;
  flushListenSession(true,true);
  logPlay(song,true);
  try{ localStorage.removeItem("zmusic.resume"); }catch(e){}
  qi=ni; ns._swapped=true; ns._onPrefix=false; ns._pendingSeek=null; ns._onStream=!useBlob; ns._dlRetry=0; ns._streamRetry=0; ns._played=false; // v9.52
  audioPlaying=false;
  if(!useBlob){ try{ pushAuthToSW(); }catch(e){}
    audio.addEventListener("error", function h(){ audio.removeEventListener("error",h); if(queue[qi]===ns && ns._onStream){ ns._onStream=false; swapToBlob(ns, pauseGen, userPlayGen, 0, true); } });
  }
  audio.src=useBlob?blob:songUrl(ns);
  // 歌词与切歌同时开始加载，不等 play() 成功（此前要等开播后才取歌词）
  curLyrics=[]; lyricsLoading=true; renderLyrics();
  curCoverUrl="";
  $("miniCover").classList.add("hide");
  $("fpBg").style.backgroundImage="none";
  applyMeta(ns);
  const pr=audio.play();
  if(pr&&pr.then){
    pr.then(()=>{
      loading=false; setPlayStatus(""); hideToast();
      renderPlayer(); updateMediaSession(ns); beginListen(ns); logPlay(ns,false);
      prefetchNext(); ensureQueue();
    }).catch(()=>{ /* 提前切歌失败：多半是 iOS 把 play() 扣下——标记待点播恢复，用户下一次任意点按即接着播；ended→next 与看门狗再兜底 */
      if(queue[qi]===ns) _resumeOnTap=true; });
  }
}
audio.addEventListener("loadedmetadata",()=>{ $("tDur").textContent=fmtTime(audio.duration);});

/* v9.47 后台连续性：iOS 锁屏后页面被限流/挂起，连播常在"下一首的加载或 play()"处断掉，
   回前台时按 wantPlay 自动续播，用户不必再点播放键。自愈只认意图、不认元素状态，
   用户亲手暂停（含锁屏暂停）已把 wantPlay 清掉，不会被顶。 */
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState!=="visible" || !wantPlay || !queue[qi] || loading) return;
  if(!audio.paused) return;
  if(audio.ended || !audio.src){ playAt(qi); return; }
  const pr=audio.play();
  if(pr&&pr.catch) pr.catch(()=>{ if(wantPlay&&queue[qi]) _resumeOnTap=true; });
  setTimeout(()=>{ if(wantPlay&&queue[qi]&&audio.paused&&!audio.ended&&!loading) playAt(qi); },1500);
});
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState!=="visible" || !wantPlay) return;
  if(!audio.paused && queue[qi] && queue[qi]._played) lastProgAt=Date.now()-20000; // 饿停的元素回前台让看门狗立即介入
});
let _healTimer=null;
audio.addEventListener("pause",()=>{
  if(!wantPlay || audio.ended || loading) return;
  const song=queue[qi]; if(!song || !song._played) return; // 只治已开播被中途掐停的；加载期归主流程
  if(_healTimer) return;
  _healTimer=setTimeout(()=>{ _healTimer=null;
    if(wantPlay&&queue[qi]===song&&audio.paused&&!audio.ended){ const pr=audio.play(); if(pr&&pr.catch) pr.catch(()=>{ _resumeOnTap=true; }); }
  },3000);
});
audio.addEventListener("playing",()=>{ if(_healTimer){ clearTimeout(_healTimer); _healTimer=null; } });

/* 锁屏/耳机控制 */
function updateMediaSession(song){
if(!("mediaSession" in navigator)) return;
try{
navigator.mediaSession.metadata=new MediaMetadata({
title:dispTitle(song), artist:dispArtist(song), album:song.f||"知行音乐"});
try{navigator.mediaSession.setActionHandler("play",()=>{ wantPlay=true; audio.play().catch(()=>{}); });}catch(e){}
try{navigator.mediaSession.setActionHandler("pause",()=>{ wantPlay=false; audio.pause(); });}catch(e){}
try{navigator.mediaSession.setActionHandler("previoustrack",()=>prev());}catch(e){}
try{navigator.mediaSession.setActionHandler("nexttrack",()=>next(true));}catch(e){}
}catch(e){}
}

/* ---------- 搜索 ---------- */
function searchSongs(q){
q=norm(q); if(!q) return [];
const toks=q.split("").length>12? [q]: q.match(/[\u4e00-\u9fa5a-z0-9]+/gi)||[q];
// 中文按整串、数字字母按token
const res=[];
for(const s of CATALOG){
const hay=norm(s.t+" "+s.a+" "+s.f);
let score=0, ok=true;
const parts = /[\u4e00-\u9fa5]{2,}/.test(q)? [q]: (q.match(/[\u4e00-\u9fa5]+|[a-z0-9]+/gi)||[q]);
for(const t of parts){
const tt=norm(t);
if(hay.includes(tt)){ score += norm(s.t).includes(tt)?3: norm(s.a).includes(tt)?2: 1;}
else { ok=false; break;}
}
if(ok) res.push({s,score});
}
res.sort((x,y)=>y.score-x.score);
return res.slice(0,80).map(r=>r.s);
}

/* ---------- 语音搜索 ---------- */
function voiceSearch(){
// iOS 网页语音识别不稳定（系统层问题），直接用 iOS 键盘听写更可靠
const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent);
if(isIOS){
  $("q").focus();
  $("voiceHint").style.display="block";
  $("voiceHint").textContent="点键盘上的 🎤 话筒开始听写，说完点搜索。";
  return;
}
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
if(!SR){
$("voiceHint").style.display="block";
$("voiceHint").textContent="当前浏览器不支持网页语音识别：请点搜索框，再点键盘上的 🎤 话筒听写，说完点搜索。";
$("q").focus(); return;
}
const rec=new SR();
rec.lang="zh-CN"; rec.interimResults=false; rec.maxAlternatives=1;
const btn=$("micBtn"); btn.classList.add("listening");
$("voiceHint").style.display="block"; $("voiceHint").textContent="正在听…请说歌名或歌手";
let retried=false;
rec.onresult=e=>{
const txt=e.results[0][0].transcript||"";
btn.classList.remove("listening");
$("voiceHint").textContent="听到："+txt;
const cleaned=txt.replace(/^(播放|来一首|放一首|唱一首|点一首)/,"").trim();
$("q").value=cleaned||txt;
doSearch(true, true);
};
rec.onerror=e=>{ btn.classList.remove("listening");
const err=e.error||"unknown";
// iOS 经常误报 aborted，自动重试一次
if(err==="aborted" && !retried){
  retried=true;
  setTimeout(()=>{ try{ btn.classList.add("listening"); rec.start(); }catch(_){} }, 300);
  return;
}
let msg="没听清，再试一次，或用键盘输入。";
if(err==="not-allowed"||err==="service-not-allowed"){
  msg="麦克风权限被拒：去 iPhone 设置 → Safari（或知行音乐）→ 允许麦克风，再试。";
}else if(err==="audio-capture"){
  msg="没找到麦克风：检查是否被其他 App 占用。";
}else if(err==="network"){
  msg="网络问题：语音识别需要联网，检查网络再试。";
}else if(err==="no-speech"){
  msg="没听到声音：请靠近麦克风大声说。";
}else if(err==="aborted"){
  msg="识别被中断：请用键盘输入，或点输入框用键盘 🎤 听写（更稳定）。";
}
$("voiceHint").textContent=msg+"（"+err+"）";};
rec.onend=()=>btn.classList.remove("listening");
try{ rec.start();}catch(e){ btn.classList.remove("listening");}
}
function doSearch(autoplay, submitted=false){
const q=$("q").value.trim();
pendingSearchQuery=q; pendingSearchAt=Date.now();
if(submitted) recordSearchIntent(q, 1);
const list=searchSongs(q);
renderSongs($("searchList"), list, true, "search");
window.scrollTo(0,0);
if(autoplay && list.length){ runMode=false; queue=list.slice(); playAt(0);}
else if(autoplay){ $("voiceHint").textContent+="（曲库里没找到，换个说法试试）";}
}

/* ---------- 推荐（v9.56：口味画像 + 多样性抽样） ---------- */
const pathMap={};
function byPath(p){
if(!pathMap.built){ for(const s of CATALOG) pathMap[s.p]=s; pathMap.built=true;}
return pathMap[p];
}
function songTasteValue(p){
  let v=0; const h=hist[p];
  if(h){
    const ageDays=Math.max(0,(Date.now()-(h.l||0))/86400000);
    const decay=Math.pow(0.5, ageDays/45);
    const sec=h.sec||0;
    v+=Math.min(6, Math.log1p(sec/30)*2.2);
    v+=(h.done||0)*2.5;
    v+=(h.long||0)*1.8;
    if((h.best||0)>=0.5) v+=1.5; else if((h.best||0)>=0.3) v+=0.5;
    v+=Math.min(2,(h.c||0)*0.25);
    v-=(h.skip||0)*2.2;
    v*=0.35+0.65*decay;
  }
  if(fav[p]) v+=5;
  return v;
}
function buildTasteProfile(){
  const artist={}, folder={}, token={}, artistNeg={}, folderNeg={}, tokenNeg={};
  let amx=0, fmx=0, tmx=0, anx=0, fnx=0, tnx=0;
  const keys=new Set([].concat(Object.keys(hist), Object.keys(fav)));
  for(const p of keys){
    const val=songTasteValue(p); if(!val) continue;
    const s=byPath(p); if(!s) continue;
    if(val>0){
      if(s.a){ artist[s.a]=(artist[s.a]||0)+val; if(artist[s.a]>amx) amx=artist[s.a]; }
      if(s.f){ folder[s.f]=(folder[s.f]||0)+val; if(folder[s.f]>fmx) fmx=folder[s.f]; }
      for(const t of tasteTokens((s.t||"")+" "+(s.a||"")+" "+(s.f||""))){
        token[t]=(token[t]||0)+val*0.35; if(token[t]>tmx) tmx=token[t];
      }
    } else {
      const nv=-val;
      if(s.a){ artistNeg[s.a]=(artistNeg[s.a]||0)+nv; if(artistNeg[s.a]>anx) anx=artistNeg[s.a]; }
      if(s.f){ folderNeg[s.f]=(folderNeg[s.f]||0)+nv; if(folderNeg[s.f]>fnx) fnx=folderNeg[s.f]; }
      for(const t of tasteTokens((s.t||"")+" "+(s.a||"")+" "+(s.f||""))){
        tokenNeg[t]=(tokenNeg[t]||0)+nv*0.35; if(tokenNeg[t]>tnx) tnx=tokenNeg[t];
      }
    }
  }
  const now=Date.now();
  for(const t in (searchTaste.terms||{})){
    const rec=searchTaste.terms[t], ageDays=Math.max(0,(now-(rec.ts||now))/86400000);
    const val=(rec.w||0)*1.1*Math.pow(0.5, ageDays/30);
    if(val<=0) continue;
    token[t]=(token[t]||0)+val; if(token[t]>tmx) tmx=token[t];
  }
  return {artist,folder,token,artistNeg,folderNeg,tokenNeg,amx:amx||1,fmx:fmx||1,tmx:tmx||1,anx:anx||1,fnx:fnx||1,tnx:tnx||1,has:keys.size>0||Object.keys(token).length>0};
}
function recommend(n=20, opts={}){
  const prof=buildTasteProfile(), now=Date.now();
  const exclude=opts.exclude||new Set(), scored=[];
  for(const s of CATALOG){
    if(exclude.has(s.p)) continue;
    const h=hist[s.p];
    if(h && now-(h.l||0)<3*3600*1000) continue; // 刚听过的歌先让位给相似歌
    let sc=0;
    if(s.a && prof.artist[s.a]) sc+=4.5*prof.artist[s.a]/prof.amx;
    if(s.f && prof.folder[s.f]) sc+=2.0*prof.folder[s.f]/prof.fmx;
    let tok=0;
    for(const t of tasteTokens((s.t||"")+" "+(s.a||"")+" "+(s.f||""))){
      if(prof.token[t]) tok+=Math.min(1, prof.token[t]/prof.tmx);
    }
    sc+=Math.min(2.5, tok*0.55);
    if(s.a && prof.artistNeg[s.a]) sc-=3.5*prof.artistNeg[s.a]/prof.anx;
    if(s.f && prof.folderNeg[s.f]) sc-=2.0*prof.folderNeg[s.f]/prof.fnx;
    let tokNeg=0;
    for(const t of tasteTokens((s.t||"")+" "+(s.a||"")+" "+(s.f||""))){
      if(prof.tokenNeg[t]) tokNeg+=Math.min(1, prof.tokenNeg[t]/prof.tnx);
    }
    sc-=Math.min(1.5, tokNeg*0.4);
    if(fav[s.p]) sc+=1.0;
    if(h){
      sc+=Math.min(0.4,(h.done||0)*0.1);
      sc-=Math.min(3,(h.skip||0)*1.4);
      if((h.sec||0)>=45 || (h.best||0)>=0.5) sc+=0.25;
    } else sc+=0.35;
    if(!prof.has) sc=1;
    scored.push({s,sc:Math.max(0.03,sc)});
  }
  scored.sort((a,b)=>b.sc-a.sc);
  const pool=scored.slice(0, Math.max(120, n*8));
  const out=[], used=new Set(), artistCnt={}, folderCnt={};
  const artistCap=Math.max(2, Math.ceil(n/5)), folderCap=Math.max(3, Math.ceil(n/3));
  function takeWeighted(list, relaxCaps){
    const cand=list.filter(x=>!used.has(x.s.p) && (relaxCaps || ((artistCnt[x.s.a]||0)<artistCap && (folderCnt[x.s.f]||0)<folderCap)));
    if(!cand.length) return false;
    let total=0; const ws=cand.map(x=>{ const w=Math.pow(x.sc,1.55)*(0.85+Math.random()*0.3); total+=w; return w; });
    let r=Math.random()*total, pick=cand[cand.length-1];
    for(let i=0;i<cand.length;i++){ r-=ws[i]; if(r<=0){ pick=cand[i]; break; } }
    used.add(pick.s.p); out.push(pick.s);
    if(pick.s.a) artistCnt[pick.s.a]=(artistCnt[pick.s.a]||0)+1;
    if(pick.s.f) folderCnt[pick.s.f]=(folderCnt[pick.s.f]||0)+1;
    return true;
  }
  const reserve=prof.has ? Math.min(5, Math.max(2, Math.floor(n*0.2))) : 0;
  while(out.length<Math.max(0,n-reserve) && takeWeighted(pool,false)){}
  while(out.length<Math.max(0,n-reserve) && takeWeighted(pool,true)){}
  if(reserve){
    const fresh=scored.filter(x=>!used.has(x.s.p) && !hist[x.s.p] && !(x.s.a && prof.artistNeg[x.s.a]) && !(x.s.f && prof.folderNeg[x.s.f]));
    for(let i=fresh.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [fresh[i],fresh[j]]=[fresh[j],fresh[i]]; }
    for(const x of fresh){ if(out.length>=n) break; used.add(x.s.p); out.push(x.s); }
  }
  while(out.length<n && takeWeighted(scored,true)){}
  if(out.length<n){
    for(const s of CATALOG){ if(out.length>=n) break; if(!used.has(s.p) && !exclude.has(s.p)){ used.add(s.p); out.push(s); } }
  }
  return out;
}
function recentPlayed(n=10){
return Object.keys(hist).map(k=>({s:byPath(k),l:hist[k].l}))
.filter(x=>x.s).sort((a,b)=>b.l-a.l).slice(0,n).map(x=>x.s);
}

/* ---------- 渲染 ---------- */
function renderSongs(el, songs, asQueue, source=""){
el.innerHTML="";
if(!songs.length){ el.innerHTML='<p class="empty">没找到，换个关键词试试</p>'; return;}
songs.forEach((s,i)=>{
const b=document.createElement("button"); b.className="song";
b.innerHTML=`<span class="idx">${i+1}</span><span class="tt"><b></b><span></span></span><span class="go">▶</span>`;
b.querySelector("b").textContent=dispTitle(s);
b.querySelector(".tt span").textContent=dispArtist(s)+" · "+(s.f||"");
b.onclick=()=>{ if(source==="search") recordSearchPlay(s); if(asQueue){ runMode=false; queue=songs.slice();} playAt(asQueue?i:queueIndexOf(s));};
el.appendChild(b);
});
}
function queueIndexOf(s){
let i=queue.indexOf(s);
if(i<0){ runMode=false; queue=queue.concat([s]); i=queue.length-1;}
return i;
}
function renderHome(){
renderSongs($("recentList"), recentPlayed(10), false);
recCache=[]; recExpanded=false; renderRec();
// 合集
const folders={};
for(const s of CATALOG){ folders[s.f]=folders[s.f]||{n:s.f,c:0}; folders[s.f].c++;}
const fl=$("folderList"); fl.innerHTML="";
/* QQ风渐变封面：按名字哈希取色 */
const GRADS=[
  "linear-gradient(135deg,#31c27c,#1a8f5c)","linear-gradient(135deg,#7c5cff,#4a2fd6)",
  "linear-gradient(135deg,#ff7a59,#e5484d)","linear-gradient(135deg,#4aa8ff,#2b6fd6)",
  "linear-gradient(135deg,#ffb84d,#f67c1f)","linear-gradient(135deg,#c86bff,#8b3fd6)",
  "linear-gradient(135deg,#4ade80,#16a34a)","linear-gradient(135deg,#ff6b9d,#d63f7a)"];
function gradFor(name){ let h=0; for(const ch of name) h=(h*31+ch.codePointAt(0))>>>0;
  return GRADS[h%GRADS.length]; }
Object.values(folders).sort((a,b)=>b.c-a.c).forEach(f=>{
const b=document.createElement("button"); b.className="qq-card";
b.innerHTML=`<span class="qq-art" style="background:${gradFor(f.n)}"><span class="qq-deco">♪</span><span class="qq-cnt">${f.c} 首</span><span class="qq-play">▶</span></span>
  <span class="qq-cap"><b></b></span>`;
b.querySelector("b").textContent=f.n;
b.querySelector(".qq-play").onclick=e=>{ e.stopPropagation();
  const ss=CATALOG.filter(s=>s.f===f.n); runMode=false; queue=ss.slice(); playAt(0); };
b.onclick=()=>{ const ss=CATALOG.filter(s=>s.f===f.n);
$("q").value=""; showView("view-search"); renderSongs($("searchList"),ss,true);
window.scrollTo(0,0); toast("已载入《"+f.n+"》"+ss.length+"首，点一首开始播", "", 2500);};
fl.appendChild(b);
});
$("libCount").textContent=CATALOG.length;
const fc=Object.keys(folders).length;
$("qqStats").textContent=`${CATALOG.length} 首歌曲 · ${fc} 个合集`;
const hr=new Date().getHours();
$("qqGreet").textContent=hr<6?"夜深了":hr<12?"上午好":hr<14?"中午好":hr<18?"下午好":"晚上好";
}
/* 当前播放列表面板：看全部队列，点任意一首跳过去 */
function renderQueue(){
  const el=$("fpQueueList"); if(!el) return;
  $("fpQueueTitle").textContent="播放列表（共 "+queue.length+" 首）";
  el.innerHTML="";
  if(!queue.length){ el.innerHTML='<p class="empty">队列是空的</p>'; return; }
  queue.forEach((s,i)=>{
    const b=document.createElement("div");
    b.className="song"+(i===qi?" cur":"");
    b.innerHTML=`<span class="idx">${i===qi?"▶":i+1}</span><span class="tt"><b></b><span></span></span>`;
    b.querySelector("b").textContent=dispTitle(s);
    b.querySelector(".tt span").textContent=dispArtist(s)+" · "+(s.f||"");
    b.onclick=()=>{ playAt(i); };
    el.appendChild(b);
  });
  const cur=el.children[qi];
  if(cur) cur.scrollIntoView({block:"center"});
}
/* v9.39 播放页视图机：disc（唱片）/lyrics（歌词）/detail（详情）/queue（列表），data-view 驱动浅色主题细节 */
function fpSetView(v){
  const fp=$("fullPlayer"); if(fp) fp.dataset.view=v;
  const cw=$("fpCoverWrap"); if(cw) cw.style.display=(v==="disc")?"flex":"none";
  $("fpLyrics").style.display=(v==="lyrics")?"block":"none";
  $("fpDetail").style.display=(v==="detail")?"block":"none";
  $("fpQueue").style.display=(v==="queue")?"block":"none";
  $("fpTab").textContent=(v==="disc")?"歌词":(v==="detail")?"唱片":"详情";
}
function showQueuePanel(show){
  $("fpQueue").style.display=show?"block":"none";
  $("fpLyrics").style.display=show?"none":"block";
  if(show){ $("fpDetail").style.display="none"; $("fpTab").textContent="详情"; renderQueue(); }
  fpSetView(show?"queue":"lyrics");
}
function renderPlayer(){
const s=queue[qi]; if(!s) return;
if($("fpQueue") && $("fpQueue").style.display!=="none") renderQueue();
$("miniPlayer").style.display="flex";
$("miniTitle").textContent=dispTitle(s);
$("miniArtist").textContent=dispArtist(s);
$("fpTitle").textContent=dispTitle(s);
$("fpArtist").textContent=dispArtist(s);
if($("fpBigTitle")){ $("fpBigTitle").textContent=dispTitle(s); $("fpBigArtist").textContent=dispArtist(s); } // v9.39 唱片视图大标题
renderDetail(s);
syncPlayBtns();
}
function syncPlayBtns(){
const ic=audio.paused?"▶":"⏸\uFE0E";
$("miniToggle").textContent=ic; $("fpToggle").textContent=ic;
const fp=$("fullPlayer"); if(fp) fp.classList.toggle("is-playing", !audio.paused); // v9.39 唱片旋转/唱针臂
}
function setPlayStatus(t){ $("playStatus").textContent=t||"";}
function showView(id){
document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===id));
document.querySelectorAll("#tabbar button").forEach(b=>b.classList.toggle("active",b.dataset.view===id));
}

/* ---------- 设置 ---------- */
/* ---------- 事件绑定 ---------- */
function bind(){
document.querySelectorAll("#tabbar button").forEach(b=>b.onclick=()=>showView(b.dataset.view));
let deb=null;
$("q").addEventListener("input",()=>{ clearTimeout(deb);
deb=setTimeout(()=>doSearch(false),300);});
$("q").addEventListener("keydown",e=>{ if(e.key==="Enter") doSearch(false, true);});
$("micBtn").onclick=voiceSearch;
$("refreshRec").onclick=()=>{ const prev=new Set(recCache.map(s=>s.p)); recCache=recommend(20,{exclude:prev}); recExpanded=false; renderRec(); toast(recCache.length?"已换一批推荐":"暂时没有更多推荐","",1500); };
$("recMore").onclick=()=>{ recExpanded=!recExpanded; renderRec(); };
/* 首页快捷入口 */
document.querySelectorAll(".qq-quick button").forEach(b=>{
  b.onclick=()=>{
    const go=b.dataset.go;
    if(go==="rec"){ document.getElementById("blockRec").scrollIntoView({behavior:"smooth"}); }
    else if(go==="recent"){ document.getElementById("blockRecent").scrollIntoView({behavior:"smooth"}); }
    else if(go==="folders"){ document.getElementById("blockFolders").scrollIntoView({behavior:"smooth"}); }
    else if(go==="shuffle"){
      if(!CATALOG.length) return;
      runMode=false;
      queue=CATALOG.slice();
      // 洗牌
      for(let i=queue.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [queue[i],queue[j]]=[queue[j],queue[i]]; }
      playAt(0); toast("随机播放全部歌曲 ♪","",2000);
    }
  };
});
$("carBtn").onclick=()=>{ document.body.classList.toggle("car");
$("carBtn").style.background=document.body.classList.contains("car")?"var(--acc)":"";};
$("runBtn").onclick=startRunRadio;
// 播放器
$("miniToggle").onclick=e=>{e.stopPropagation();togglePlay();};
$("miniNext").onclick=e=>{e.stopPropagation();next();};
$("miniPrev").onclick=e=>{e.stopPropagation();prev();};
$("miniPlayer").onclick=()=>{ $("fullPlayer").style.display="flex"; fpSetView("disc"); };
/* 迷你进度条：点按+拖动跳转 */
let scrubbing=false;
/* seek 统一走顶层 applySeek（v9.37；v9.35 的 seekClamp 误定义在本函数作用域内、歌词路径调不到，已删） */
function scrubTo(clientX){
  const r=$("miniProg").getBoundingClientRect();
  const ratio=Math.min(1,Math.max(0,(clientX-r.left)/r.width));
  if(audio.duration) applySeek(ratio*audio.duration);
}
$("miniProg").addEventListener("pointerdown",e=>{
  scrubbing=true;
  try{ $("miniProg").setPointerCapture(e.pointerId); }catch(_){}
  scrubTo(e.clientX); e.stopPropagation(); e.preventDefault();
});
$("miniProg").addEventListener("pointermove",e=>{ if(scrubbing) scrubTo(e.clientX); });
$("miniProg").addEventListener("pointerup",()=>{ scrubbing=false; });
$("miniProg").addEventListener("pointercancel",()=>{ scrubbing=false; });
$("closePlayer").onclick=()=>{ $("fullPlayer").style.display="none";};
$("fpToggle").onclick=togglePlay; $("fpNext").onclick=()=>next(); $("fpPrev").onclick=prev;
$("seek").addEventListener("input",()=>{ if(audio.duration) applySeek($("seek").value/1000*audio.duration);});
$("fpTab").onclick=()=>{
  const v=($("fullPlayer").dataset.view)||"lyrics";
  if(v==="disc") fpSetView("lyrics");
  else if(v==="lyrics"){ const s=queue[qi]; if(s) renderDetail(s); fpSetView("detail"); } // 进详情时重渲染（v9.15）
  else fpSetView("disc");
};
/* 播放页 QQ风按钮 */
$("fpLike").onclick=()=>{
  const song=queue[qi]; if(!song) return;
  if(fav[song.p]){ delete fav[song.p]; toast("已取消喜欢"); }
  else { fav[song.p]=Date.now(); toast("已加入我喜欢 ❤"); }
  saveFav(); updateLikeBtn(song);
};
$("fpDl").onclick=()=>{ const s=queue[qi]; if(s) renderDetail(s); fpSetView("detail"); };
$("fpCoverWrap").onclick=()=>fpSetView("lyrics"); // v9.39：点唱片卡看歌词（同参考视频）
$("fpShare").onclick=()=>{
  const song=queue[qi]; if(!song) return;
  const txt=`${dispTitle(song)} - ${dispArtist(song)}`;
  if(navigator.clipboard) navigator.clipboard.writeText(txt).catch(()=>{});
  toast("已复制："+txt,"",2000);
};
const fpSleepBtn=$("fpSleep"); if(fpSleepBtn) fpSleepBtn.onclick=openSleepModal;
const settingsSleepBtn=$("settingsSleep"); if(settingsSleepBtn) settingsSleepBtn.onclick=openSleepModal;
document.querySelectorAll("[data-sleep-min]").forEach(b=>{ b.onclick=()=>{ setSleepMinutes(Number(b.dataset.sleepMin)); closeSleepModal(); }; });
const sleepAfterBtn=$("sleepAfterSong"); if(sleepAfterBtn) sleepAfterBtn.onclick=()=>{ setSleepAfterSong(); closeSleepModal(); };
const sleepOffBtn=$("sleepOff"); if(sleepOffBtn) sleepOffBtn.onclick=()=>{ cancelSleep(); closeSleepModal(); };
const sleepCloseBtn=$("sleepClose"); if(sleepCloseBtn) sleepCloseBtn.onclick=closeSleepModal;
const sleepModalEl=$("sleepModal"); if(sleepModalEl) sleepModalEl.addEventListener("click",e=>{ if(e.target===sleepModalEl) closeSleepModal(); });
armSleepTimer();
$("fpMode").onclick=()=>{
  repeatOne=!repeatOne;
  $("fpMode").textContent=repeatOne?"↺¹":"↺"; // v9.40：单色字形（原 emoji 在浅色下是彩色块）
  toast(repeatOne?"单曲循环":"列表循环","",1500);
};
$("fpList").onclick=()=>{
  showQueuePanel($("fpQueue").style.display==="none");
};
$("fpQueueClose").onclick=()=>showQueuePanel(false);
// 设置
$("clearHist").onclick=()=>{ if(confirm("清除本机所有播放记录？推荐也会重置。")){ hist={}; saveHist(); searchTaste={terms:{},queries:[]}; saveSearchTaste(); listenSession=null; renderHome();}};
$("forceUpdate").onclick=async ()=>{
  if(!confirm("将清除本地缓存并重新加载最新版，继续？")) return;
  toast("正在更新…", "", 0);
  try{
    if("serviceWorker" in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      for(const r of regs) await r.unregister();
    }
    if("caches" in window){
      const keys=await caches.keys();
      for(const k of keys) await caches.delete(k);
    }
  }catch(e){}
  location.replace(location.pathname + "?u=" + Date.now()); // 破 4 小时 HTTP 缓存：换 URL 取新版首页
};
$("appVer").textContent=APP_VER;
/* v9.43 接线：主题三档 / 搬家 / 字形 / 进度条拖动变粗 */
/* v9.45 首页「每日推荐」特色卡：直接播推荐队列 */
const featDailyEl=$("featDaily");
if(featDailyEl) featDailyEl.onclick=()=>{ runMode=false; const recs=recommend(30,{fresh:true});
  if(recs.length){ queue=recs.slice(); playAt(0); } else toast("多听几首，推荐就来了"); };
document.querySelectorAll("#themeRow button").forEach(b=>{ b.onclick=()=>{ cfg.theme=b.dataset.theme; saveCfg(); applyTheme(); toast(b.dataset.theme==="auto"?"外观：跟随系统":(b.dataset.theme==="light"?"外观：浅色":"外观：深色"),"ok",1800); }; });
applyTheme();
if(sessionStorage.getItem("zmusic.mvmsg")){ sessionStorage.removeItem("zmusic.mvmsg"); setTimeout(()=>toast("已从旧地址搬入：喜欢、设置与云歌单登录","ok",5000), 600); }
const mvRow=$("mvRow"), mvHint=$("mvHint");
if(location.hostname!=="app.ipls.cn"){ if(mvRow) mvRow.style.display="none"; if(mvHint) mvHint.style.display="none"; }
else if($("mvBtn")){ $("mvBtn").onclick=()=>{
  const keys=["zmusic.cfg.v1","zmusic.fav.v1","zmusic.hist.v1","zmusic.search.v1","zmusic.sleep.v1","zmusic.cloud.token","zmusic.cloud.user"];
  const d={}; for(const k of keys){ const v=localStorage.getItem(k); if(v!=null) d[k]=v; }
  location.href="https://mp3.ipls.cn/#mv1="+btoa(unescape(encodeURIComponent(JSON.stringify(d))));
}; }
$("fpPrev").textContent="⏮\uFE0E"; $("fpNext").textContent="⏭\uFE0E";
$("miniPrev").textContent="⏮\uFE0E"; $("miniNext").textContent="⏭\uFE0E";
const skEl=$("seek");
if(skEl){ const on=()=>skEl.classList.add("seeking"), off=()=>skEl.classList.remove("seeking");
  skEl.addEventListener("pointerdown",on); skEl.addEventListener("pointerup",off); skEl.addEventListener("pointercancel",off);
  skEl.addEventListener("touchstart",on,{passive:true}); skEl.addEventListener("touchend",off); }
try{ localStorage.removeItem(DIAG_KEY); }catch(e){} // v9.37：清掉旧诊断日志存档
}

/* ---------- 启动 ---------- */
/* v9.50：播放位置存档——每 5 秒记一次；页面被系统重载/重开后恢复到断点（迷你条暂停待播，按播放接着听） */
setInterval(()=>{ if(!audio.paused && queue[qi] && audio.currentTime>5 && !audio.ended){ try{ localStorage.setItem("zmusic.resume", JSON.stringify({p:queue[qi].p, ct:Math.floor(audio.currentTime), ts:Date.now()})); }catch(e){} } }, 5000);
audio.addEventListener("ended", ()=>{ try{ localStorage.removeItem("zmusic.resume"); }catch(e){} });
function tryRestoreResume(){
  let rec=null; try{ rec=JSON.parse(localStorage.getItem("zmusic.resume")||"null"); }catch(e){}
  if(!rec || !rec.p || !rec.ct || rec.ct<5 || Date.now()-rec.ts>12*3600*1000) return;
  const s=CATALOG.find(x=>x.p===rec.p); if(!s) return;
  queue=[s]; qi=0; s._onStream=true;
  renderPlayer(); updateMediaSession(s);
  // 直链要经 SW 带凭据：DOMContentLoaded 时 SW 可能还没接管，裸请求会被 NAS 以 401 拒（实测 error/NO_SOURCE）。
  // 等 SW ready 并推送凭据后再挂源；3 秒仍无数据再兜底重挂一次。
  const arm=()=>{ audio.src=songUrl(s);
    audio.addEventListener("loadedmetadata", function h(){ audio.removeEventListener("loadedmetadata",h); try{ audio.currentTime=rec.ct; }catch(e){} }); };
  if(navigator.serviceWorker && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then(()=>{ try{ pushAuthToSW(); }catch(e){} arm(); }).catch(()=>arm());
  else arm();
  setTimeout(()=>{ if(queue[qi]===s && audio.readyState===0 && !s._played){ try{ pushAuthToSW(); }catch(e){} arm(); } }, 3000);
}
document.addEventListener("DOMContentLoaded",()=>{
if(typeof CATALOG==="undefined"||!CATALOG.length){ alert("曲库加载失败"); return;}
bind(); renderHome();
tryRestoreResume();
if("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js", {updateViaCache:"none"}).catch(()=>{});
  // SW 就绪后把认证头推过去
  navigator.serviceWorker.ready.then(()=>pushAuthToSW()).catch(()=>{});
  setTimeout(pushAuthToSW, 3000); // 兜底再推一次
}
});

/* ---------- 云端账号：登录/收藏同步/歌单（Cloudflare D1） ---------- */
function refreshAccountUI(){
  const logged = Cloud.loggedIn();
  $("userBtn").textContent = logged ? "👤" : "👤";
  $("userBtn").style.color = logged ? "var(--acc2)" : "";
  $("userBtn").title = logged ? Cloud.username() + "（已登录）" : "登录 / 注册";
  $("accountBtn").style.display = logged ? "none" : "";
  $("logoutBtn").style.display = logged ? "" : "none";
  $("accountHint").textContent = logged
    ? "已登录：" + Cloud.username() + "，收藏、歌单、播放记录多设备同步。"
    : "游客模式：收藏和记录只保存在这台设备。登录后多设备同步。";
}
let loginMode = "login";
function setLoginMode(m){
  loginMode = m;
  $("loginTitle").textContent = m === "login" ? "登录" : "注册";
  $("loginGo").textContent = m === "login" ? "登录" : "注册";
  $("tabLogin").classList.toggle("active", m === "login");
  $("tabRegister").classList.toggle("active", m !== "login");
}
function openLogin(){ setLoginMode("login"); $("loginErr").style.display = "none"; $("loginModal").style.display = "flex"; }
function closeLogin(){ $("loginModal").style.display = "none"; }

async function doLoginGo(){
  const u = $("loginUser").value.trim(), p = $("loginPass").value;
  const errEl = $("loginErr");
  errEl.style.display = "none";
  $("loginGo").disabled = true;
  try{
    const j = loginMode === "login" ? await Cloud.login(u, p) : await Cloud.register(u, p);
    if(!j.ok){ errEl.textContent = j.error || "失败了，重试一次"; errEl.style.display = "block"; return; }
    if(loginMode === "register"){
      const lj = await Cloud.login(u, p);
      if(!lj.ok){ errEl.textContent = "注册成功，但自动登录失败，请手动登录"; errEl.style.display = "block"; setLoginMode("login"); return; }
    }
    closeLogin(); toast("欢迎回来，" + Cloud.username(), "", 2000);
    await afterLogin();
  }catch(e){
    errEl.textContent = "连不上服务器，检查网络再试"; errEl.style.display = "block";
  }finally{
    $("loginGo").disabled = false;
  }
}
async function afterLogin(){
  refreshAccountUI();
  // 收藏双向合并：本地 ∪ 云端
  try{
    const j = await Cloud.getFavorites();
    if(j.ok){
      const cloudIds = new Set(j.favorites.map(f=>f.song_id));
      for(const p of Object.keys(fav)) if(!cloudIds.has(p)) await Cloud.addFavorite(p);
      for(const f of j.favorites) if(!fav[f.song_id]) fav[f.song_id] = Date.now();
      saveFav();
      const s = queue[qi]; if(s) updateLikeBtn(s);
    }
  }catch(e){}
  renderPlaylists();
}
// 喜欢按钮：本地 + 云端同步
function bindCloudFav(){
  const btn = $("fpLike");
  btn.onclick = async ()=>{
    const song = queue[qi]; if(!song) return;
    if(fav[song.p]){ delete fav[song.p]; toast("已取消喜欢"); if(Cloud.loggedIn()) Cloud.delFavorite(song.p); }
    else { fav[song.p] = Date.now(); toast("已加入我喜欢 ❤"); if(Cloud.loggedIn()) Cloud.addFavorite(song.p); }
    saveFav(); updateLikeBtn(song);
  };
}
// 播放记录：本地照记，登录后顺手上报云端
const _logPlay = logPlay;
logPlay = function(song, completed){
  if(runMode) return; // 跑步模式：本地不记、云端也不上报
  _logPlay(song, completed);
  if(Cloud.loggedIn() && song && song.p) Cloud.postHistory(song.p);
};

/* ---------- 云端歌单 ---------- */
async function renderPlaylists(){
  const el = $("playlistList");
  $("playlistDetailBlock").style.display = "none";
  if(!Cloud.loggedIn()){
    el.innerHTML = '<p class="empty">登录后歌单多设备同步</p>';
    return;
  }
  el.innerHTML = '<p class="empty">加载中…</p>';
  try{
    const j = await Cloud.getPlaylists();
    if(!j.ok){ el.innerHTML = '<p class="empty">加载失败，点歌单标签重试</p>'; return; }
    if(!j.playlists.length){ el.innerHTML = '<p class="empty">还没有歌单，点右上角「＋新建」</p>'; return; }
    el.innerHTML = "";
    j.playlists.forEach(p=>{
      const b = document.createElement("div"); b.className = "song";
      b.innerHTML = `<span class="idx">🎵</span><span class="tt"><b></b><span></span></span><span class="go">▶</span>`;
      b.querySelector("b").textContent = p.name;
      b.querySelector(".tt span").textContent = p.count + " 首";
      const del = document.createElement("button");
      del.className = "mini-btn"; del.textContent = "删除"; del.style.marginLeft = "8px";
      del.onclick = async e=>{
        e.stopPropagation();
        if(!confirm("删除歌单《" + p.name + "》？")) return;
        await Cloud.delPlaylist(p.id); renderPlaylists();
      };
      b.appendChild(del);
      b.onclick = ()=>openPlaylistDetail(p.id, p.name);
      el.appendChild(b);
    });
  }catch(e){ el.innerHTML = '<p class="empty">网络异常，稍后重试</p>'; }
}
async function openPlaylistDetail(id, name){
  $("playlistDetailName").textContent = name;
  $("playlistDetailBlock").style.display = "block";
  const el = $("playlistDetailList");
  el.innerHTML = '<p class="empty">加载中…</p>';
  try{
    const j = await Cloud.getPlaylistItems(id);
    if(!j.ok){ el.innerHTML = '<p class="empty">加载失败</p>'; return; }
    const songs = j.items.map(byPath).filter(Boolean);
    if(!songs.length){ el.innerHTML = '<p class="empty">歌单是空的，去播放页点 ＋ 加歌</p>'; return; }
    el.innerHTML = "";
    songs.forEach((s, i)=>{
      const b = document.createElement("div"); b.className = "song";
      b.innerHTML = `<span class="idx">${i+1}</span><span class="tt"><b></b><span></span></span><span class="go">▶</span>`;
      b.querySelector("b").textContent = dispTitle(s);
      b.querySelector(".tt span").textContent = dispArtist(s);
      const del = document.createElement("button");
      del.className = "mini-btn"; del.textContent = "移除"; del.style.marginLeft = "8px";
      del.onclick = async e=>{
        e.stopPropagation();
        await Cloud.delPlaylistItem(id, s.p); openPlaylistDetail(id, name);
      };
      b.appendChild(del);
      b.onclick = ()=>{ queue = songs.slice(); playAt(i); };
      el.appendChild(b);
    });
  }catch(e){ el.innerHTML = '<p class="empty">网络异常，稍后重试</p>'; }
}
function openAddToPlaylist(){
  const song = queue[qi]; if(!song){ toast("先播一首歌"); return; }
  if(!Cloud.loggedIn()){ openLogin(); toast("登录后才能用歌单", "", 2000); return; }
  const list = $("addToPlaylistList");
  list.innerHTML = '<p class="empty">加载中…</p>';
  $("addToPlaylistModal").style.display = "flex";
  Cloud.getPlaylists().then(j=>{
    list.innerHTML = "";
    const mk = (name, onclick)=>{
      const b = document.createElement("button"); b.className = "song";
      b.innerHTML = `<span class="idx">＋</span><span class="tt"><b></b></span>`;
      b.querySelector("b").textContent = name;
      b.onclick = onclick; list.appendChild(b);
    };
    mk("＋ 新建歌单…", async ()=>{
      const name = prompt("新歌单名字：", "我的歌单");
      if(!name || !name.trim()) return;
      const c = await Cloud.createPlaylist(name.trim());
      if(c.ok){ await Cloud.addPlaylistItem(c.id, song.p); toast("已加入《" + name.trim() + "》"); }
      else toast(c.error || "新建失败");
      $("addToPlaylistModal").style.display = "none"; renderPlaylists();
    });
    (j.ok ? j.playlists : []).forEach(p=>{
      mk(p.name, async ()=>{
        const r = await Cloud.addPlaylistItem(p.id, song.p);
        toast(r.ok ? "已加入《" + p.name + "》" : (r.error || "加入失败"));
        $("addToPlaylistModal").style.display = "none"; renderPlaylists();
      });
    });
  }).catch(()=>{ list.innerHTML = '<p class="empty">网络异常</p>'; });
}
function bindCloud(){
  $("userBtn").onclick = ()=>{ Cloud.loggedIn() ? showView("view-settings") : openLogin(); };
  $("accountBtn").onclick = openLogin;
  $("logoutBtn").onclick = async ()=>{
    if(!confirm("退出登录？本机收藏保留，云端数据不受影响。")) return;
    await Cloud.logout(); refreshAccountUI(); renderPlaylists(); toast("已退出");
  };
  $("tabLogin").onclick = ()=>setLoginMode("login");
  $("tabRegister").onclick = ()=>setLoginMode("register");
  $("loginGo").onclick = doLoginGo;
  $("loginGuest").onclick = ()=>{ closeLogin(); toast("游客模式：收藏只保存在这台设备", "", 2500); };
  $("loginClose").onclick = closeLogin;
  $("loginPass").addEventListener("keydown", e=>{ if(e.key === "Enter") doLoginGo(); });
  $("newPlaylistBtn").onclick = async ()=>{
    if(!Cloud.loggedIn()){ openLogin(); return; }
    const name = prompt("新歌单名字：", "我的歌单");
    if(!name || !name.trim()) return;
    const j = await Cloud.createPlaylist(name.trim());
    if(j.ok){ toast("已新建《" + name.trim() + "》"); renderPlaylists(); }
    else toast(j.error || "新建失败");
  };
  $("backToPlaylists").onclick = renderPlaylists;
  $("fpAdd").onclick = openAddToPlaylist;
  $("addToPlaylistClose").onclick = ()=>{ $("addToPlaylistModal").style.display = "none"; };
  bindCloudFav();
  refreshAccountUI();
  // 切到歌单页时刷新
  document.querySelectorAll('#tabbar button[data-view="view-playlists"]').forEach(b=>{
    b.addEventListener("click", renderPlaylists);
  });
}
document.addEventListener("DOMContentLoaded", ()=>{ bindCloud(); });
