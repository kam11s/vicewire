// Local smoke test: run `npx wrangler dev --port 8799` first.
import WebSocket from "ws";
const BASE = process.env.BASE || "http://127.0.0.1:8799";
const ORIGIN = "https://vicewirehub.com";
let fails = 0;
const ok = (cond, label) => { console.log((cond ? "PASS " : "FAIL ") + label); if (!cond) fails++; };
const api = async (path, opts = {}, ip = "1.1.1.1") => {
  const r = await fetch(BASE + path, { ...opts, headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": ip, ...(opts.headers || {}) } });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, d, h: r.headers };
};
const post = (path, body, ip) => api(path, { method: "POST", body: JSON.stringify(body) }, ip);
const wsOpen = (path) => new Promise((res, rej) => {
  const ws = new WebSocket(BASE.replace("http", "ws") + path, { headers: { Origin: ORIGIN } });
  const msgs = []; ws.msgs = msgs;
  ws.on("message", (m) => msgs.push(JSON.parse(m.toString())));
  ws.on("open", () => res(ws)); ws.on("error", rej);
});
const waitFor = async (ws, pred, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const m = ws.msgs.find(pred); if (m) return m; await new Promise(r => setTimeout(r, 50)); }
  return null;
};

const s0 = await api("/api/state");
ok(s0.status === 200 && Array.isArray(s0.d.posts), "state loads");
ok(s0.h.get("access-control-allow-origin") === ORIGIN, "CORS for vicewirehub.com");
const evil = await fetch(BASE + "/api/state", { headers: { Origin: "https://evil.example" } });
ok(evil.status === 403, "other sites blocked");

const live = await wsOpen("/api/live");
ok(!!(await waitFor(live, m => m.type === "state")), "live board socket gets state");

ok((await post("/api/posts", { platform: "PS5", chapter: "Chapter 3", need: "need 2 for the heist at www.scam.com", nick: "Vee" })).status === 400, "links blocked");
ok((await post("/api/posts", { platform: "PS5", chapter: "Chapter 3", need: "text me 555 123 4567", nick: "Vee" })).status === 400, "phone numbers blocked");
ok((await post("/api/posts", { platform: "PS5", chapter: "Chapter 3", need: "add me @vee_gta", nick: "Vee" })).status === 400, "handles blocked");
ok((await post("/api/posts", { platform: "PS5", chapter: "Chapter 3", need: "need $1,500,000 for the yacht mission", nick: "Vee" })).status === 201, "money amounts allowed");
const mine2 = await post("/api/posts", { platform: "PS5", chapter: "Chapter 2", need: "second post", nick: "Vee" });
ok(mine2.status === 409, "one open post per visitor");
const created = await post("/api/posts", { platform: "Xbox Series X|S", chapter: "Chapter 1", need: "Need a getaway driver for Tourist Trap", nick: "Lucia Fan" }, "2.2.2.2");
ok(created.status === 201 && created.d.token, "post created with owner token");
const pid = created.d.id;
ok(!!(await waitFor(live, m => m.type === "state" && m.posts.some(p => p.id === pid))), "live board pushes new post");

const rep = await post(`/api/posts/${pid}/replies`, { nick: "Jay", text: "I can drive, hop in voice" }, "3.3.3.3");
ok(rep.status === 201, "reply posted");
let st = await api("/api/state");
ok(st.d.posts.find(p => p.id === pid).replies.length === 1, "reply visible");

// voice signaling
const host = await wsOpen(`/api/voice/${pid}`);
host.send(JSON.stringify({ type: "hello", nick: "Lucia Fan", token: created.d.token }));
const w1 = await waitFor(host, m => m.type === "welcome");
ok(w1 && w1.host === true && w1.iceServers.length, "host joins voice and gets ICE servers");
const guest = await wsOpen(`/api/voice/${pid}`);
guest.send(JSON.stringify({ type: "hello", nick: "Jay" }));
const w2 = await waitFor(guest, m => m.type === "welcome");
ok(w2 && w2.host === false && w2.peers.length === 1 && w2.peers[0].peer === w1.you, "guest sees host in room");
ok(!!(await waitFor(host, m => m.type === "peer-joined" && m.peer === w2.you)), "host told guest joined");
guest.send(JSON.stringify({ type: "signal", to: w1.you, data: { sdp: { type: "offer", sdp: "x" } } }));
ok(!!(await waitFor(host, m => m.type === "signal" && m.from === w2.you && m.data.sdp.type === "offer")), "offer relayed to host");
st = await api("/api/state");
ok(st.d.posts.find(p => p.id === pid).inVoice === 2, "board shows 2 in voice");

// room cap
const extra = [];
for (let i = 0; i < 3; i++) { const w = await wsOpen(`/api/voice/${pid}`); w.send(JSON.stringify({ type: "hello", nick: "P" + i + "x" })); extra.push(w); }
await new Promise(r => setTimeout(r, 400));
ok(extra.some(w => w.msgs.some(m => m.type === "denied" && /full/.test(m.reason))), "room capped at 4");
extra.forEach(w => w.close());

// kick
const guestLeft = waitFor(host, m => m.type === "peer-left" && m.peer === w2.you);
host.send(JSON.stringify({ type: "kick", peer: w2.you }));
ok(!!(await waitFor(guest, m => m.type === "kicked")), "host can kick");
ok(!!(await guestLeft), "host told guest left");
const again = await wsOpen(`/api/voice/${pid}`);
ok(!!(await waitFor(again, m => m.type === "denied" && /removed/.test(m.reason))), "kicked visitor can't rejoin (same IP)");

// non-host can't kick
// reports: 3 distinct visitors hide the post
for (const ip of ["9.9.9.1", "9.9.9.2", "9.9.9.3"]) await post(`/api/posts/${pid}/report`, {}, ip);
st = await api("/api/state");
ok(!st.d.posts.some(p => p.id === pid), "3 reports hide the post");
ok(!!(await waitFor(host, m => m.type === "closed")), "voice room closes when post hidden");

// moderation
const bad = await api("/api/mod", { headers: { "X-Mod-Key": "nope", Origin: BASE } });
ok(bad.status === 403, "mod rejects wrong passphrase");
const md = await api("/api/mod", { headers: { "X-Mod-Key": "local-test-only", Origin: BASE } });
ok(md.status === 200 && md.d.posts.some(p => p.id === pid && p.hidden === 1 && p.reports === 3), "mod sees hidden post with 3 reports");
await api("/api/mod", { method: "POST", headers: { "X-Mod-Key": "local-test-only", Origin: BASE }, body: JSON.stringify({ kind: "post", action: "show", id: pid }) });
st = await api("/api/state");
ok(st.d.posts.some(p => p.id === pid), "mod can un-hide");

// close by owner only
ok((await post(`/api/posts/${pid}/close`, { token: "wrong" })).status === 403, "only owner can close");
ok((await post(`/api/posts/${pid}/close`, { token: created.d.token })).status === 200, "owner closes post");
st = await api("/api/state");
ok(!st.d.posts.some(p => p.id === pid), "closed post gone");

// rate limit on replies
const c2 = await post("/api/posts", { platform: "PS5", chapter: "Chapter 5", need: "Endgame run", nick: "Rate" }, "4.4.4.4");
let last;
for (let i = 0; i < 11; i++) last = await post(`/api/posts/${c2.d.id}/replies`, { nick: "Spam", text: "hi " + i }, "5.5.5.5");
ok(last.status === 429, "reply rate limit kicks in");

host.close(); live.close(); again.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
