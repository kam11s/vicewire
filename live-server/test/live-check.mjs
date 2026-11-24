// Read-only check of the live server. Posts nothing.
// Usage: node live-server/test/live-check.mjs https://vicewire.<subdomain>.workers.dev
const base = (process.argv[2] || "").replace(/\/+$/, "");
if (!/^(https:\/\/[a-z0-9.-]+|http:\/\/(127\.0\.0\.1|localhost):\d+)$/i.test(base)) {
  console.error("Give the server address, like https://vicewire.example.workers.dev");
  process.exit(2);
}
const origin = "https://vicewirehub.com";
let bad = 0;
async function check(name, path, test) {
  try {
    const r = await fetch(base + path, { headers: { Origin: origin } });
    const text = await r.text();
    const ok = test(r, text);
    console.log((ok ? "ok   " : "FAIL ") + name + " (" + r.status + ")");
    if (!ok) bad++;
  } catch (e) {
    console.log("FAIL " + name + " (" + e.message + ")");
    bad++;
  }
}
const allowsSite = (r) => (r.headers.get("access-control-allow-origin") || "") === origin;
await check("tip board answers", "/board/tips", (r, t) => r.ok && allowsSite(r) && Array.isArray(JSON.parse(t).tips));
await check("CityComs answers", "/api/state", (r) => r.ok && allowsSite(r));
await check("mod page loads", "/mod", (r, t) => r.ok && t.includes("Last Free Roam moderation"));
console.log(bad ? bad + " check(s) failed" : "ALL LIVE CHECKS PASSED");
process.exit(bad ? 1 : 0);
