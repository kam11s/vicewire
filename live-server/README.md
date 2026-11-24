# Vicewire live server

Tip board, looking-for-group board and voice rooms for the Vicewire site.
One Cloudflare Worker serves all three:

- `/board/tips` tip board, stored in the D1 database `lfr-board` (tables are made on first use)
- `/api/...` LFG board and voice rooms
- `/mod` moderation page for tips, crew posts and replies (needs the `MOD_KEY` secret)

## Cloudflare setup

Cloudflare builds from the `wrangler.jsonc` at the top of the `live-server` branch.
Workers & Pages > Create application > GitHub (or "Import a repository") > pick `vicewire`,
branch `live-server`, keep the name `vicewire` and the other settings > Save and Deploy.
Then on the Workers & Pages page, "Change" next to "Your subdomain" to a neutral name
before the address goes on the public page.
Nothing else is needed for the tip board and LFG board. Voice and `/mod` need the secrets below.

## About the LFG board
 Runs on the
Cloudflare Workers free plan (one Worker and one SQLite Durable Object).

- Players post platform, chapter and what they need. Others reply live.
- Each post has a voice room for up to 4 players. Audio goes peer to peer
  through Cloudflare's TURN relay (relay only), so players never see each
  other's IP address. Nothing is recorded.
- No accounts, emails or ages. Posts and replies delete themselves after 2 hours.
  Rate limits use a salted hash of the visitor's IP that changes every day.
- Links, emails, phone numbers, handles and other apps are blocked in posts.
  Three reports hide a post or reply until a moderator looks at it.

## Secrets (set in the Cloudflare dashboard, never committed)

| Name | What |
| --- | --- |
| `TURN_KEY_ID` | Voice relay key id (Cloudflare Realtime > TURN) |
| `TURN_KEY_API_TOKEN` | Voice relay key token |
| `MOD_KEY` | Passphrase for the `/mod` moderation page |

Without the two TURN secrets the server says voice is off; it never pretends to connect.
`VOICE_DAILY_JOINS` in `wrangler.jsonc` caps voice joins per day to stay inside
Cloudflare's free 1,000 GB of relay traffic a month.

## Add the panel to the site

```html
<div id="vw-lfg" data-api="https://WORKER-ADDRESS"></div>
<script src="lfg.js" defer></script>
```

`site-panel/lfg.js` is the panel. Browsers only allow the microphone on HTTPS
pages, so voice stays off (and says so) until the site is served over HTTPS.

## Local test

```
npm install
printf 'DEV_STUN_ONLY=1\nMOD_KEY=local-test-only\n' > .dev.vars
npx wrangler dev --port 8799
node test/smoke.mjs     # server checks
node test/panel.mjs     # panel checks
```

## Check the live server

After Cloudflare finishes, run this read-only check (it posts nothing):

```
node live-server/test/live-check.mjs https://vicewire.<your-subdomain>.workers.dev
```
