/* CityComs (crew finder + voice) panel for Last Free Roam.
   Drop into any page:
     <div id="vw-lfg" data-api="https://YOUR-WORKER.workers.dev"></div>
     <script src="lfg.js" defer></script>
   Uses the page's --bg --card --line --fg --muted --pink --cyan --gold colors when present. */
(function () {
  "use strict";
  var root = document.getElementById("vw-lfg");
  if (!root) return;
  var API = (root.getAttribute("data-api") || "").replace(/\/+$/, "");
  var PREVIEW = root.getAttribute("data-preview") === "1"; // sample data only, no real audio

  // ------------------------------------------------------------ styles
  var css = [
    "#vw-lfg{--vl-bg:var(--bg,#080612);--vl-card:var(--card,#120d24);--vl-line:var(--line,#3a2c52);--vl-fg:var(--fg,#f6efe6);--vl-muted:var(--muted,#b7a8c4);--vl-pink:var(--pink,#ff2e97);--vl-cyan:var(--cyan,#5cefff);--vl-gold:var(--gold,#ffd166);color:var(--vl-fg);font-size:15px;line-height:1.45}",
    "#vw-lfg *{box-sizing:border-box}",
    "#vw-lfg .vl-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:12px}",
    "#vw-lfg h2{font-family:'Bebas Neue',Outfit,sans-serif;font-weight:400;letter-spacing:.04em;font-size:30px;line-height:1;margin:0;color:var(--vl-fg)}",
    "#vw-lfg .vl-sub{color:var(--vl-muted);margin:4px 0 0;font-size:14px}",
    "#vw-lfg button,#vw-lfg select,#vw-lfg input{font:inherit;color:var(--vl-fg);background:var(--vl-card);border:1px solid var(--vl-line);border-radius:10px;padding:9px 12px;min-height:40px}",
    "#vw-lfg button{cursor:pointer}#vw-lfg button:disabled{opacity:.55;cursor:not-allowed}",
    "#vw-lfg button.vl-primary{background:var(--vl-pink);border-color:var(--vl-pink);color:#12051a;font-weight:600}",
    "#vw-lfg button.vl-ghost{background:transparent}",
    "#vw-lfg button.vl-voice{border-color:var(--vl-cyan);color:var(--vl-cyan);background:transparent}",
    "#vw-lfg input,#vw-lfg select{width:100%}",
    "#vw-lfg .vl-form{display:none;background:var(--vl-card);border:1px solid var(--vl-line);border-radius:14px;padding:14px;margin-bottom:14px}",
    "#vw-lfg .vl-form.open{display:block}",
    "#vw-lfg .vl-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
    "#vw-lfg .vl-grid .vl-wide{grid-column:1/-1}",
    "#vw-lfg label{display:block;font-size:12px;color:var(--vl-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em}",
    "#vw-lfg .vl-err{color:var(--vl-pink);font-size:14px;min-height:1.2em;margin:8px 0 0}",
    "#vw-lfg .vl-nickrow{max-width:320px;margin-bottom:12px}#vw-lfg .vl-nickrow .vl-err{margin:4px 0 0}",
    "#vw-lfg .vl-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}",
    "#vw-lfg .vl-chip{border-radius:999px;min-height:34px;padding:6px 12px;font-size:14px;background:transparent}",
    "#vw-lfg .vl-chip.on{border-color:var(--vl-pink);color:var(--vl-pink)}",
    "#vw-lfg .vl-filters select{width:auto;min-height:34px;padding:6px 10px;border-radius:999px;font-size:14px}",
    "#vw-lfg .vl-list{display:grid;gap:10px}",
    "#vw-lfg .vl-post{background:var(--vl-card);border:1px solid var(--vl-line);border-radius:14px;padding:12px 14px}",
    "#vw-lfg .vl-post.mine{border-color:var(--vl-gold)}",
    "#vw-lfg .vl-tags{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px}",
    "#vw-lfg .vl-tag{font-size:12px;border-radius:999px;padding:2px 9px;border:1px solid var(--vl-line);color:var(--vl-muted)}",
    "#vw-lfg .vl-tag.plat{border-color:var(--vl-pink);color:var(--vl-pink)}",
    "#vw-lfg .vl-tag.chap{border-color:var(--vl-cyan);color:var(--vl-cyan)}",
    "#vw-lfg .vl-tag.live{border-color:var(--vl-gold);color:var(--vl-gold)}",
    "#vw-lfg .vl-time{margin-left:auto;font-size:12px;color:var(--vl-muted)}",
    "#vw-lfg .vl-need{font-size:16px;margin:2px 0 4px;overflow-wrap:anywhere}",
    "#vw-lfg .vl-by{font-size:13px;color:var(--vl-muted)}",
    "#vw-lfg .vl-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}",
    "#vw-lfg .vl-actions button{min-height:36px;padding:6px 12px;font-size:14px}",
    "#vw-lfg .vl-link{background:none!important;border:0!important;color:var(--vl-muted)!important;padding:6px 4px!important;text-decoration:underline;text-underline-offset:3px}",
    "#vw-lfg .vl-replies{border-top:1px solid var(--vl-line);margin-top:10px;padding-top:8px;display:none}",
    "#vw-lfg .vl-replies.open{display:block}",
    "#vw-lfg .vl-reply{padding:6px 0;font-size:14px;overflow-wrap:anywhere;display:flex;gap:8px;align-items:baseline}",
    "#vw-lfg .vl-reply b{color:var(--vl-cyan);font-weight:600}",
    "#vw-lfg .vl-reply .vl-link{margin-left:auto;font-size:12px}",
    "#vw-lfg .vl-replyform{display:flex;gap:8px;margin-top:6px}",
    "#vw-lfg .vl-replyform button{flex:none}",
    "#vw-lfg .vl-empty{color:var(--vl-muted);text-align:center;padding:24px 12px;border:1px dashed var(--vl-line);border-radius:14px}",
    "#vw-lfg .vl-status{font-size:13px;color:var(--vl-muted);margin:10px 0 0}",
    "#vw-lfg details.vl-rules{margin-top:16px;font-size:14px;color:var(--vl-muted)}",
    "#vw-lfg details.vl-rules summary{cursor:pointer;color:var(--vl-fg)}",
    "#vw-lfg details.vl-rules ul{padding-left:18px;margin:8px 0}",
    "#vw-lfg .vl-vbar{position:fixed;left:12px;right:12px;bottom:12px;z-index:50;max-width:720px;margin:auto;background:var(--vl-card);border:1px solid var(--vl-cyan);border-radius:16px;padding:12px 14px;box-shadow:0 10px 40px rgba(0,0,0,.5)}",
    "#vw-lfg .vl-vtop{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
    "#vw-lfg .vl-vtitle{font-weight:600}",
    "#vw-lfg .vl-vstate{font-size:13px;color:var(--vl-muted)}",
    "#vw-lfg .vl-vbtns{margin-left:auto;display:flex;gap:8px}",
    "#vw-lfg .vl-vbtns button{min-height:36px;padding:6px 12px;font-size:14px}",
    "#vw-lfg .vl-members{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}",
    "#vw-lfg .vl-member{display:flex;align-items:center;gap:6px;border:1px solid var(--vl-line);border-radius:999px;padding:4px 6px 4px 10px;font-size:14px}",
    "#vw-lfg .vl-dot{width:9px;height:9px;border-radius:50%;background:var(--vl-line);flex:none}",
    "#vw-lfg .vl-member.ok .vl-dot{background:var(--vl-cyan)}",
    "#vw-lfg .vl-member.talk .vl-dot{background:var(--vl-gold);box-shadow:0 0 0 3px rgba(255,209,102,.25)}",
    "#vw-lfg .vl-member.bad .vl-dot{background:var(--vl-pink)}",
    "#vw-lfg .vl-member small{color:var(--vl-muted)}",
    "#vw-lfg .vl-member button{min-height:26px;padding:0 8px;border-radius:999px;font-size:12px}",
    "@media (max-width:560px){#vw-lfg .vl-grid{grid-template-columns:1fr}#vw-lfg .vl-vbtns{margin-left:0}}"
  ].join("\n");
  var styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ------------------------------------------------------------ helpers
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function store(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null");
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function left(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + "m left";
    return Math.floor(m / 60) + "h " + (m % 60) + "m left";
  }
  function ago(t) {
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    return Math.floor(m / 60) + "h ago";
  }
  function api(path, body) {
    return fetch(API + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || "Something went wrong. Try again.");
        return d;
      });
    });
  }

  if (!API) {
    root.innerHTML = '<div class="vl-empty">CityComs is coming soon.</div>';
    return;
  }

  // ------------------------------------------------------------ state
  var S = {
    posts: [], platforms: [], chapters: [], voice: { on: false, maxRoom: 4 },
    clockSkew: 0, loaded: false, offline: false,
    filterPlat: "all", filterChap: "all",
    open: {}, // post id -> replies open
    mine: store("vw-lfg-mine") || {} // post id -> owner token
  };
  var nick = store("vw-lfg-nick") || "";

  root.innerHTML =
    '<div class="vl-head"><div><h2>CityComs</h2>' +
    '<p class="vl-sub">Find a crew and talk in voice. Post what you need, and others reply or jump in. Posts vanish after 2 hours.</p></div>' +
    '<button class="vl-primary" data-act="toggle-form">Post</button></div>' +
    '<form class="vl-form" novalidate><div class="vl-grid">' +
    '<div><label for="vl-plat">Platform</label><select id="vl-plat" name="platform"></select></div>' +
    '<div><label for="vl-chap">Where you are</label><select id="vl-chap" name="chapter"></select></div>' +
    '<div class="vl-wide"><label for="vl-need">What do you need?</label><input id="vl-need" name="need" maxlength="140" placeholder="Need a driver for Tourist Trap" autocomplete="off"></div>' +
    '</div><p class="vl-err" data-err="post"></p>' +
    '<div class="vl-actions"><button class="vl-primary" type="submit">Post</button><button class="vl-ghost" type="button" data-act="toggle-form">Cancel</button></div></form>' +
    '<div class="vl-nickrow"><label for="vl-nick">Your nickname</label><input id="vl-nick" maxlength="20" placeholder="Not your real name" autocomplete="off"><p class="vl-err" data-err="nick"></p></div>' +
    '<div class="vl-filters"></div><div class="vl-list"></div><p class="vl-status"></p>' +
    '<details class="vl-rules"><summary>House rules and privacy</summary><ul>' +
    '<li>For players 13 and up. GTA 6 is rated M, so expect mature talk.</li>' +
    '<li>Use a nickname, not your real name. No links, emails, phone numbers, handles or other apps.</li>' +
    '<li>No hate, harassment, cheating, selling or scams. Three reports hide a post until a moderator checks it.</li>' +
    '<li>Voice is live audio between up to 4 players. It goes through a relay, so players never see each other\'s address. Nothing is recorded. The post\'s host can remove anyone.</li>' +
    '<li>We don\'t use accounts, emails or ages. Posts and replies delete themselves after 2 hours. To stop spam we keep a scrambled code made from your connection for a day, never your actual address.</li>' +
    '<li>Unofficial fan site. Not affiliated with Rockstar Games or Take-Two.</li>' +
    '</ul></details><div class="vl-vbar" hidden></div>';

  var form = root.querySelector(".vl-form");
  var listEl = root.querySelector(".vl-list");
  var filtersEl = root.querySelector(".vl-filters");
  var statusEl = root.querySelector(".vl-status");
  var vbar = root.querySelector(".vl-vbar");
  var nickEl = root.querySelector("#vl-nick");
  nickEl.value = nick;
  nickEl.addEventListener("input", function () { nick = nickEl.value.trim(); store("vw-lfg-nick", nick); showErr("nick", ""); });
  function needNick() {
    if (nick.length >= 2) return true;
    showErr("nick", "Pick a nickname first (2 to 20 letters or numbers).");
    nickEl.focus();
    if (nickEl.scrollIntoView) nickEl.scrollIntoView({ block: "center", behavior: "smooth" });
    return false;
  }
  // Two taps instead of a pop-up: first tap arms the button, second tap does it.
  function armed(b, label) {
    if (b.getAttribute("data-armed") === "1") return true;
    var old = b.textContent;
    b.setAttribute("data-armed", "1"); b.textContent = label;
    setTimeout(function () { if (b.isConnected) { b.removeAttribute("data-armed"); b.textContent = old; } }, 4000);
    return false;
  }

  function fillSelects() {
    if (form.elements.platform.options.length) return;
    form.elements.platform.innerHTML = S.platforms.map(function (p) { return "<option>" + esc(p) + "</option>"; }).join("");
    form.elements.chapter.innerHTML = S.chapters.map(function (c) { return "<option>" + esc(c) + "</option>"; }).join("");
  }

  function voiceBlocker() {
    if (!window.isSecureContext) return "Voice turns on once the site is on https";
    if (!navigator.mediaDevices || !window.RTCPeerConnection) return "This browser can't do voice";
    if (!S.voice.on) return "Voice is off right now";
    return null;
  }

  function render() {
    fillSelects();
    var plats = ["all"].concat(S.platforms);
    filtersEl.innerHTML = plats.map(function (p) {
      return '<button class="vl-chip' + (S.filterPlat === p ? " on" : "") + '" data-act="plat" data-v="' + esc(p) + '">' + (p === "all" ? "All" : esc(p)) + "</button>";
    }).join("") +
      '<select data-act="chap" aria-label="Filter by chapter"><option value="all">Any chapter</option>' +
      S.chapters.map(function (c) { return "<option" + (S.filterChap === c ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select>";

    var now = Date.now() + S.clockSkew;
    var posts = S.posts.filter(function (p) {
      return (S.filterPlat === "all" || p.platform === S.filterPlat) && (S.filterChap === "all" || p.chapter === S.filterChap);
    });
    var block = voiceBlocker();
    if (!S.loaded) listEl.innerHTML = '<div class="vl-empty">Loading the board...</div>';
    else if (!posts.length) listEl.innerHTML = '<div class="vl-empty">' + (S.posts.length ? "Nobody matches that filter yet." : "No one is looking for a group right now. Be the first.") + "</div>";
    else listEl.innerHTML = posts.map(function (p) {
      var mine = !!S.mine[p.id];
      var inRoom = Voice.post && Voice.post.id === p.id;
      var full = p.inVoice >= S.voice.maxRoom;
      var voiceBtn;
      if (inRoom) voiceBtn = '<button class="vl-voice" disabled>You\'re in voice</button>';
      else if (block) voiceBtn = '<button class="vl-voice" disabled title="' + esc(block) + '">' + esc(block) + "</button>";
      else if (full) voiceBtn = '<button class="vl-voice" disabled>Voice full</button>';
      else voiceBtn = '<button class="vl-voice" data-act="join" data-id="' + p.id + '">Join voice ' + p.inVoice + "/" + S.voice.maxRoom + "</button>";
      var replies = p.replies.map(function (r) {
        return '<div class="vl-reply"><span><b>' + esc(r.nick) + "</b> " + esc(r.text) + '</span><button class="vl-link" data-act="report" data-id="' + p.id + '" data-reply="' + r.id + '">Report</button></div>';
      }).join("");
      return '<article class="vl-post' + (mine ? " mine" : "") + '">' +
        '<div class="vl-tags"><span class="vl-tag plat">' + esc(p.platform) + '</span><span class="vl-tag chap">' + esc(p.chapter) + "</span>" +
        (p.inVoice ? '<span class="vl-tag live">' + p.inVoice + " in voice</span>" : "") +
        '<span class="vl-time">' + left(p.expires - now) + "</span></div>" +
        '<div class="vl-need">' + esc(p.need) + '</div><div class="vl-by">' + esc(p.nick) + (mine ? " (you)" : "") + " &middot; " + ago(p.created - S.clockSkew) + "</div>" +
        '<div class="vl-actions">' + voiceBtn +
        '<button class="vl-ghost" data-act="replies" data-id="' + p.id + '">' + (p.replies.length ? "Replies (" + p.replies.length + ")" : "Reply") + "</button>" +
        (mine ? '<button class="vl-link" data-act="close" data-id="' + p.id + '">Close post</button>' : '<button class="vl-link" data-act="report" data-id="' + p.id + '">Report</button>') +
        "</div>" + '<p class="vl-err" data-err="' + p.id + '"></p>' +
        '<div class="vl-replies' + (S.open[p.id] ? " open" : "") + '">' + replies +
        '<form class="vl-replyform" data-id="' + p.id + '"><input name="text" maxlength="200" placeholder="Reply" autocomplete="off"><button class="vl-primary" type="submit">Send</button></form>' +
        "</div></article>";
    }).join("");
    statusEl.textContent = S.offline ? "Reconnecting to the board..." : "";
  }

  // keep typed replies when the board re-renders
  function renderKeepingInput() {
    var a = document.activeElement;
    var keep = null;
    if (a && root.contains(a) && a.closest(".vl-replyform")) keep = { id: a.closest(".vl-replyform").getAttribute("data-id"), v: a.value, s: a.selectionStart };
    var drafts = {};
    root.querySelectorAll(".vl-replyform").forEach(function (f) { if (f.elements.text.value) drafts[f.getAttribute("data-id")] = f.elements.text.value; });
    render();
    root.querySelectorAll(".vl-replyform").forEach(function (f) { var d = drafts[f.getAttribute("data-id")]; if (d) f.elements.text.value = d; });
    if (keep) {
      var f = root.querySelector('.vl-replyform[data-id="' + keep.id + '"]');
      if (f) { f.elements.text.focus(); try { f.elements.text.setSelectionRange(keep.s, keep.s); } catch (e) {} }
    }
  }

  function setState(d) {
    S.posts = d.posts || [];
    S.platforms = d.platforms || S.platforms;
    S.chapters = d.chapters || S.chapters;
    S.voice = d.voice || S.voice;
    if (d.now) S.clockSkew = d.now - Date.now();
    S.loaded = true;
    // forget closed posts of mine
    var ids = {};
    S.posts.forEach(function (p) { ids[p.id] = 1; });
    Object.keys(S.mine).forEach(function (id) { if (!ids[id] && S.mine[id].t < Date.now() - 3 * 3600000) delete S.mine[id]; });
    renderKeepingInput();
  }

  // ------------------------------------------------------------ live connection
  var live = null, backoff = 1000, pollTimer = null;
  function poll() {
    api("/api/state").then(function (d) { S.offline = false; setState(d); }).catch(function () { S.offline = true; render(); });
  }
  function connect() {
    var url = API.replace(/^http/, "ws") + "/api/live";
    try { live = new WebSocket(url); } catch (e) { live = null; }
    if (!live) { if (!pollTimer) pollTimer = setInterval(poll, 30000); return; }
    var pinger = null;
    live.onopen = function () {
      backoff = 1000; S.offline = false;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      pinger = setInterval(function () { try { live.send("ping"); } catch (e) {} }, 45000);
    };
    live.onmessage = function (e) {
      if (e.data === "pong") return;
      try { var m = JSON.parse(e.data); if (m.type === "state") setState(m); } catch (err) {}
    };
    live.onclose = function () {
      clearInterval(pinger);
      S.offline = true; render();
      if (!pollTimer) pollTimer = setInterval(poll, 30000);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60000);
    };
  }
  poll();
  connect();
  setInterval(function () { if (!document.hidden) render(); }, 60000); // refresh countdowns
  document.addEventListener("visibilitychange", function () { if (!document.hidden && S.offline) poll(); });

  // ------------------------------------------------------------ actions
  function showErr(key, msg) {
    var el = root.querySelector('[data-err="' + key + '"]');
    if (el) el.textContent = msg || "";
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = form.querySelector('button[type="submit"]');
    if (!needNick()) return;
    btn.disabled = true; showErr("post", "");
    api("/api/posts", { platform: form.elements.platform.value, chapter: form.elements.chapter.value, need: form.elements.need.value, nick: nick })
      .then(function (d) {
        S.mine[d.id] = { token: d.token, t: Date.now() };
        store("vw-lfg-mine", S.mine);
        form.elements.need.value = "";
        form.classList.remove("open");
        poll();
      })
      .catch(function (err) { showErr("post", err.message); })
      .then(function () { btn.disabled = false; });
  });

  root.addEventListener("submit", function (e) {
    var f = e.target.closest(".vl-replyform");
    if (!f) return;
    e.preventDefault();
    var id = f.getAttribute("data-id");
    if (!needNick()) return;
    var b = f.querySelector("button"); b.disabled = true; showErr(id, "");
    api("/api/posts/" + id + "/replies", { nick: nick, text: f.elements.text.value })
      .then(function () { f.elements.text.value = ""; poll(); })
      .catch(function (err) { showErr(id, err.message); })
      .then(function () { b.disabled = false; });
  });

  root.addEventListener("change", function (e) {
    if (e.target.getAttribute("data-act") === "chap") { S.filterChap = e.target.value; render(); }
  });

  root.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b || b.tagName === "SELECT") return;
    var act = b.getAttribute("data-act"), id = b.getAttribute("data-id");
    if (act === "toggle-form") {
      form.classList.toggle("open");
      if (form.classList.contains("open")) form.elements.need.focus();
    } else if (act === "plat") {
      S.filterPlat = b.getAttribute("data-v"); render();
    } else if (act === "replies") {
      S.open[id] = !S.open[id]; renderKeepingInput();
    } else if (act === "report") {
      var replyId = b.getAttribute("data-reply");
      if (!armed(b, "Tap again to report")) return;
      api("/api/posts/" + id + "/report", replyId ? { replyId: replyId } : {})
        .then(function () { b.removeAttribute("data-armed"); b.textContent = "Reported"; b.disabled = true; })
        .catch(function (err) { showErr(id, err.message); b.textContent = "Report"; });
    } else if (act === "close") {
      if (!armed(b, "Tap again to close")) return;
      api("/api/posts/" + id + "/close", { token: S.mine[id] && S.mine[id].token })
        .then(function () { delete S.mine[id]; store("vw-lfg-mine", S.mine); if (Voice.post && Voice.post.id === id) Voice.leave(); poll(); })
        .catch(function (err) { showErr(id, err.message); });
    } else if (act === "join") {
      var p = S.posts.filter(function (x) { return x.id === id; })[0];
      if (p && needNick()) Voice.join(p);
    } else if (act === "mute") Voice.toggleMute();
    else if (act === "leave") Voice.leave();
    else if (act === "kick") {
      if (armed(b, "Tap to confirm")) Voice.kick(b.getAttribute("data-peer"));
    } else if (act === "unblock-audio") Voice.unblockAudio();
  });

  // ------------------------------------------------------------ voice
  // Mesh of up to 4 browsers. The server only passes connection messages;
  // audio goes through Cloudflare's relay (relay-only) so addresses stay hidden.
  var Voice = {
    post: null, ws: null, me: null, host: false, stream: null, muted: false,
    ice: null, relayOnly: true, peers: {}, state: "", note: "", audioCtx: null, meterTimer: null, blocked: false,

    join: function (post) {
      if (Voice.post) Voice.leave();
      if (PREVIEW) {
        Voice.post = post; Voice.host = !!S.mine[post.id]; Voice.self = { level: 0 };
        Voice.peers = { demo1: { id: "demo1", nick: post.nick, host: true, state: "ok" }, demo2: { id: "demo2", nick: "Jay", state: "ok", talking: true } };
        if (Voice.host) delete Voice.peers.demo1;
        Voice.state = "Preview only. On the live site this is real audio.";
        Voice.draw(); render();
        return;
      }
      Voice.post = post; Voice.state = "Asking for your mic..."; Voice.note = ""; Voice.peers = {};
      Voice.draw(); render();
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
        .then(function (stream) {
          if (!Voice.post || Voice.post.id !== post.id) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
          Voice.stream = stream; Voice.muted = false;
          Voice.state = "Connecting...";
          Voice.draw();
          Voice.open(post);
        })
        .catch(function () {
          Voice.end("Voice needs your microphone. Allow it in your browser and try again.");
        });
    },

    open: function (post) {
      var ws = new WebSocket(API.replace(/^http/, "ws") + "/api/voice/" + post.id);
      Voice.ws = ws;
      ws.onopen = function () {
        ws.send(JSON.stringify({ type: "hello", nick: nick, token: S.mine[post.id] && S.mine[post.id].token }));
      };
      ws.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.type === "welcome") {
          Voice.me = m.you; Voice.host = m.host; Voice.ice = m.iceServers; Voice.relayOnly = m.relayOnly !== false;
          Voice.state = m.peers.length ? "Connecting to " + m.peers.length + (m.peers.length === 1 ? " player..." : " players...") : "You're in. Waiting for others to join.";
          m.peers.forEach(function (p) { Voice.addPeer(p, true); });
          Voice.startMeters();
          Voice.draw();
        } else if (m.type === "peer-joined") {
          Voice.addPeer(m, false); Voice.draw();
        } else if (m.type === "peer-left") {
          Voice.dropPeer(m.peer); Voice.draw();
        } else if (m.type === "signal") {
          Voice.onSignal(m.from, m.data);
        } else if (m.type === "denied" || m.type === "kicked" || m.type === "closed") {
          Voice.end(m.reason || "Voice ended.");
        }
      };
      ws.onclose = function () {
        if (Voice.ws === ws && Voice.post) Voice.end(Voice.note || "Voice disconnected.");
      };
    },

    send: function (to, data) {
      if (Voice.ws && Voice.ws.readyState === 1) Voice.ws.send(JSON.stringify({ type: "signal", to: to, data: data }));
    },

    addPeer: function (info, initiator) {
      if (Voice.peers[info.peer]) return;
      var pc = new RTCPeerConnection({ iceServers: Voice.ice || [], iceTransportPolicy: Voice.relayOnly ? "relay" : "all" });
      var peer = { id: info.peer, nick: info.nick, host: info.host, pc: pc, state: "connecting", level: 0, queue: [], audio: null, analyser: null };
      Voice.peers[info.peer] = peer;
      Voice.stream.getTracks().forEach(function (t) { pc.addTrack(t, Voice.stream); });
      pc.onicecandidate = function (e) { if (e.candidate) Voice.send(info.peer, { candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
      pc.ontrack = function (e) {
        var stream = e.streams[0] || new MediaStream([e.track]);
        var a = document.createElement("audio");
        a.autoplay = true; a.setAttribute("playsinline", ""); a.srcObject = stream;
        a.style.display = "none"; root.appendChild(a); peer.audio = a;
        var pl = a.play();
        if (pl && pl.catch) pl.catch(function () { Voice.blocked = true; Voice.draw(); });
        Voice.watchLevel(peer, stream);
      };
      pc.onconnectionstatechange = function () {
        var s = pc.connectionState;
        peer.state = s === "connected" ? "ok" : s === "failed" ? "bad" : s === "disconnected" ? "connecting" : peer.state;
        if (s === "connected") Voice.capBitrate(pc);
        if (s === "failed" && pc.restartIce && initiator) { pc.restartIce(); Voice.negotiate(peer); }
        Voice.summarize(); Voice.draw();
      };
      if (initiator) Voice.negotiate(peer);
    },

    negotiate: function (peer) {
      peer.pc.createOffer().then(function (o) { return peer.pc.setLocalDescription(o); })
        .then(function () { Voice.send(peer.id, { sdp: peer.pc.localDescription }); })
        .catch(function () { peer.state = "bad"; Voice.draw(); });
    },

    onSignal: function (from, data) {
      var peer = Voice.peers[from];
      if (!peer) return;
      var pc = peer.pc;
      if (data.sdp) {
        pc.setRemoteDescription(data.sdp).then(function () {
          peer.queue.splice(0).forEach(function (c) { pc.addIceCandidate(c).catch(function () {}); });
          if (data.sdp.type === "offer") {
            return pc.createAnswer().then(function (a) { return pc.setLocalDescription(a); })
              .then(function () { Voice.send(from, { sdp: pc.localDescription }); });
          }
        }).catch(function () { peer.state = "bad"; Voice.draw(); });
      } else if (data.candidate) {
        if (pc.remoteDescription) pc.addIceCandidate(data.candidate).catch(function () {});
        else peer.queue.push(data.candidate);
      }
    },

    capBitrate: function (pc) {
      pc.getSenders().forEach(function (s) {
        if (!s.track || s.track.kind !== "audio" || !s.getParameters) return;
        var p = s.getParameters();
        if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = 32000;
        s.setParameters(p).catch(function () {});
      });
    },

    dropPeer: function (id) {
      var p = Voice.peers[id];
      if (!p) return;
      try { p.pc.close(); } catch (e) {}
      if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
      delete Voice.peers[id];
      Voice.summarize();
    },

    summarize: function () {
      var list = Object.keys(Voice.peers).map(function (k) { return Voice.peers[k]; });
      if (!list.length) { Voice.state = "You're in. Waiting for others to join."; return; }
      var ok = list.filter(function (p) { return p.state === "ok"; }).length;
      var bad = list.filter(function (p) { return p.state === "bad"; }).length;
      if (ok === list.length) Voice.state = "Connected to " + ok + (ok === 1 ? " player" : " players");
      else if (bad && !ok) Voice.state = "Couldn't connect. Their network may be blocking voice.";
      else Voice.state = "Connected to " + ok + " of " + list.length;
    },

    // speaking lights
    startMeters: function () {
      try { Voice.audioCtx = Voice.audioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      Voice.self = { level: 0 };
      Voice.watchLevel(Voice.self, Voice.stream);
      clearInterval(Voice.meterTimer);
      Voice.meterTimer = setInterval(function () {
        var changed = false;
        [Voice.self].concat(Object.keys(Voice.peers).map(function (k) { return Voice.peers[k]; })).forEach(function (p) {
          if (!p || !p.analyser) return;
          var buf = new Uint8Array(p.analyser.fftSize);
          p.analyser.getByteTimeDomainData(buf);
          var peak = 0;
          for (var i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
          var talking = peak > 12 && !(p === Voice.self && Voice.muted);
          if (talking !== p.talking) { p.talking = talking; changed = true; }
        });
        if (changed) Voice.draw();
      }, 200);
    },
    watchLevel: function (p, stream) {
      if (!Voice.audioCtx) return;
      try {
        var src = Voice.audioCtx.createMediaStreamSource(stream);
        var an = Voice.audioCtx.createAnalyser(); an.fftSize = 512;
        src.connect(an); p.analyser = an;
      } catch (e) {}
    },

    unblockAudio: function () {
      Object.keys(Voice.peers).forEach(function (k) { var a = Voice.peers[k].audio; if (a) a.play().catch(function () {}); });
      if (Voice.audioCtx && Voice.audioCtx.resume) Voice.audioCtx.resume();
      Voice.blocked = false; Voice.draw();
    },

    toggleMute: function () {
      Voice.muted = !Voice.muted;
      if (Voice.stream) Voice.stream.getAudioTracks().forEach(function (t) { t.enabled = !Voice.muted; });
      Voice.draw();
    },

    kick: function (peer) {
      if (Voice.ws && Voice.host) Voice.ws.send(JSON.stringify({ type: "kick", peer: peer }));
    },

    leave: function () { Voice.end(""); },

    end: function (note) {
      var ws = Voice.ws; Voice.ws = null;
      if (ws) { try { ws.close(); } catch (e) {} }
      Object.keys(Voice.peers).forEach(Voice.dropPeer);
      if (Voice.stream) Voice.stream.getTracks().forEach(function (t) { t.stop(); });
      clearInterval(Voice.meterTimer);
      if (Voice.audioCtx) { try { Voice.audioCtx.close(); } catch (e) {} Voice.audioCtx = null; }
      Voice.stream = null; Voice.post = null; Voice.me = null; Voice.host = false; Voice.blocked = false;
      Voice.note = note;
      Voice.draw(); render();
      if (note) setTimeout(function () { if (!Voice.post && Voice.note === note) { Voice.note = ""; Voice.draw(); } }, 8000);
    },

    draw: function () {
      if (!Voice.post) {
        if (Voice.note) {
          vbar.hidden = false;
          vbar.innerHTML = '<div class="vl-vtop"><span class="vl-vstate">' + esc(Voice.note) + '</span><div class="vl-vbtns"><button class="vl-ghost" data-act="leave">OK</button></div></div>';
        } else { vbar.hidden = true; vbar.innerHTML = ""; }
        return;
      }
      var p = Voice.post;
      var me = '<span class="vl-member ok' + (Voice.self && Voice.self.talking ? " talk" : "") + '"><span class="vl-dot"></span>' + esc(nick) + " <small>(you" + (Voice.muted ? ", muted" : "") + ")</small></span>";
      var others = Object.keys(Voice.peers).map(function (k) {
        var x = Voice.peers[k];
        return '<span class="vl-member ' + x.state + (x.talking ? " talk" : "") + '"><span class="vl-dot"></span>' + esc(x.nick || "Player") +
          (x.host ? " <small>(host)</small>" : "") + (x.state === "bad" ? " <small>can't connect</small>" : x.state === "connecting" ? " <small>connecting</small>" : "") +
          (Voice.host ? '<button class="vl-ghost" data-act="kick" data-peer="' + esc(x.id) + '" aria-label="Remove ' + esc(x.nick) + '">Remove</button>' : "") + "</span>";
      }).join("");
      vbar.hidden = false;
      vbar.innerHTML = '<div class="vl-vtop"><span class="vl-vtitle">Voice: ' + esc(p.chapter) + ", " + esc(p.platform) + '</span><span class="vl-vstate">' + esc(Voice.state) + "</span>" +
        '<div class="vl-vbtns">' + (Voice.blocked ? '<button class="vl-voice" data-act="unblock-audio">Tap to hear</button>' : "") +
        '<button class="vl-ghost" data-act="mute">' + (Voice.muted ? "Unmute" : "Mute") + '</button><button class="vl-primary" data-act="leave">Leave</button></div></div>' +
        '<div class="vl-members">' + me + others + "</div>";
    }
  };

  window.addEventListener("pagehide", function () { if (Voice.post) Voice.leave(); });
  render();
})();
