/* 知行音乐 v1 — NAS 私有曲库播放器 */
"use strict";
const $ = id => document.getElementById(id);
const APP_VER = "v7.7 2026-10-07";

/* ---------- 配置 ---------- */
const CFG_KEY = "zmusic.cfg.v1";
function loadCfg(){
try{ return Object.assign({dav:"https://nas.yjm.ccwu.cc/dav",user:"ai",pass:""},
JSON.parse(localStorage.getItem(CFG_KEY)||"{}"));}
catch(e){ return {dav:"https://nas.yjm.ccwu.cc/dav",user:"ai",pass:""};}
}
let cfg = loadCfg();
function saveCfg(){ localStorage.setItem(CFG_KEY, JSON.stringify(cfg));}

/* ---------- 工具 ---------- */
function b64encodeUnicode(s){
const bytes = new TextEncoder().encode(s);
let bin = ""; bytes.forEach(b=>bin+=String.fromCharCode(b));
return btoa(bin);
}
function authHeader(){ return "Basic " + b64encodeUnicode(cfg.user+":"+cfg.pass);}
function songUrl(song){
const base = cfg.dav.replace(/\/+$/,"");
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
const el=$("toast"); el.textContent=msg; el.className=cls; el.style.display="block";
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
/* 歌词/封面：单独取文件头 2MB 解析，不阻塞播放 */
async function getSongMeta(song){
  if(metaCache[song.p]) return metaCache[song.p];
  const m={lyrics:null,coverUrl:null};
  try{
    const r=await fetch(songUrl(song),{
      headers:{Authorization:authHeader(), Range:"bytes=0-2097151"}
    });
    if(r.ok){
      const id3=parseID3(await r.arrayBuffer());
      m.coverUrl=id3.coverUrl;
      if(id3.lyrics) m.lyrics=parseLRC(id3.lyrics);
    }
  }catch(e){}
  metaCache[song.p]=m;
  return m;
}
/* 把认证头推给 SW，用于 <audio> 直链 */
function pushAuthToSW(){
  const msg={type:"SET_AUTH", auth:authHeader()};
  try{
    if(navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage(msg);
    if("serviceWorker" in navigator){
      navigator.serviceWorker.ready.then(reg=>{ if(reg.active) reg.active.postMessage(msg); }).catch(()=>{});
    }
  }catch(e){}
}
function renderLyrics(){
  const el=$("fpLyrics"); el.innerHTML=""; curLrcIdx=-1;
  if(!curLyrics.length){
    el.innerHTML='<div class="lrc-line">这首歌没有内嵌歌词</div>'; return;
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
  if(ch[idx]){
    ch[idx].className="lrc-line active";
    ch[idx].scrollIntoView({block:"center",behavior:"smooth"});
  }
}
function renderDetail(s){
  const fmt=(s.p.split(".").pop()||"").toUpperCase();
  $("fpDetail").innerHTML=
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

/* ---------- 播放历史 ---------- */
const HIST_KEY="zmusic.hist.v1";
let hist={};
try{ hist=JSON.parse(localStorage.getItem(HIST_KEY)||"{}");}catch(e){ hist={};}
function saveHist(){ try{localStorage.setItem(HIST_KEY,JSON.stringify(hist));}catch(e){}}
function logPlay(song, completed){
const k=songKey(song), h=hist[k]||{c:0,l:0};
h.c++; h.l=Date.now(); if(completed) h.done=(h.done||0)+1;
hist[k]=h; saveHist();
}

/* ---------- 音频播放 ---------- */
const audio = new Audio();
audio.preload="auto";
let queue=[], qi=-1, objCache={}, blobCache={}, loading=false;

async function blobUrl(song){
if(objCache[song.p]) return objCache[song.p];
const url=songUrl(song);
let lastErr=null;
for(let attempt=0;attempt<3;attempt++){
try{
const r=await fetch(url,{headers:{Authorization:authHeader()}});
if(r.status===401) throw {code:401,msg:"账号或密码不对（401），去设置页检查"};
if(r.status===502||r.status===503||r.status===504){
  lastErr={code:r.status,msg:"NAS 返回 "+r.status};
  toast("网络抖动，正在重试…("+(attempt+1)+"/3)");
  await new Promise(r2=>setTimeout(r2,1500)); continue;
}
if(!r.ok) throw {code:r.status,msg:"NAS 返回 "+r.status};
const blob=await r.blob();
const ou=URL.createObjectURL(blob);
objCache[song.p]=ou; blobCache[song.p]=blob;
if(Object.keys(objCache).length>8){
const old=Object.keys(objCache)[0];
URL.revokeObjectURL(objCache[old]); delete objCache[old]; delete blobCache[old];
}
return ou;
}catch(e){
if(e&&e.code===401) throw e;
if(e instanceof TypeError){ lastErr=e; await new Promise(r2=>setTimeout(r2,1500)); continue; }
throw e;
}
}
throw lastErr||{code:0,msg:"重试3次仍失败"};
}

/* 双保险播放：先流式秒播，后台下载完整文件后无缝切换（保锁屏） */
let fbRetry=false;
function trySwapToBlob(song){
  if(!song || queue[qi]!==song || song._swapped) return;
  const ou=objCache[song.p];
  if(!ou) return;
  if(document.visibilityState!=="visible") return;
  if(audio.paused || audio.readyState<2) return;
  try{
    song._swapped=true;
    const t=audio.currentTime;
    audio.src=ou;
    audio.currentTime=t;
    audio.play().catch(()=>{ song._swapped=false; });
  }catch(e){ song._swapped=false; }
}
/* 预取下一首：音频+歌词封面，播完自动切时直接用本地，锁屏也能连播 */
function prefetchNext(){
  if(!queue.length) return;
  const n=queue[(qi+1)%queue.length];
  if(n && n!==queue[qi] && !n._prefetching){
    n._prefetching=true;
    blobUrl(n).catch(()=>{}).finally(()=>{ n._prefetching=false; });
    getSongMeta(n).catch(()=>{});
  }
}
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible") trySwapToBlob(queue[qi]);
});
function playAt(i, autoplay=true){
if(i<0||i>=queue.length) return;
qi=i; const song=queue[qi]; fbRetry=false;
song._swapped=false;
// 有预取好的本地文件就直接用（锁屏连播可靠），否则走流式秒播
const cached=objCache[song.p];
if(cached){ audio.src=cached; song._swapped=true; }
else { audio.src=songUrl(song); }
loading=true; setPlayStatus("正在加载…");
toast("正在加载《"+dispTitle(song)+"》…");
curLyrics=[]; renderLyrics();
$("fpCoverImg").style.display="none"; $("fpCoverPh").style.display="block";
$("miniCover").classList.add("hide");
renderPlayer(); updateMediaSession(song);
logPlay(song,false);
getSongMeta(song).then(m=>{
  if(queue[qi]!==song) return;
  curLyrics=m.lyrics||[]; renderLyrics();
  if(m.coverUrl){ $("fpCoverImg").src=m.coverUrl; $("fpCoverImg").style.display="block"; $("fpCoverPh").style.display="none";
    $("miniCover").src=m.coverUrl; $("miniCover").classList.remove("hide"); }
});
// 后台下载完整文件，好了就无缝切到本地（锁屏也能播）
blobUrl(song).then(()=>trySwapToBlob(song)).catch(()=>{});
if(autoplay){
  const pr=audio.play();
  if(pr && pr.then){
    pr.then(()=>{ loading=false; setPlayStatus(""); hideToast(); prefetchNext(); })
      .catch(e=>playFallback(song,e));
  } else { loading=false; hideToast(); prefetchNext(); }
}else{ loading=false; hideToast(); }
}
// 直链失败（如 SW 还没拿到凭据）→ 回退到 fetch+blob
audio.addEventListener("error",()=>{
  const song=queue[qi];
  if(song && !fbRetry && audio.readyState<2 && !audio.currentTime){
    fbRetry=true; playFallback(song, new Error("audio error"));
  }
});
async function playFallback(song, origErr){
  if(queue[qi]!==song) return;
  toast("正在加载《"+dispTitle(song)+"》…");
  try{
    audio.src=await blobUrl(song);
    await audio.play();
    loading=false; setPlayStatus(""); hideToast();
    renderPlayer();
  }catch(e){
    loading=false;
    let msg="";
    if(e && e.code===401){ msg=e.msg; }
    else if(e instanceof TypeError){
      msg="连不上 NAS：可能是反代没开，或没配 CORS。去设置页点“测试连接”。";
    }
    else if(e && e.name==="NotAllowedError"){ msg="iOS 阻止了播放：请再点一次这首歌"; }
    else msg="播放失败："+((e&&e.msg)||e);
    setPlayStatus(msg); toast(msg,"err",8000);
    if(e && e.code===401) alert(e.msg);
  }
}
function togglePlay(){
if(!audio.src && queue.length) return playAt(0);
if(audio.paused) audio.play(); else audio.pause();
}
function next(auto=false){
if(!queue.length) return;
const n=(qi+1)%queue.length;
playAt(n);
}
function prev(){
if(!queue.length) return;
if(audio.currentTime>3){ audio.currentTime=0; return;}
playAt((qi-1+queue.length)%queue.length);
}
audio.addEventListener("ended",()=>{ const s=queue[qi]; if(s) logPlay(s,true); next(true);});
audio.addEventListener("play",syncPlayBtns);
audio.addEventListener("pause",syncPlayBtns);
audio.addEventListener("timeupdate",()=>{
if(audio.duration){ $("seek").value=Math.floor(audio.currentTime/audio.duration*1000);
$("tCur").textContent=fmtTime(audio.currentTime);
const pct=(audio.currentTime/audio.duration*100);
$("miniProgFill").style.width=pct+"%"; $("miniProgKnob").style.left=pct+"%";}
syncLyrics();
});
audio.addEventListener("loadedmetadata",()=>{ $("tDur").textContent=fmtTime(audio.duration);});

/* ---------- 锁屏/耳机控制 ---------- */
function updateMediaSession(song){
if(!("mediaSession" in navigator)) return;
try{
navigator.mediaSession.metadata=new MediaMetadata({
title:dispTitle(song), artist:dispArtist(song), album:song.f||"知行音乐"});
const h={play:()=>audio.play(),pause:()=>audio.pause(),
previoustrack:prev,nexttrack:()=>next()};
for(const k in h){ try{navigator.mediaSession.setActionHandler(k,h[k]);}catch(e){}}
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
rec.onresult=e=>{
const txt=e.results[0][0].transcript||"";
btn.classList.remove("listening");
$("voiceHint").textContent="听到："+txt;
const cleaned=txt.replace(/^(播放|来一首|放一首|唱一首|点一首)/,"").trim();
$("q").value=cleaned||txt;
doSearch(true);
};
rec.onerror=()=>{ btn.classList.remove("listening");
$("voiceHint").textContent="没听清，再试一次，或用键盘输入。";};
rec.onend=()=>btn.classList.remove("listening");
try{ rec.start();}catch(e){ btn.classList.remove("listening");}
}
function doSearch(autoplay){
const q=$("q").value.trim();
const list=searchSongs(q);
renderSongs($("searchList"), list, true);
window.scrollTo(0,0);
if(autoplay && list.length){ queue=list.slice(); playAt(0);}
else if(autoplay){ $("voiceHint").textContent+="（曲库里没找到，换个说法试试）";}
}

/* ---------- 推荐 ---------- */
function artistScore(){
const m={}; let max=0;
for(const k in hist){
const s=byPath(k); if(!s||!s.a) continue;
m[s.a]=(m[s.a]||0)+hist[k].c; if(m[s.a]>max) max=m[s.a];
}
return {m,max:max||1};
}
function folderScore(){
const m={}; let max=0;
for(const k in hist){
const s=byPath(k); if(!s) continue;
m[s.f]=(m[s.f]||0)+hist[k].c; if(m[s.f]>max) max=m[s.f];
}
return {m,max:max||1};
}
const pathMap={};
function byPath(p){
if(!pathMap.built){ for(const s of CATALOG) pathMap[s.p]=s; pathMap.built=true;}
return pathMap[p];
}
function recommend(n=20){
const {m:am, max:amx}=artistScore(), {m:fm, max:fmx}=folderScore();
const now=Date.now(), out=[];
for(const s of CATALOG){
const h=hist[s.p];
if(h && now-h.l < 6*3600*1000) continue; // 6小时内听过的不推
let sc=0;
if(s.a&&am[s.a]) sc+=3*am[s.a]/amx;
if(fm[s.f]) sc+=1.5*fm[s.f]/fmx;
if(!h) sc+=0.4; // 没听过的加权
if(sc>0) out.push({s,sc});
}
out.sort((a,b)=>b.sc-a.sc);
return out.slice(0,n).map(x=>x.s);
}
function recentPlayed(n=10){
return Object.keys(hist).map(k=>({s:byPath(k),l:hist[k].l}))
.filter(x=>x.s).sort((a,b)=>b.l-a.l).slice(0,n).map(x=>x.s);
}

/* ---------- 渲染 ---------- */
function renderSongs(el, songs, asQueue){
el.innerHTML="";
if(!songs.length){ el.innerHTML='<p class="empty">没找到，换个关键词试试</p>'; return;}
songs.forEach((s,i)=>{
const b=document.createElement("button"); b.className="song";
b.innerHTML=`<span class="idx">${i+1}</span><span class="tt"><b></b><span></span></span><span class="go">▶</span>`;
b.querySelector("b").textContent=dispTitle(s);
b.querySelector(".tt span").textContent=dispArtist(s)+" · "+(s.f||"");
b.onclick=()=>{ if(asQueue){ queue=songs.slice();} playAt(asQueue?i:queueIndexOf(s));};
el.appendChild(b);
});
}
function queueIndexOf(s){
let i=queue.indexOf(s);
if(i<0){ queue=queue.concat([s]); i=queue.length-1;}
return i;
}
function renderHome(){
renderSongs($("recentList"), recentPlayed(10), false);
recCache=[]; recExpanded=false; renderRec();
// 合集
const folders={};
for(const s of CATALOG){ folders[s.f]=folders[s.f]||{n:s.f,c:0}; folders[s.f].c++;}
const fl=$("folderList"); fl.innerHTML="";
Object.values(folders).sort((a,b)=>b.c-a.c).forEach(f=>{
const b=document.createElement("button"); b.className="folder";
b.innerHTML=`<b>${f.c}</b><span></span>`;
b.querySelector("span").textContent=f.n;
b.onclick=()=>{ const ss=CATALOG.filter(s=>s.f===f.n);
$("q").value=""; showView("view-search"); renderSongs($("searchList"),ss,true);
window.scrollTo(0,0); toast("已载入《"+f.n+"》"+ss.length+"首，点一首开始播", "", 2500);};
fl.appendChild(b);
});
$("libCount").textContent=CATALOG.length;
}
function renderPlayer(){
const s=queue[qi]; if(!s) return;
$("miniPlayer").style.display="flex";
$("miniTitle").textContent=dispTitle(s);
$("miniArtist").textContent=dispArtist(s);
$("fpTitle").textContent=dispTitle(s);
$("fpArtist").textContent=dispArtist(s);
renderDetail(s);
syncPlayBtns();
}
function syncPlayBtns(){
const ic=audio.paused?"▶":"⏸";
$("miniToggle").textContent=ic; $("fpToggle").textContent=ic;
}
function setPlayStatus(t){ $("playStatus").textContent=t||"";}
function showView(id){
document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===id));
document.querySelectorAll("#tabbar button").forEach(b=>b.classList.toggle("active",b.dataset.view===id));
}

/* ---------- 设置 ---------- */
async function testConn(){
const el=$("connStatus"); el.className="hint"; el.textContent="测试中…";
const base=cfg.dav.replace(/\/+$/,"");
try{
const r=await fetch(base+"/music/",{method:"PROPFIND",
headers:{Authorization:authHeader(),Depth:"1"}});
if(r.status===207){ el.className="hint ok"; el.textContent="✅ 连接正常，可以播歌了";}
else if(r.status===401){ el.className="hint err"; el.textContent="❌ 账号或密码不对（401）";}
else { el.className="hint err"; el.textContent="❌ NAS 返回 "+r.status+"，检查音乐地址";}
}catch(e){
el.className="hint err";
el.textContent="❌ 连不上：反代可能没开，或没按说明配 CORS（看 README 的 nginx 片段）";
}
}

/* ---------- 事件绑定 ---------- */
function bind(){
document.querySelectorAll("#tabbar button").forEach(b=>b.onclick=()=>showView(b.dataset.view));
let deb=null;
$("q").addEventListener("input",()=>{ clearTimeout(deb);
deb=setTimeout(()=>doSearch(false),300);});
$("q").addEventListener("keydown",e=>{ if(e.key==="Enter") doSearch(false);});
$("micBtn").onclick=voiceSearch;
$("refreshRec").onclick=()=>{ recCache=[]; recExpanded=false; renderRec(); };
$("recMore").onclick=()=>{ recExpanded=!recExpanded; renderRec(); };
$("carBtn").onclick=()=>{ document.body.classList.toggle("car");
$("carBtn").style.background=document.body.classList.contains("car")?"var(--acc)":"";};
// 播放器
$("miniToggle").onclick=e=>{e.stopPropagation();togglePlay();};
$("miniNext").onclick=e=>{e.stopPropagation();next();};
$("miniPrev").onclick=e=>{e.stopPropagation();prev();};
$("miniPlayer").onclick=()=>{ $("fullPlayer").style.display="flex";
$("fpDetail").style.display="none"; $("fpLyrics").style.display="block"; $("fpTab").textContent="详情";};
/* 迷你进度条：点按+拖动跳转 */
let scrubbing=false;
function scrubTo(clientX){
  const r=$("miniProg").getBoundingClientRect();
  const ratio=Math.min(1,Math.max(0,(clientX-r.left)/r.width));
  if(audio.duration) audio.currentTime=ratio*audio.duration;
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
$("seek").addEventListener("input",()=>{ if(audio.duration) audio.currentTime=$("seek").value/1000*audio.duration;});
$("fpTab").onclick=()=>{
  const showDetail=$("fpDetail").style.display==="none";
  $("fpDetail").style.display=showDetail?"block":"none";
  $("fpLyrics").style.display=showDetail?"none":"block";
  $("fpTab").textContent=showDetail?"歌词":"详情";
};
// 设置
$("saveCfg").onclick=()=>{ cfg.dav=$("cfgDav").value.trim()||cfg.dav;
cfg.user=$("cfgUser").value.trim()||"ai"; cfg.pass=$("cfgPass").value;
saveCfg(); pushAuthToSW();
$("connStatus").className="hint"; $("connStatus").textContent="已保存";};
$("testConn").onclick=testConn;
$("clearHist").onclick=()=>{ if(confirm("清除本机所有播放记录？")){ hist={}; saveHist(); renderHome();}};
$("cfgDav").value=cfg.dav; $("cfgUser").value=cfg.user; $("cfgPass").value=cfg.pass||"";
$("appVer").textContent=APP_VER;
}

/* ---------- 启动 ---------- */
document.addEventListener("DOMContentLoaded",()=>{
if(typeof CATALOG==="undefined"||!CATALOG.length){ alert("曲库加载失败"); return;}
bind(); renderHome();
if("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").catch(()=>{});
  // SW 就绪后把认证头推过去
  navigator.serviceWorker.ready.then(()=>pushAuthToSW()).catch(()=>{});
  setTimeout(pushAuthToSW, 3000); // 兜底再推一次
}
});
