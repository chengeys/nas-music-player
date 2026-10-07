/* 知行音乐 v1 — NAS 私有曲库播放器 */
"use strict";
const $ = id => document.getElementById(id);
const APP_VER = "v8.9 2026-10-07";

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
const k=songKey(song), h=hist[k]||{c:0,l:0};
h.c++; h.l=Date.now(); if(completed) h.done=(h.done||0)+1;
hist[k]=h; saveHist();
}

/* ---------- 音频播放 ---------- */
const audio = new Audio();
audio.preload="auto";
audio.autoplay=true; // 换源后自动播，iOS 当连续播放处理
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
/* 跟踪是否真正在播放（playing 事件），避免切源时撞车 */
let audioPlaying=false;
audio.addEventListener("playing",()=>{
  audioPlaying=true;
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
song._swapped=false; song._preSwitched=false;
// 有预取好的本地文件就直接用（锁屏连播可靠），否则走流式秒播
const cached=objCache[song.p];
audioPlaying=false;
if(cached){ audio.src=cached; song._swapped=true; }
else { audio.src=songUrl(song); }
// play() 越早调越好（锁屏自动连播就靠这一手）
let playPromise=null;
if(autoplay){
  try{ playPromise=audio.play(); }catch(e){ playPromise=Promise.reject(e); }
}
loading=true; setPlayStatus("正在加载…");
if(autoplay) toast("正在加载《"+dispTitle(song)+"》…");
curLyrics=[]; renderLyrics();
$("fpCoverImg").style.display="none"; $("fpCoverPh").style.display="block";
$("miniCover").classList.add("hide");
renderPlayer(); updateMediaSession(song);
logPlay(song,false);
getSongMeta(song).then(m=>{
  if(queue[qi]!==song) return;
  curLyrics=m.lyrics||[]; renderLyrics();
  if(m.coverUrl){
    $("fpCoverImg").src=m.coverUrl; $("fpCoverImg").style.display="block"; $("fpCoverPh").style.display="none";
    $("miniCover").src=m.coverUrl; $("miniCover").classList.remove("hide");
    $("fpBg").style.backgroundImage=`url("${m.coverUrl}")`;
  } else { $("fpBg").style.backgroundImage="none"; }
  updateLikeBtn(song);
});
// 后台下载完整文件，好了就无缝切到本地（锁屏也能播）
blobUrl(song).then(()=>trySwapToBlob(song)).catch(()=>{});
if(playPromise && playPromise.then){
  playPromise.then(()=>{ loading=false; setPlayStatus(""); hideToast(); prefetchNext(); ensureQueue(); })
    .catch(e=>playFallback(song,e));
}else if(autoplay){ loading=false; hideToast(); prefetchNext(); ensureQueue(); }
else { loading=false; hideToast(); }
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
if(repeatOne && auto){ playAt(qi); return; }
// 播到队尾：自动接上推荐歌单，不断流
if(qi>=queue.length-1){
  const recs=recommend(20).filter(s=>queue.indexOf(s)<0);
  if(recs.length){
    queue=queue.concat(recs);
    if(auto) toast("已接上推荐歌单 ♪", "", 2500);
    // 刚接上的第一首立即预取
    const ns=queue[qi+1];
    if(ns && !objCache[ns.p]){ ns._prefetching=true; blobUrl(ns).catch(()=>{}).finally(()=>{ns._prefetching=false;}); getSongMeta(ns).catch(()=>{}); }
  }
}
const n=(qi+1)%queue.length;
playAt(n);
}
/* 队列剩3首时提前接推荐，保证预取时间 */
function ensureQueue(){
  if(!queue.length) return;
  if(queue.length-qi<=3){
    const recs=recommend(20).filter(s=>queue.indexOf(s)<0);
    if(recs.length) queue=queue.concat(recs);
  }
}
function prev(){
if(!queue.length) return;
if(audio.currentTime>3){ audio.currentTime=0; return;}
playAt((qi-1+queue.length)%queue.length);
}
audio.addEventListener("ended",()=>{ const s=queue[qi]; if(s) logPlay(s,true); next(true);});
audio.addEventListener("play",syncPlayBtns);
audio.addEventListener("pause",syncPlayBtns);
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
  const song=queue[qi]; if(!song || song._preSwitched) return;
  if(!audio.duration || audio.duration<10) return;
  const remain=audio.duration-audio.currentTime;
  if(remain>2.5 || remain<0.3) return;
  // 队尾提前接推荐，保证有下一首
  if(qi>=queue.length-1){
    const recs=recommend(20).filter(s=>queue.indexOf(s)<0);
    if(recs.length) queue=queue.concat(recs);
  }
  const ni=(qi+1)%queue.length;
  const ns=queue[ni];
  if(!ns || ns===song) return;
  const blob=objCache[ns.p];
  // blob 没下好也试下直链（SW 可能还活着）
  const useBlob=!!blob;
  song._preSwitched=true;
  logPlay(song,true);
  qi=ni; ns._swapped=useBlob;
  audioPlaying=false;
  audio.src=useBlob?blob:songUrl(ns);
  const pr=audio.play();
  if(pr&&pr.then){
    pr.then(()=>{
      loading=false; setPlayStatus(""); hideToast();
      curLyrics=[]; renderLyrics();
      $("fpCoverImg").style.display="none"; $("fpCoverPh").style.display="block";
      $("miniCover").classList.add("hide");
      $("fpBg").style.backgroundImage="none";
      renderPlayer(); updateMediaSession(ns); logPlay(ns,false);
      getSongMeta(ns).then(m=>{
        if(queue[qi]!==ns) return;
        curLyrics=m.lyrics||[]; renderLyrics();
        if(m.coverUrl){
          $("fpCoverImg").src=m.coverUrl; $("fpCoverImg").style.display="block"; $("fpCoverPh").style.display="none";
          $("miniCover").src=m.coverUrl; $("miniCover").classList.remove("hide");
          $("fpBg").style.backgroundImage=`url("${m.coverUrl}")`;
        }
        updateLikeBtn(ns);
      });
      prefetchNext(); ensureQueue();
    }).catch(()=>{ song._preSwitched=false; });
  } else { song._preSwitched=false; }
}
audio.addEventListener("loadedmetadata",()=>{ $("tDur").textContent=fmtTime(audio.duration);});

/* 锁屏/耳机控制：v8.5 验证过的方式 */
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
doSearch(true);
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
b.innerHTML=`<div class="qq-card-bg" style="background:${gradFor(f.n)}"></div>
  <div class="qq-play">▶</div>
  <div class="qq-card-info"><b></b><span>${f.c} 首</span></div>`;
b.querySelector("b").textContent=f.n;
b.querySelector(".qq-play").onclick=e=>{ e.stopPropagation();
  const ss=CATALOG.filter(s=>s.f===f.n); queue=ss.slice(); playAt(0); };
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
/* 首页快捷入口 */
document.querySelectorAll(".qq-quick button").forEach(b=>{
  b.onclick=()=>{
    const go=b.dataset.go;
    if(go==="rec"){ document.getElementById("blockRec").scrollIntoView({behavior:"smooth"}); }
    else if(go==="recent"){ document.getElementById("blockRecent").scrollIntoView({behavior:"smooth"}); }
    else if(go==="folders"){ document.getElementById("blockFolders").scrollIntoView({behavior:"smooth"}); }
    else if(go==="shuffle"){
      if(!CATALOG.length) return;
      queue=CATALOG.slice();
      // 洗牌
      for(let i=queue.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [queue[i],queue[j]]=[queue[j],queue[i]]; }
      playAt(0); toast("随机播放全部歌曲 ♪","",2000);
    }
  };
});
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
/* 播放页 QQ风按钮 */
$("fpLike").onclick=()=>{
  const song=queue[qi]; if(!song) return;
  if(fav[song.p]){ delete fav[song.p]; toast("已取消喜欢"); }
  else { fav[song.p]=Date.now(); toast("已加入我喜欢 ❤"); }
  saveFav(); updateLikeBtn(song);
};
$("fpDl").onclick=()=>$("fpTab").onclick();
$("fpShare").onclick=()=>{
  const song=queue[qi]; if(!song) return;
  const txt=`${dispTitle(song)} - ${dispArtist(song)}`;
  if(navigator.clipboard) navigator.clipboard.writeText(txt).catch(()=>{});
  toast("已复制："+txt,"",2000);
};
$("fpMode").onclick=()=>{
  repeatOne=!repeatOne;
  $("fpMode").textContent=repeatOne?"🔂":"🔁";
  toast(repeatOne?"单曲循环":"列表循环","",1500);
};
$("fpList").onclick=()=>{
  toast(`播放列表共 ${queue.length} 首，当前第 ${qi+1} 首`,"",2500);
};
// 设置
$("saveCfg").onclick=()=>{ cfg.dav=$("cfgDav").value.trim()||cfg.dav;
cfg.user=$("cfgUser").value.trim()||"ai"; cfg.pass=$("cfgPass").value;
saveCfg(); pushAuthToSW();
$("connStatus").className="hint"; $("connStatus").textContent="已保存";};
$("testConn").onclick=testConn;
$("clearHist").onclick=()=>{ if(confirm("清除本机所有播放记录？")){ hist={}; saveHist(); renderHome();}};
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
  location.reload();
};
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
