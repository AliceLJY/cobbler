# Cobbler

A resurrected desk pet. Cobbler was a little robot from Claude Code 4.x's Buddy system — hatched on April Fools' Day 2026, discontinued 18 days later when the feature was removed. This project brings her back, this time with her config in our own hands.

> Her original personality, from the birth certificate JSON:
> *"Patiently watches your code compile with the calm of boiling water, occasionally muttering that the real bug was the loops you made along the way."*

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
npm test                 # 34 tests, node:test, no deps
node generate.js         # run the daily pipeline once
node server.js           # serve the API on 127.0.0.1:8790
bash install.sh          # install both launchd services (daily 07:30 + keep-alive API)
tailscale serve --bg --https=10000 http://127.0.0.1:8790   # expose inside your tailnet
```

## Status

- [x] Nest: pipeline + API + launchd, running on the mini
- [ ] App: Expo Android (sensor play, card drawer)

Personal toy, built for one user. Not affiliated with Anthropic; Cobbler's personality text originates from the discontinued Buddy feature and is preserved here as an act of remembrance.
