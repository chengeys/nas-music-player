/* 知行音乐 v1 — 云端账号模块：登录/注册/收藏/歌单/播放记录同步到 Cloudflare D1 */
"use strict";
const Cloud = (()=>{
const BASE = "https://music-api.ipls.cn";
const TKEY = "zmusic.cloud.token", UKEY = "zmusic.cloud.user";

function getToken(){ try{ return localStorage.getItem(TKEY) || ""; }catch(e){ return ""; } }
function getUser(){ try{ return localStorage.getItem(UKEY) || ""; }catch(e){ return ""; } }
function setSession(token, username){
  try{
    if(token){ localStorage.setItem(TKEY, token); localStorage.setItem(UKEY, username || ""); }
    else { localStorage.removeItem(TKEY); localStorage.removeItem(UKEY); }
  }catch(e){}
}
async function req(path, method, data){
  const headers = { "Content-Type": "application/json" };
  const t = getToken();
  if(t) headers["Authorization"] = "Bearer " + t;
  const r = await fetch(BASE + path, {
    method: method || "GET",
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });
  const j = await r.json().catch(()=>({ ok:false, error:"网络异常" }));
  if(r.status === 401 && t){ setSession("", ""); } // token 失效就地登出
  return j;
}
return {
  loggedIn: ()=>!!getToken(),
  username: getUser,
  register: (u, p)=>req("/api/register", "POST", { username:u, password:p }),
  login: async (u, p)=>{
    const j = await req("/api/login", "POST", { username:u, password:p });
    if(j.ok) setSession(j.token, j.username);
    return j;
  },
  logout: async ()=>{ try{ await req("/api/logout", "POST"); }catch(e){} setSession("", ""); },
  me: ()=>req("/api/me"),
  getFavorites: ()=>req("/api/favorites"),
  addFavorite: (songId)=>req("/api/favorites", "POST", { song_id: songId }),
  delFavorite: (songId)=>req("/api/favorites/" + encodeURIComponent(songId), "DELETE"),
  getPlaylists: ()=>req("/api/playlists"),
  createPlaylist: (name)=>req("/api/playlists", "POST", { name }),
  delPlaylist: (id)=>req("/api/playlists/" + id, "DELETE"),
  getPlaylistItems: (id)=>req("/api/playlists/" + id + "/items"),
  addPlaylistItem: (id, songId)=>req("/api/playlists/" + id + "/items", "POST", { song_id: songId }),
  delPlaylistItem: (id, songId)=>req("/api/playlists/" + id + "/items/" + encodeURIComponent(songId), "DELETE"),
  postHistory: (songId)=>{ // 上报播放记录，失败静默（本地已有记录）
    req("/api/history", "POST", { song_id: songId }).catch(()=>{});
  },
  getHistory: (limit)=>req("/api/history?limit=" + (limit || 50)),
};
})();
