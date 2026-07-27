# Fangs & Honor — multiplayer server

A tiny WebSocket **relay + lockstep clock** for 1v1. It does not run the game
itself: the client sim (`src/sim/*`) is deterministic and command-driven, so the
server only pairs players, shares a seed, keeps one authoritative 30 Hz tick
counter per match, and relays each player's small command objects to both sides
stamped with a future execute-tick (input delay). Both clients then run the
identical command on the identical tick and stay in sync.

## Run locally

```bash
cd server
npm install
npm start        # listens on :8080  (GET /health, WS on /ws)
npm test         # headless two-client smoke test
```

Env: `PORT` (8080), `INPUT_DELAY` (6 ticks ≈ 200 ms).

## Deploy on the VPS (Ubuntu + nginx + TLS)

Assumes Node 22, nginx and the repo are already on the box, and
`play.fangs-and-honor.com` A-records to the VPS.

```bash
# 1) install deps for the server
cd /root/Direct-Strike-Online/server && npm install --omit=dev

# 2) run it as a service (systemd)
sudo tee /etc/systemd/system/fh-server.service >/dev/null <<'UNIT'
[Unit]
Description=Fangs & Honor multiplayer server
After=network.target

[Service]
WorkingDirectory=/root/Direct-Strike-Online/server
ExecStart=/usr/bin/node index.js
Environment=PORT=8080
Restart=always
RestartSec=2
User=root

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now fh-server
sudo systemctl status fh-server --no-pager

# 3) nginx reverse proxy (WebSocket upgrade) for the subdomain
sudo tee /etc/nginx/sites-available/play.fangs-and-honor.com >/dev/null <<'NGINX'
server {
    listen 80;
    server_name play.fangs-and-honor.com;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
    }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/play.fangs-and-honor.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 4) TLS (free, auto-renewing) — needs DNS already pointing here
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d play.fangs-and-honor.com --agree-tos -m alexandru.serac99@gmail.com --redirect -n
```

Health check: `https://play.fangs-and-honor.com/health` → `{"ok":true,...}`.
The client connects to `wss://play.fangs-and-honor.com/ws`.

## Update after a code change

```bash
cd /root/Direct-Strike-Online && git pull
cd server && npm install --omit=dev
sudo systemctl restart fh-server
```

## Protocol (v3)

Client → server: `hello{name}`, `quickmatch{race}`, `create{race,private}`,
`join{code,race}`, `rooms`, `cmd{cmd}`, `checksum{tick,sum}`, `leave`, `ping`,
plus the lobby: `lobby_race{race}`, `lobby_ready{ready}`, `lobby_chat{text}`,
`lobby_slot{side,depth,kind,difficulty,race}`, `lobby_kick{id}`,
`lobby_move{fromSide,fromDepth,toSide,toDepth}`, `lobby_swap_req{id}`,
`lobby_swap_reply{id,accept}`, `lobby_start`.
Server → client: `welcome{id}`, `queued`, `room{code}`, `lobby{room}`,
`roomlist{rooms}` (public rooms with a free seat: code, host, players, bots, max),
`swap_req{from,name}`, `swap_declined{name}`, `kicked`, `start{seed,youAre,
roster,races,sides,inputDelay,tickHz}`, `cmd{tick,team,cmd}`, `clock{tick}`,
`desync{tick}`, `player_left{index,name,reason}`, `opp_left`, `error{reason}`,
`pong`.

### The room ("cameră")

A room is a persistent WC3-style lobby: two sides × 3 slots, each `open`,
`closed`, a `bot` or a seated player. The host owns the slot layout (open /
close / seat a bot / move a bot / kick); every player owns their own race and
ready flag. Two humans trade seats only by asking (`lobby_swap_req` → the other
answers `lobby_swap_reply`). `lobby_start` is host-only and refused unless every
seated human is ready and both sides have someone.

### From the roster to the match

`start.roster` is the final list of COMMANDERS in layout order (side 0 back →
front, then side 1): `{index, side, race, name, bot, difficulty}`. Empty slots
simply aren't in it, so a 3-vs-2 room starts as an asymmetric 2v3 and the
smaller side picks up the admin-set income bonus. Every client builds the same
`Game` from `seed` + the roster, and runs each BOT locally with a seed derived
from the match seed — bot commands never touch the wire, and all sims stay
bit-identical (see `server/test-lockstep-team.mjs`).

A player who drops mid-match does NOT end a team game: the server relays a
deterministic `abandon` command on a stamped tick, so on every client their base
and army stay on the field while their side counts as short-handed for the
asymmetric income bonus.
