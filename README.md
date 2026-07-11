# Cobbler

A resurrected desk pet. Cobbler was a little robot from Claude Code 4.x's Buddy system — hatched on April Fools' Day 2026, discontinued 18 days later when the feature was removed. This project brings her back, this time with her config in our own hands.

> Her original personality, from the birth certificate JSON:
> *"Patiently watches your code compile with the calm of boiling water, occasionally muttering that the real bug was the loops you made along the way."*

<p align="center">
  <img src="docs/screenshots/app-home.jpg" width="340" alt="Cobbler app home: pet stage on top, card drawer below showing 'this day three months ago' memory cards">
</p>
<p align="center"><i>Her mutter that day: "Watching you stack up bridge after bridge you once studied — my kettle has boiled over a few times."</i></p>

## Architecture

```
Mac mini (the nest)                      Android phone (the body)
┌─────────────────────────────┐          ┌──────────────────────┐
│ Daily pipeline (launchd)     │          │ Expo app              │
│  learnings + git history     │          │  pet stage (animated) │
│  → claude -p (persona)       │  HTTPS   │  sensor play (local)  │
│  → today's memory card,      │◄─────────│  card drawer          │
│    mutter, mood (fallback    │Tailscale │  offline cache        │
│    templates if claude down) │          └──────────────────────┘
│ API (launchd, keep-alive)    │
│  /api/state /api/card/today  │
│  /api/cards /api/heartbeat   │
└─────────────────────────────┘
```

- **nest/** — zero-dependency Node service on the Mac mini. Scans your real history (learning logs + git commits), picks a "this day N months ago" memory, and has Claude write the day's card and mutter in Cobbler's voice. Never comes up empty: template fallbacks cover Claude outages. Mood follows your real activity; ignore her for 4+ days and she starts keeping a diary.
- **app/** — Expo Android app (work in progress). She sleeps when you lay the phone flat, bounces along when you walk, gets dizzy when you shake her.

## Nest quick start

```sh
cd nest
npm test                 # 77 tests, node:test, no deps
node generate.js         # run the daily pipeline once
node server.js           # serve the API on 127.0.0.1:8790
bash install.sh          # install both launchd services (daily 07:30 + keep-alive API)
tailscale serve --bg --https=10000 http://127.0.0.1:8790   # expose inside your tailnet
```

App builds read the nest URL from the `EXPO_PUBLIC_NEST_URL` environment variable (set it as an EAS env var; nothing private lives in this repo).

## Bring your own history

The nest feeds on two sources, both pluggable and both optional:

- **git history** — everyone has this. `nest/collect.js` scans every repo under `~/Projects/*/` and only counts commits *you* authored (identity read from `git config --global`). Fork the repo, run the nest, and your Cobbler digs "this day N months ago" out of your own commits from day one.
- **learning logs** — my personal markdown check-in tables (`| # | MM-DD | source | topic |` rows in `YYYY-MM.md` files). If the directory doesn't exist, the pipeline silently skips it. To feed your own journal/notes, mimic `nest/lib/parse-learnings.js` — any parser that returns `{date, kind, title, detail}` items plugs straight in.

No accounts, no cloud, no telemetry: your history stays on your machine, and the daily card is written by a local `claude -p` call (with plain-template fallback if Claude is unavailable).

## Status

- [x] Nest: daily pipeline + API + launchd + lazy self-heal (v0.1–0.3)
- [x] App: sensor play (lay flat / walk / shake), card drawer, offline cache (v0.1)
- [x] Daily local notification (v0.2), touch play — poke fireworks / drag & spring-back (v0.3)
- [x] Floating bubble overlay — Cobbler's face floats over any app, drag to snap, tap to return (v0.4, native Kotlin module)
- [ ] Mood-aware bubble face, hand-drawn art pass, FCM push

Personal toy, built for one user, shared as-is. Not affiliated with Anthropic; Cobbler's personality text originates from the discontinued Buddy feature and is preserved here as an act of remembrance.
