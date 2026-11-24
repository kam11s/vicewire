// Loads the real lfg.js panel in jsdom against the local server.
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
const BASE = process.env.BASE || "http://127.0.0.1:8799";
let fails = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="vw-lfg" data-api="${BASE}"></div></body></html>`,
  { url: "https://vicewirehub.com/", runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
w.fetch = (u, o = {}) => fetch(u, { ...o, headers: { ...(o.headers || {}), Origin: "https://vicewirehub.com", "CF-Connecting-IP": "7.7." + Math.floor(Math.random()*250) + "." + Math.floor(Math.random()*250) } });
w.eval(readFileSync(new URL("../site-panel/lfg.js", import.meta.url), "utf8"));
const $ = (s) => w.document.querySelector(s);
await sleep(800);
ok(!/Loading/.test($(".vl-list").textContent), "board loaded");
// post without nickname -> nickname error
$('[data-act="toggle-form"]').click();
$("#vl-need").value = "Need a driver for Tourist Trap";
$(".vl-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
await sleep(200);
ok(/nickname/i.test($('[data-err="nick"]').textContent), "asks for nickname first");
$("#vl-nick").value = "PanelTest"; $("#vl-nick").dispatchEvent(new w.Event("input"));
$(".vl-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
await sleep(1200);
const card = [...w.document.querySelectorAll(".vl-post")].find((a) => /Tourist Trap/.test(a.textContent));
ok(!!card, "new post shows on the board");
ok(card && card.classList.contains("mine") && /Close post/.test(card.textContent), "own post marked with close option");
console.log("voice button text:", card && card.querySelector(".vl-voice").textContent); ok(card && /Join voice 0\/4|turns on once|can.t do voice/.test(card.querySelector(".vl-voice").textContent), "voice button is honest about its state");
// reply
card.querySelector('[data-act="replies"]').click();
await sleep(50);
const c2 = [...w.document.querySelectorAll(".vl-post")].find((a) => /Tourist Trap/.test(a.textContent));
const f = c2.querySelector(".vl-replyform"); f.elements.text.value = "on my way";
f.dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
await sleep(1200);
const c3 = [...w.document.querySelectorAll(".vl-post")].find((a) => /Tourist Trap/.test(a.textContent));
ok(c3 && /on my way/.test(c3.textContent) && /Replies \(1\)/.test(c3.textContent), "reply shows");
// blocked content error surfaces
const f2 = c3.querySelector(".vl-replyform"); f2.elements.text.value = "dm me @someone";
f2.dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
await sleep(800);
ok(/Handles/.test(w.document.querySelector(".vl-post.mine .vl-err").textContent), "blocked reply shows the reason");
// close needs two taps
let close = w.document.querySelector('.vl-post.mine [data-act="close"]');
close.click(); await sleep(100);
ok(/Tap again/.test(close.textContent), "close asks for a second tap");
close.click(); await sleep(1200);
ok(![...w.document.querySelectorAll(".vl-post")].some((a) => /Tourist Trap/.test(a.textContent)), "post closed");
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
w.close(); process.exit(fails ? 1 : 0);
