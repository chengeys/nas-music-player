/* 知行音乐 v1 — NAS 私有曲库播放器 */
"use strict";
const $ = id => document.getElementById(id);
const APP_VER = "v1.0 2026-10-07";

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
function songKey(s){ return s.p;}
function dispTitle(s){ return s.t || s.p.split("/").pop().replace(/\.[^.]+$/,"");}
function dispArtist(s){ return s.a || "未知歌手";}

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
let queue=[], qi=-1, objCache={}, loading=false;

async function blobUrl(song){
if(objCache[song.p]) return objCache[song.p];
const url=songUrl(song);
const r=await fetch(url,{headers:{Authorization:authHeader()}});
if(r.status===401) throw {code:401,msg:"账号或密码不对（401），去设置页检查"};
if(!r.ok) throw {code:r.status,msg:"NAS 返回 "+r.status};
const blob=await r.blob();
const ou=URL.createObjectURL(blob);
objCache[song.p]=ou;
if(Object.keys(objCache).length>8){ // 只缓存最近8首
const old=Object.keys(objCache)[0];
URL.revokeObjectURL(objCache[old]); delete objCache[old];
}
return ou;
}

async function playAt(i, autoplay=true){
if(i<0||i>=queue.length) return;
qi=i; const song=queue[qi];
loading=true; setPlayStatus("正在加载…");
try{
audio.src=await blobUrl(song);
if(autoplay) await audio.play();
logPlay(song,false);
renderPlayer(); updateMediaSession(song);
setPlayStatus("");
}catch(e){
loading=false;
if(e && e.code===401){ setPlayStatus(e.msg); alert(e.msg);}
else if(e instanceof TypeError){
setPlayStatus("连不上 NAS：可能是反代没开，或没配 CORS。去设置页点“测试连接”。");
} else setPlayStatus("播放失败："+(e.msg||e));
return;
}
loading=false;
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
$("tCur").textContent=fmtTime(audio.currentTime);}
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
renderSongs($("recList"), recommend(20), false);
// 合集
const folders={};
for(const s of CATALOG){ folders[s.f]=folders[s.f]||{n:s.f,c:0}; folders[s.f].c++;}
const fl=$("folderList"); fl.innerHTML="";
Object.values(folders).sort((a,b)=>b.c-a.c).forEach(f=>{
const b=document.createElement("button"); b.className="folder";
b.innerHTML=`<b>${f.c}</b><span></span>`;
b.querySelector("span").textContent=f.n;
b.onclick=()=>{ const ss=CATALOG.filter(s=>s.f===f.n); queue=ss.slice(); playAt(0);
$("q").value=""; showView("view-search"); renderSongs($("searchList"),ss,true);};
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
$("fpFolder").textContent=s.f||"";
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
$("refreshRec").onclick=()=>renderSongs($("recList"),recommend(20),false);
$("carBtn").onclick=()=>{ document.body.classList.toggle("car");
$("carBtn").style.background=document.body.classList.contains("car")?"var(--acc)":"";};
// 播放器
$("miniToggle").onclick=e=>{e.stopPropagation();togglePlay();};
$("miniNext").onclick=e=>{e.stopPropagation();next();};
$("miniPlayer").onclick=()=>{ $("fullPlayer").style.display="flex";};
$("closePlayer").onclick=()=>{ $("fullPlayer").style.display="none";};
$("fpToggle").onclick=togglePlay; $("fpNext").onclick=()=>next(); $("fpPrev").onclick=prev;
$("seek").addEventListener("input",()=>{ if(audio.duration) audio.currentTime=$("seek").value/1000*audio.duration;});
// 设置
$("saveCfg").onclick=()=>{ cfg.dav=$("cfgDav").value.trim()||cfg.dav;
cfg.user=$("cfgUser").value.trim()||"ai"; cfg.pass=$("cfgPass").value;
saveCfg(); $("connStatus").className="hint"; $("connStatus").textContent="已保存";};
$("testConn").onclick=testConn;
$("clearHist").onclick=()=>{ if(confirm("清除本机所有播放记录？")){ hist={}; saveHist(); renderHome();}};
$("cfgDav").value=cfg.dav; $("cfgUser").value=cfg.user; $("cfgPass").value=cfg.pass||"";
$("appVer").textContent=APP_VER;
}

/* ---------- 启动 ---------- */
document.addEventListener("DOMContentLoaded",()=>{
if(typeof CATALOG==="undefined"||!CATALOG.length){ alert("曲库加载失败"); return;}
bind(); renderHome();
if("serviceWorker" in navigator){ navigator.serviceWorker.register("sw.js").catch(()=>{});}
});
