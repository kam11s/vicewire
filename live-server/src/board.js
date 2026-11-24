// Tip board: routes under /board/*, stored in the D1 database bound as DB.
// The hashing salt is made once and kept in the config table, and old IP hashes
// are wiped as tips come in, so no secrets or cron are required.
// Optional secrets: SALT, TURNSTILE_SECRET, and ADMIN_TOKEN or MOD_KEY (deletes a tip).
// The tables are created on first use, so no console step is needed either.
const ORIGINS = ["https://vicewirehub.com", "http://vicewirehub.com", "https://www.vicewirehub.com", "http://www.vicewirehub.com"];
const LIMIT_10_MIN = 3, LIMIT_DAY = 20, HIDE_AT_REPORTS = 3, KEEP_IP_DAYS = 30;

function cors(req) {
  const o = req.headers.get("origin") || "";
  return {
    "access-control-allow-origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "vary": "origin",
  };
}
function json(req, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors(req) } });
}
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS tips (id INTEGER PRIMARY KEY AUTOINCREMENT, chapter INTEGER NOT NULL CHECK (chapter BETWEEN 1 AND 5), name TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, ip_hash TEXT, reports INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS tips_by_chapter ON tips (chapter, hidden, id DESC)",
  "CREATE INDEX IF NOT EXISTS tips_by_ip ON tips (ip_hash, created_at)",
  "CREATE TABLE IF NOT EXISTS reports (tip_id INTEGER NOT NULL, ip_hash TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, PRIMARY KEY (tip_id, ip_hash))",
  "CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
];
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
  schemaReady = true;
}
let saltCache = null;
async function salt(env) {
  if (env.SALT) return env.SALT;
  if (saltCache) return saltCache;
  const fresh = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('salt', ?)").bind(fresh).run();
  const row = await env.DB.prepare("SELECT value FROM config WHERE key = 'salt'").first();
  saltCache = row.value;
  return saltCache;
}
async function ipHash(req, env) {
  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "|" + (await salt(env))));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
const ago = ms => new Date(Date.now() - ms).toISOString();

async function turnstileOk(req, env, token) {
  if (!env.TURNSTILE_SECRET) return true;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token || "");
  form.append("remoteip", req.headers.get("cf-connecting-ip") || "");
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const j = await r.json().catch(() => ({}));
  return !!j.success;
}

async function listTips(req, env, url) {
  const ch = Number(url.searchParams.get("chapter"));
  const sql = ch >= 1 && ch <= 5
    ? env.DB.prepare("SELECT id, chapter, name, body, created_at FROM tips WHERE hidden = 0 AND chapter = ? ORDER BY id DESC LIMIT 50").bind(ch)
    : env.DB.prepare("SELECT id, chapter, name, body, created_at FROM tips WHERE hidden = 0 ORDER BY id DESC LIMIT 50");
  const { results } = await sql.all();
  return json(req, { tips: results || [] });
}

async function postTip(req, env) {
  let b; try { b = await req.json(); } catch { return json(req, { error: "Bad request." }, 400); }
  if (b.website) return json(req, { ok: true }); // honeypot: pretend it worked
  const body = clean(b.body, 500), name = clean(b.name, 24), chapter = Number(b.chapter);
  if (body.length < 10) return json(req, { error: "Add a little more detail." }, 400);
  if (!(chapter >= 1 && chapter <= 5)) return json(req, { error: "Pick a chapter." }, 400);
  if (/https?:|www\.|\.(com|net|org|gg|io|ly)\b/i.test(body + " " + name)) return json(req, { error: "Links aren't allowed on the board." }, 400);
  if (!(await turnstileOk(req, env, b.turnstile))) return json(req, { error: "Couldn't confirm you're not a bot. Try again." }, 403);
  const h = await ipHash(req, env);
  const recent = await env.DB.prepare("SELECT SUM(created_at > ?) AS short, COUNT(*) AS day FROM tips WHERE ip_hash = ? AND created_at > ?")
    .bind(ago(10 * 60e3), h, ago(864e5)).first();
  if ((recent?.short || 0) >= LIMIT_10_MIN || (recent?.day || 0) >= LIMIT_DAY) return json(req, { error: "Slow down a little and try again later." }, 429);
  const dup = await env.DB.prepare("SELECT 1 FROM tips WHERE body = ? AND created_at > ? LIMIT 1").bind(body, ago(864e5)).first();
  if (dup) return json(req, { error: "That tip is already on the board." }, 409);
  const now = new Date().toISOString();
  const r = await env.DB.prepare("INSERT INTO tips (chapter, name, body, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)").bind(chapter, name, body, h, now).run();
  await forgetOldHashes(env);
  return json(req, { ok: true, id: r.meta?.last_row_id }, 201);
}

async function reportTip(req, env, id) {
  let b = {}; try { b = await req.json(); } catch {}
  const h = await ipHash(req, env);
  const tip = await env.DB.prepare("SELECT id FROM tips WHERE id = ?").bind(id).first();
  if (!tip) return json(req, { error: "Not found." }, 404);
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO reports (tip_id, ip_hash, reason, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, h, clean(b.reason, 200), new Date().toISOString()).run();
  if (ins.meta?.changes) {
    await env.DB.prepare("UPDATE tips SET reports = reports + 1, hidden = CASE WHEN reports + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?").bind(HIDE_AT_REPORTS, id).run();
  }
  await forgetOldHashes(env);
  return json(req, { ok: true });
}

// Forget IP hashes older than 30 days. Runs after each new tip and report.
async function forgetOldHashes(env) {
  const cut = ago(KEEP_IP_DAYS * 864e5);
  await env.DB.prepare("UPDATE tips SET ip_hash = NULL WHERE created_at < ? AND ip_hash IS NOT NULL").bind(cut).run();
  await env.DB.prepare("UPDATE reports SET ip_hash = 'gone-' || tip_id || '-' || rowid WHERE created_at < ? AND ip_hash NOT LIKE 'gone-%'").bind(cut).run();
}

function isAdmin(req, env) {
  const a = req.headers.get("authorization") || "";
  const key = env.ADMIN_TOKEN || env.MOD_KEY;
  return !!key && a === "Bearer " + key;
}

// Called by the main Worker for any /board/* request.
export async function handleBoard(req, env) {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  const m = url.pathname.match(/^\/board\/tips(?:\/(\d+)(\/report)?)?\/?$/);
  if (!m) return json(req, { error: "Not found." }, 404);
  if (!env.DB) return json(req, { error: "The tip board isn't set up yet." }, 503);
  const id = m[1] ? Number(m[1]) : null;
  try {
    await ensureSchema(env);
    if (!id && req.method === "GET") return await listTips(req, env, url);
    if (!id && req.method === "POST") return await postTip(req, env);
    if (id && m[2] && req.method === "POST") return await reportTip(req, env, id);
    if (id && !m[2] && req.method === "DELETE") {
      if (!isAdmin(req, env)) return json(req, { error: "Not allowed." }, 403);
      await env.DB.prepare("DELETE FROM reports WHERE tip_id = ?").bind(id).run();
      await env.DB.prepare("DELETE FROM tips WHERE id = ?").bind(id).run();
      return json(req, { ok: true });
    }
    return json(req, { error: "Not found." }, 404);
  } catch (e) {
    return json(req, { error: "Something went wrong." }, 500);
  }
}

// Optional daily cron does the same wipe as each new tip.
export async function boardCleanup(env) {
  if (!env.DB) return;
  await ensureSchema(env);
  await forgetOldHashes(env);
}
