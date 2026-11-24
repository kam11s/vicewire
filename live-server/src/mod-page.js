// The private moderation page, served at /mod on the live server.
// It asks for the MOD_KEY passphrase and keeps it only for this browser tab.
export const MOD_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Vicewire moderation</title>
<style>
:root{color-scheme:dark;--bg:#080612;--card:#120d24;--line:#3a2c52;--fg:#f6efe6;--muted:#b7a8c4;--pink:#ff2e97;--cyan:#5cefff;--gold:#ffd166}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif;padding:16px;max-width:860px;margin:auto}
h1{font-size:22px;margin:0 0 4px}p{color:var(--muted);margin:0 0 14px}
input,button{font:inherit;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:9px 12px}
button{cursor:pointer}button.warn{border-color:var(--pink);color:var(--pink)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin:10px 0}
.card.hidden{border-color:var(--pink)}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.tag{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:2px 8px;color:var(--muted)}
.tag.bad{color:var(--pink);border-color:var(--pink)}.reply{border-top:1px solid var(--line);margin-top:8px;padding-top:8px}
.muted{color:var(--muted);font-size:13px}#err{color:var(--pink);min-height:1.4em}
</style></head><body>
<h1>Vicewire moderation</h1>
<p>Hide or delete LFG posts and replies. Three reports hide a post or reply until you look at it.</p>
<form id="login" class="row"><input id="key" type="password" placeholder="Moderation passphrase" autocomplete="current-password"><button>Open</button></form>
<div id="err"></div><div id="voice" class="muted"></div><div id="list"></div>
<script>
const $=s=>document.querySelector(s);let key=sessionStorage.getItem("vw-mod")||"";
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ago=t=>{const m=Math.round((Date.now()-t)/60000);return m<1?"just now":m<60?m+"m ago":Math.floor(m/60)+"h "+(m%60)+"m ago"};
async function load(){if(!key)return;$("#err").textContent="";
 const r=await fetch("/api/mod",{headers:{"X-Mod-Key":key}});const d=await r.json().catch(()=>({}));
 if(!r.ok){$("#err").textContent=d.error||"Couldn't load.";if(r.status===403){sessionStorage.removeItem("vw-mod");key=""}return}
 sessionStorage.setItem("vw-mod",key);$("#login").style.display="none";
 $("#voice").textContent="Voice is "+(d.voice.on?"on":"off")+". Joins today: "+d.voice.joinsToday+" of "+d.voice.cap+".";
 $("#list").innerHTML=d.posts.length?d.posts.map(p=>'<div class="card'+(p.hidden?' hidden':'')+'"><div class="row">'+
  '<span class="tag">'+esc(p.platform)+'</span><span class="tag">'+esc(p.chapter)+'</span>'+(p.hidden?'<span class="tag bad">hidden</span>':'')+
  (p.reports?'<span class="tag bad">'+p.reports+' reports</span>':'')+(p.inVoice?'<span class="tag">'+p.inVoice+' in voice</span>':'')+
  '<span class="muted">'+esc(p.nick)+' · '+ago(p.created)+'</span></div><div style="margin:6px 0">'+esc(p.need)+'</div><div class="row">'+
  (p.hidden?'<button data-k="post" data-a="show" data-id="'+p.id+'">Show</button>':'<button data-k="post" data-a="hide" data-id="'+p.id+'">Hide</button>')+
  (p.inVoice?'<button data-k="post" data-a="close-voice" data-id="'+p.id+'">End voice</button>':'')+
  '<button class="warn" data-k="post" data-a="delete" data-id="'+p.id+'">Delete</button></div>'+
  p.replies.map(r=>'<div class="reply"><div class="row"><span class="muted">'+esc(r.nick)+' · '+ago(r.created)+'</span>'+(r.hidden?'<span class="tag bad">hidden</span>':'')+
  (r.reports?'<span class="tag bad">'+r.reports+' reports</span>':'')+'</div><div>'+esc(r.text)+'</div><div class="row" style="margin-top:6px">'+
  (r.hidden?'<button data-k="reply" data-a="show" data-id="'+r.id+'">Show</button>':'<button data-k="reply" data-a="hide" data-id="'+r.id+'">Hide</button>')+
  '<button class="warn" data-k="reply" data-a="delete" data-id="'+r.id+'">Delete</button></div></div>').join("")+'</div>').join(""):'<p>No posts up right now.</p>';
}
$("#login").onsubmit=e=>{e.preventDefault();key=$("#key").value.trim();load()};
$("#list").onclick=async e=>{const b=e.target.closest("button[data-a]");if(!b)return;
 if(b.dataset.a==="delete"&&!confirm("Delete this for good?"))return;
 await fetch("/api/mod",{method:"POST",headers:{"X-Mod-Key":key,"Content-Type":"application/json"},body:JSON.stringify({kind:b.dataset.k,action:b.dataset.a,id:b.dataset.id})});load()};
load();setInterval(load,30000);
</script></body></html>`;
