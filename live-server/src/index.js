// Vicewire live server
// One Worker + one SQLite Durable Object ("Hub") that holds the LFG board,
// pushes live updates over hibernating WebSockets, and relays voice-room
// signaling. Voice audio itself goes peer to peer through Cloudflare's TURN
// relay, so players never see each other's IP addresses.
//
// Privacy: no accounts, no emails, no ages, no raw IP addresses are stored.
// Rate limits use a salted hash of the visitor's IP; the salt changes every
// UTC day, so hashes can't be linked across days.

import { DurableObject } from "cloudflare:workers";
import { MOD_PAGE } from "./mod-page.js";

export const PLATFORMS = ["PS5", "Xbox Series X|S"];
export const CHAPTERS = ["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4", "Chapter 5", "After the story"];

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const POST_TTL = 2 * HOUR;
const MAX_OPEN_POSTS = 150;
const MAX_REPLIES = 30;
const REPORTS_TO_HIDE = 3;
const ICE_TTL_SECONDS = 2 * 60 * 60;

// [max actions, window in ms] per visitor
const LIMITS = {
  post: [1, 5 * MIN],
  reply: [10, 10 * MIN],
  report: [10, 24 * HOUR],
  join: [20, HOUR],
  live: [30, MIN],
  modfail: [5, HOUR],
};

// Short list of slurs blocked outright. Add words here (lowercase).
const BLOCKED_WORDS = [
  "nigger", "nigga", "faggot", "fag", "retard", "kike", "spic", "chink", "tranny", "wetback",
];
const BLOCKED_RE = new RegExp("\\b(" + BLOCKED_WORDS.join("|") + ")s?\\b", "i");

// ---------------------------------------------------------------- helpers

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

function originsOf(env) {
  return (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(text) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

function randomId(bytes = 9) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] || 0) ^ (eb[i] || 0);
  return diff === 0;
}

// Normalise free text: strip control and direction-override characters, squash spaces.
export function clean(value, max) {
  if (typeof value !== "string") return null;
  const s = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || s.length > max) return null;
  return s;
}

// Returns a reason string if the text breaks the house rules, else null.
export function problemWith(text) {
  const t = text.toLowerCase();
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|gg|io|co|me|tv|xyz|ly|app|link|ru|be|us|uk|ca)\b)/.test(t))
    return "Links aren't allowed on the board.";
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(t)) return "Email addresses aren't allowed.";
  const noMoney = t.replace(/\$\s?[\d,.]+[km]?/g, " ");
  if (/\d{7,}/.test(noMoney.replace(/[\s().+-]/g, ""))) return "Phone numbers aren't allowed.";
  if (/(^|[\s(])@[a-z0-9_.]{2,}/.test(t)) return "Handles aren't allowed. Meet up in voice instead.";
  if (/\b(discord|snapchat|insta|instagram|tiktok|telegram|whatsapp|kik|cash ?app|venmo|paypal|zelle)\b/.test(t))
    return "Keep other apps and payments off the board.";
  if (BLOCKED_RE.test(t)) return "Keep it clean.";
  return null;
}

export function cleanNick(value) {
  const n = clean(value, 20);
  if (!n || n.length < 2 || !/^[A-Za-z0-9 _.-]+$/.test(n)) return null;
  return n;
}

// ---------------------------------------------------------------- Worker

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = origin && originsOf(env).includes(origin) ? origin : null;

    if (url.pathname === "/mod") {
      return new Response(MOD_PAGE, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex",
          "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
        },
      });
    }
    if (!url.pathname.startsWith("/api/")) {
      return new Response("Vicewire live server", { headers: { "Content-Type": "text/plain" } });
    }

    // Browsers on other sites may not use the board. The /mod page is same-origin.
    const sameOrigin = origin === url.origin;
    if (origin && !allowed && !sameOrigin) return json({ error: "This site can't use the board." }, 403);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: allowed ? corsHeaders(allowed) : {} });
    }

    // Pass the visitor IP to the Hub in a header the visitor can't set.
    const headers = new Headers(request.headers);
    headers.delete("X-VW-IP");
    headers.set("X-VW-IP", request.headers.get("CF-Connecting-IP") || "local");
    const inner = new Request(request, { headers });

    const hub = env.HUB.get(env.HUB.idFromName("main"));
    const res = await hub.fetch(inner);
    if (res.status === 101 || !allowed) return res;
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(corsHeaders(allowed))) out.headers.set(k, v);
    return out;
  },
};

// ---------------------------------------------------------------- Hub

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY, platform TEXT, chapter TEXT, need TEXT, nick TEXT,
        owner_hash TEXT, author TEXT, created INTEGER, expires INTEGER, hidden INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS replies (
        id TEXT PRIMARY KEY, post_id TEXT, nick TEXT, text TEXT, author TEXT,
        created INTEGER, hidden INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS reports (
        target TEXT, reporter TEXT, created INTEGER, PRIMARY KEY (target, reporter));
      CREATE TABLE IF NOT EXISTS kicks (post_id TEXT, who TEXT, PRIMARY KEY (post_id, who));
      CREATE TABLE IF NOT EXISTS rates (k TEXT PRIMARY KEY, n INTEGER, reset INTEGER);
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    `);
    // Keep idle live sockets asleep: answer pings without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---- small storage helpers
  meta(k) {
    const row = this.sql.exec("SELECT v FROM meta WHERE k = ?", k).toArray()[0];
    return row ? row.v : null;
  }
  setMeta(k, v) {
    this.sql.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, String(v));
  }
  today() {
    return new Date().toISOString().slice(0, 10);
  }
  async visitor(request) {
    const day = this.today();
    let salt = this.meta("salt");
    if (this.meta("salt_day") !== day || !salt) {
      salt = randomId(24);
      this.setMeta("salt", salt);
      this.setMeta("salt_day", day);
    }
    return (await sha256(salt + "|" + (request.headers.get("X-VW-IP") || "local"))).slice(0, 32);
  }
  // Returns seconds to wait, or 0 if allowed (and counts the action).
  limited(kind, who) {
    const [max, win] = LIMITS[kind];
    const k = kind + ":" + who;
    const now = Date.now();
    const row = this.sql.exec("SELECT n, reset FROM rates WHERE k = ?", k).toArray()[0];
    if (!row || now >= row.reset) {
      this.sql.exec("INSERT OR REPLACE INTO rates (k, n, reset) VALUES (?, 1, ?)", k, now + win);
      return 0;
    }
    if (row.n >= max) return Math.ceil((row.reset - now) / 1000);
    this.sql.exec("UPDATE rates SET n = n + 1 WHERE k = ?", k);
    return 0;
  }
  waitMessage(sec) {
    const m = Math.ceil(sec / 60);
    return sec < 60 ? `Slow down. Try again in ${sec} seconds.` : `Slow down. Try again in ${m} minute${m === 1 ? "" : "s"}.`;
  }

  // ---- state
  openPost(id) {
    return this.sql
      .exec("SELECT * FROM posts WHERE id = ? AND hidden = 0 AND expires > ?", id, Date.now())
      .toArray()[0];
  }
  voiceMembers(postId) {
    return this.ctx
      .getWebSockets("v:" + postId)
      .filter((ws) => ws.readyState === 1)
      .map((ws) => ws.deserializeAttachment())
      .filter((a) => a && a.joined);
  }
  voiceOn() {
    if (this.env.DEV_STUN_ONLY === "1") return true;
    if (!this.env.TURN_KEY_ID || !this.env.TURN_KEY_API_TOKEN) return false;
    const cap = parseInt(this.env.VOICE_DAILY_JOINS || "500", 10);
    return this.joinsToday() < cap;
  }
  joinsToday() {
    return this.meta("joins_day") === this.today() ? parseInt(this.meta("joins") || "0", 10) : 0;
  }
  publicState() {
    const now = Date.now();
    const posts = this.sql
      .exec(
        "SELECT id, platform, chapter, need, nick, created, expires FROM posts WHERE hidden = 0 AND expires > ? ORDER BY created DESC LIMIT ?",
        now,
        MAX_OPEN_POSTS,
      )
      .toArray();
    const byId = new Map(posts.map((p) => [p.id, { ...p, replies: [], inVoice: 0 }]));
    if (byId.size) {
      const replies = this.sql
        .exec(
          "SELECT r.id, r.post_id, r.nick, r.text, r.created FROM replies r JOIN posts p ON p.id = r.post_id WHERE r.hidden = 0 AND p.hidden = 0 AND p.expires > ? ORDER BY r.created ASC",
          now,
        )
        .toArray();
      for (const r of replies) byId.get(r.post_id)?.replies.push({ id: r.id, nick: r.nick, text: r.text, created: r.created });
      for (const p of byId.values()) p.inVoice = this.voiceMembers(p.id).length;
    }
    return {
      posts: [...byId.values()],
      voice: { on: this.voiceOn(), maxRoom: parseInt(this.env.MAX_ROOM || "4", 10) },
      platforms: PLATFORMS,
      chapters: CHAPTERS,
      now,
    };
  }
  broadcast() {
    const msg = JSON.stringify({ type: "state", ...this.publicState() });
    for (const ws of this.ctx.getWebSockets("board")) {
      try {
        ws.send(msg);
      } catch {}
    }
  }
  async scheduleSweep() {
    const next = this.sql.exec("SELECT MIN(expires) AS e FROM posts").toArray()[0]?.e;
    const current = await this.ctx.storage.getAlarm();
    if (next && (!current || next < current)) await this.ctx.storage.setAlarm(next + 1000);
  }

  // Runs when the next post expires: delete it, close its voice room.
  async alarm() {
    const now = Date.now();
    const gone = this.sql.exec("SELECT id FROM posts WHERE expires <= ?", now).toArray();
    for (const { id } of gone) this.removePost(id, "This post expired.");
    this.sql.exec("DELETE FROM rates WHERE reset <= ?", now);
    this.sql.exec("DELETE FROM reports WHERE created <= ?", now - 2 * 24 * HOUR);
    if (gone.length) this.broadcast();
    const next = this.sql.exec("SELECT MIN(expires) AS e FROM posts").toArray()[0]?.e;
    if (next) await this.ctx.storage.setAlarm(Math.max(next + 1000, now + 5000));
  }
  removePost(id, why) {
    this.sql.exec("DELETE FROM replies WHERE post_id = ?", id);
    this.sql.exec("DELETE FROM reports WHERE target = ? OR target LIKE ?", "p:" + id, "r:" + id + ":%");
    this.sql.exec("DELETE FROM kicks WHERE post_id = ?", id);
    this.sql.exec("DELETE FROM posts WHERE id = ?", id);
    this.closeRoom(id, why);
  }
  closeRoom(id, why) {
    for (const ws of this.ctx.getWebSockets("v:" + id)) {
      try {
        ws.send(JSON.stringify({ type: "closed", reason: why }));
        ws.close(4000, "room closed");
      } catch {}
    }
  }

  // ---- HTTP routes
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    try {
      if (method === "GET" && path === "/api/state") return json(this.publicState());
      if (method === "GET" && path === "/api/live") return this.openLive(request);
      let m;
      if (method === "GET" && (m = path.match(/^\/api\/voice\/([\w-]{6,20})$/))) return this.openVoice(request, m[1]);
      if (method === "POST" && path === "/api/posts") return this.createPost(request);
      if (method === "POST" && (m = path.match(/^\/api\/posts\/([\w-]{6,20})\/replies$/))) return this.createReply(request, m[1]);
      if (method === "POST" && (m = path.match(/^\/api\/posts\/([\w-]{6,20})\/report$/))) return this.report(request, m[1]);
      if (method === "POST" && (m = path.match(/^\/api\/posts\/([\w-]{6,20})\/close$/))) return this.closePost(request, m[1]);
      if (path === "/api/mod") return this.mod(request);
      return json({ error: "Not found" }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: "Something went wrong. Try again." }, 500);
    }
  }

  async body(request) {
    try {
      const text = await request.text();
      if (text.length > 4000) return null;
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async createPost(request) {
    const b = await this.body(request);
    if (!b) return json({ error: "Bad request." }, 400);
    const platform = PLATFORMS.includes(b.platform) ? b.platform : null;
    const chapter = CHAPTERS.includes(b.chapter) ? b.chapter : null;
    const need = clean(b.need, 140);
    const nick = cleanNick(b.nick);
    if (!platform || !chapter) return json({ error: "Pick a platform and a chapter." }, 400);
    if (!need) return json({ error: "Say what you need, in 140 characters or less." }, 400);
    if (!nick) return json({ error: "Nickname: 2 to 20 letters, numbers, spaces, _ . -" }, 400);
    const bad = problemWith(need) || problemWith(nick);
    if (bad) return json({ error: bad }, 400);

    const who = await this.visitor(request);
    const now = Date.now();
    const mine = this.sql
      .exec("SELECT id FROM posts WHERE author = ? AND expires > ? AND hidden = 0", who, now)
      .toArray()[0];
    if (mine) return json({ error: "You already have a post up. Close it first." }, 409);
    const open = this.sql.exec("SELECT COUNT(*) AS n FROM posts WHERE expires > ?", now).toArray()[0].n;
    if (open >= MAX_OPEN_POSTS) return json({ error: "The board is full right now. Try again soon." }, 503);
    const wait = this.limited("post", who);
    if (wait) return json({ error: this.waitMessage(wait) }, 429);

    const id = randomId(9);
    const token = randomId(24);
    this.sql.exec(
      "INSERT INTO posts (id, platform, chapter, need, nick, owner_hash, author, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, platform, chapter, need, nick, await sha256(token), who, now, now + POST_TTL,
    );
    await this.scheduleSweep();
    this.broadcast();
    return json({ id, token, expires: now + POST_TTL }, 201);
  }

  async createReply(request, postId) {
    const b = await this.body(request);
    if (!b) return json({ error: "Bad request." }, 400);
    const post = this.openPost(postId);
    if (!post) return json({ error: "That post is gone." }, 404);
    const text = clean(b.text, 200);
    const nick = cleanNick(b.nick);
    if (!text) return json({ error: "Write a reply, 200 characters or less." }, 400);
    if (!nick) return json({ error: "Nickname: 2 to 20 letters, numbers, spaces, _ . -" }, 400);
    const bad = problemWith(text) || problemWith(nick);
    if (bad) return json({ error: bad }, 400);
    const n = this.sql.exec("SELECT COUNT(*) AS n FROM replies WHERE post_id = ?", postId).toArray()[0].n;
    if (n >= MAX_REPLIES) return json({ error: "This post has all the replies it can take." }, 409);
    const who = await this.visitor(request);
    const wait = this.limited("reply", who);
    if (wait) return json({ error: this.waitMessage(wait) }, 429);
    const id = randomId(9);
    this.sql.exec(
      "INSERT INTO replies (id, post_id, nick, text, author, created) VALUES (?, ?, ?, ?, ?, ?)",
      id, postId, nick, text, who, Date.now(),
    );
    this.broadcast();
    return json({ id }, 201);
  }

  async report(request, postId) {
    const b = (await this.body(request)) || {};
    const post = this.openPost(postId);
    if (!post) return json({ ok: true });
    const who = await this.visitor(request);
    const replyId = typeof b.replyId === "string" && /^[\w-]{6,20}$/.test(b.replyId) ? b.replyId : null;
    if (replyId) {
      const r = this.sql.exec("SELECT id FROM replies WHERE id = ? AND post_id = ?", replyId, postId).toArray()[0];
      if (!r) return json({ ok: true });
    }
    const target = replyId ? `r:${postId}:${replyId}` : `p:${postId}`;
    const wait = this.limited("report", who);
    if (wait) return json({ error: this.waitMessage(wait) }, 429);
    this.sql.exec("INSERT OR IGNORE INTO reports (target, reporter, created) VALUES (?, ?, ?)", target, who, Date.now());
    const count = this.sql.exec("SELECT COUNT(*) AS n FROM reports WHERE target = ?", target).toArray()[0].n;
    if (count >= REPORTS_TO_HIDE) {
      if (replyId) this.sql.exec("UPDATE replies SET hidden = 1 WHERE id = ?", replyId);
      else {
        this.sql.exec("UPDATE posts SET hidden = 1 WHERE id = ?", postId);
        this.closeRoom(postId, "This post was hidden after reports.");
      }
      this.broadcast();
    }
    return json({ ok: true });
  }

  async closePost(request, postId) {
    const b = await this.body(request);
    const post = this.sql.exec("SELECT owner_hash FROM posts WHERE id = ?", postId).toArray()[0];
    if (!post) return json({ ok: true });
    if (!b || typeof b.token !== "string" || !safeEqual(await sha256(b.token), post.owner_hash))
      return json({ error: "Only the person who posted can close it." }, 403);
    this.removePost(postId, "The host closed this post.");
    this.broadcast();
    return json({ ok: true });
  }

  // ---- moderation (/mod page, passphrase in MOD_KEY secret)
  async mod(request) {
    if (!this.env.MOD_KEY) return json({ error: "Not found" }, 404);
    const who = await this.visitor(request);
    const b = request.method === "POST" ? await this.body(request) : null;
    const key = request.headers.get("X-Mod-Key") || "";
    if (!safeEqual(key, this.env.MOD_KEY)) {
      const wait = this.limited("modfail", who);
      return json({ error: wait ? this.waitMessage(wait) : "Wrong passphrase." }, wait ? 429 : 403);
    }
    if (request.method === "GET") {
      const now = Date.now();
      const posts = this.sql
        .exec("SELECT id, platform, chapter, need, nick, created, expires, hidden FROM posts WHERE expires > ? ORDER BY hidden DESC, created DESC", now)
        .toArray();
      const replies = this.sql.exec("SELECT id, post_id, nick, text, created, hidden FROM replies ORDER BY created ASC").toArray();
      const reports = this.sql.exec("SELECT target, COUNT(*) AS n FROM reports GROUP BY target").toArray();
      const rc = Object.fromEntries(reports.map((r) => [r.target, r.n]));
      return json({
        posts: posts.map((p) => ({
          ...p,
          reports: rc["p:" + p.id] || 0,
          inVoice: this.voiceMembers(p.id).length,
          replies: replies.filter((r) => r.post_id === p.id).map((r) => ({ ...r, reports: rc[`r:${p.id}:${r.id}`] || 0 })),
        })),
        voice: { on: this.voiceOn(), joinsToday: this.joinsToday(), cap: parseInt(this.env.VOICE_DAILY_JOINS || "500", 10) },
      });
    }
    if (request.method === "POST" && b) {
      const id = typeof b.id === "string" ? b.id : "";
      const action = b.action;
      if (b.kind === "post") {
        if (action === "delete") this.removePost(id, "A moderator removed this post.");
        else if (action === "hide") {
          this.sql.exec("UPDATE posts SET hidden = 1 WHERE id = ?", id);
          this.closeRoom(id, "A moderator hid this post.");
        } else if (action === "show") {
          this.sql.exec("UPDATE posts SET hidden = 0 WHERE id = ?", id);
          this.sql.exec("DELETE FROM reports WHERE target = ?", "p:" + id);
        } else if (action === "close-voice") this.closeRoom(id, "A moderator closed voice for this post.");
      } else if (b.kind === "reply") {
        if (action === "delete") this.sql.exec("DELETE FROM replies WHERE id = ?", id);
        else if (action === "hide") this.sql.exec("UPDATE replies SET hidden = 1 WHERE id = ?", id);
        else if (action === "show") {
          this.sql.exec("UPDATE replies SET hidden = 0 WHERE id = ?", id);
          this.sql.exec("DELETE FROM reports WHERE target LIKE ?", "r:%:" + id);
        }
      }
      this.broadcast();
      return json({ ok: true });
    }
    return json({ error: "Bad request." }, 400);
  }

  // ---- live board socket
  async openLive(request) {
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "Expected a WebSocket." }, 426);
    const who = await this.visitor(request);
    if (this.limited("live", who)) return json({ error: "Too many connections." }, 429);
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ["board"]);
    pair[1].serializeAttachment({ kind: "board" });
    pair[1].send(JSON.stringify({ type: "state", ...this.publicState() }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ---- voice room socket
  async openVoice(request, postId) {
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "Expected a WebSocket." }, 426);
    const pair = new WebSocketPair();
    const server = pair[1];
    const deny = (reason) => {
      server.accept();
      server.send(JSON.stringify({ type: "denied", reason }));
      server.close(4001, "denied");
      return new Response(null, { status: 101, webSocket: pair[0] });
    };
    const post = this.openPost(postId);
    if (!post) return deny("That post is gone.");
    if (!this.voiceOn()) return deny("Voice is off right now. Try again later.");
    const who = await this.visitor(request);
    if (this.sql.exec("SELECT 1 FROM kicks WHERE post_id = ? AND who = ?", postId, who).toArray().length)
      return deny("The host removed you from this room.");
    const max = parseInt(this.env.MAX_ROOM || "4", 10);
    // Count people in the room plus anyone who connected in the last 15 seconds and is still saying hello.
    const now = Date.now();
    const taken = this.ctx.getWebSockets("v:" + postId).filter((w) => {
      if (w.readyState !== 1) return false;
      const a = w.deserializeAttachment();
      return a && (a.joined || now - (a.opened || 0) < 15000);
    }).length;
    if (taken >= max)
      return deny("This room is full.");
    const wait = this.limited("join", who);
    if (wait) return deny(this.waitMessage(wait));
    const peer = randomId(6);
    this.ctx.acceptWebSocket(server, ["voice", "v:" + postId, "p:" + postId + ":" + peer]);
    server.serializeAttachment({ kind: "voice", post: postId, peer, who, nick: null, host: false, joined: false, opened: Date.now() });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async iceServers() {
    if (this.env.DEV_STUN_ONLY === "1") return { iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }], relayOnly: false };
    if (!this.voiceOn()) return null;
    const r = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${this.env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: ICE_TTL_SECONDS }),
      },
    );
    if (!r.ok) {
      console.error("TURN credentials failed", r.status);
      return null;
    }
    const data = await r.json();
    const day = this.today();
    this.setMeta("joins", this.joinsToday() + 1);
    this.setMeta("joins_day", day);
    // Port 53 is blocked by browsers; drop it so connections don't wait on a timeout.
    const iceServers = (data.iceServers || []).map((s) => ({
      ...s,
      urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)),
    }));
    return { iceServers, relayOnly: true };
  }

  roomSend(postId, peer, msg) {
    for (const ws of this.ctx.getWebSockets("p:" + postId + ":" + peer)) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {}
    }
  }
  roomBroadcast(postId, msg, exceptPeer) {
    for (const ws of this.ctx.getWebSockets("v:" + postId)) {
      const a = ws.deserializeAttachment();
      if (!a || !a.joined || a.peer === exceptPeer || ws.readyState !== 1) continue;
      try {
        ws.send(JSON.stringify(msg));
      } catch {}
    }
  }

  async webSocketMessage(ws, raw) {
    const a = ws.deserializeAttachment();
    if (!a || a.kind !== "voice") return;
    if (typeof raw !== "string" || raw.length > 20000) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!this.openPost(a.post)) {
      ws.send(JSON.stringify({ type: "closed", reason: "That post is gone." }));
      ws.close(4000, "room closed");
      return;
    }

    if (msg.type === "hello" && !a.joined) {
      const nick = cleanNick(msg.nick);
      if (!nick || problemWith(nick)) {
        ws.send(JSON.stringify({ type: "denied", reason: "Pick a different nickname." }));
        ws.close(4001, "denied");
        return;
      }
      if (this.voiceMembers(a.post).length >= parseInt(this.env.MAX_ROOM || "4", 10)) {
        ws.send(JSON.stringify({ type: "denied", reason: "This room is full." }));
        ws.close(4001, "denied");
        return;
      }
      const post = this.sql.exec("SELECT owner_hash FROM posts WHERE id = ?", a.post).toArray()[0];
      const host = typeof msg.token === "string" && safeEqual(await sha256(msg.token), post.owner_hash);
      const ice = await this.iceServers();
      if (!ice) {
        ws.send(JSON.stringify({ type: "denied", reason: "Voice is off right now. Try again later." }));
        ws.close(4001, "denied");
        return;
      }
      const peers = this.voiceMembers(a.post).map((m) => ({ peer: m.peer, nick: m.nick, host: m.host }));
      Object.assign(a, { nick, host, joined: true });
      ws.serializeAttachment(a);
      ws.send(JSON.stringify({ type: "welcome", you: a.peer, host, peers, ...ice }));
      this.roomBroadcast(a.post, { type: "peer-joined", peer: a.peer, nick, host }, a.peer);
      this.broadcast();
      return;
    }
    if (!a.joined) return;

    if (msg.type === "signal" && typeof msg.to === "string" && msg.data && typeof msg.data === "object") {
      this.roomSend(a.post, msg.to, { type: "signal", from: a.peer, data: msg.data });
      return;
    }
    if (msg.type === "kick" && a.host && typeof msg.peer === "string" && msg.peer !== a.peer) {
      for (const target of this.ctx.getWebSockets("p:" + a.post + ":" + msg.peer)) {
        const t = target.deserializeAttachment();
        if (t?.who) this.sql.exec("INSERT OR IGNORE INTO kicks (post_id, who) VALUES (?, ?)", a.post, t.who);
        try {
          target.send(JSON.stringify({ type: "kicked", reason: "The host removed you from this room." }));
          target.close(4002, "kicked");
        } catch {}
      }
      return;
    }
  }

  async webSocketClose(ws, code) {
    this.leave(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye");
    } catch {}
  }
  async webSocketError(ws) {
    this.leave(ws);
  }
  leave(ws) {
    const a = ws.deserializeAttachment();
    if (!a || a.kind !== "voice" || !a.joined) return;
    a.joined = false;
    try {
      ws.serializeAttachment(a);
    } catch {}
    this.roomBroadcast(a.post, { type: "peer-left", peer: a.peer }, a.peer);
    this.broadcast();
  }
}
