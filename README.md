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
Mac mini (the nest)                             Android phone (the body)
┌────────────────────────────────────┐          ┌──────────────────────┐
│ Four scheduled feeds               │          │ Expo app              │
│  07:30 personal history → app card │  HTTPS   │  animated pet stage   │
│  08:30 Met artwork → Telegram      │◄─────────│  local sensor play    │
│  12:30 local book → Telegram       │Tailscale │  cards + diary drawer │
│  21:00 knowledge page → Telegram   │          │  offline cache        │
│                                    │          └──────────────────────┘
│ Two keep-alive processes           │
│  local API + Telegram listener     │
└────────────────────────────────────┘
```

- **nest/** — zero-dependency Node service on the Mac mini. The morning feed scans learning logs and authored git commits, picks a "this day N months ago" memory, and asks the installed Claude CLI to write in Cobbler's voice. Template fallbacks cover Claude failures; a fresh installation with no eligible history can still have no memory card. Three optional gacha feeds draw from the Met API, a local ebook library, and a local knowledge base. Mood follows real activity; ignore her for 4+ days and she starts keeping a diary.
- **app/** — Expo Android app. She sleeps when you lay the phone flat, bounces along when you walk, gets dizzy when you shake her, keeps a local cache, schedules an 08:00 notification, and can appear as a native Android overlay bubble.

## Nest quick start

```sh
cd nest
npm test                 # node:test suite, no runtime dependencies
node generate.js         # run the daily pipeline once
node server.js           # serve the API on 127.0.0.1:8790
bash install.sh          # install/reload all six personal launchd agents
tailscale serve --bg --https=10000 http://127.0.0.1:8790   # expose inside your tailnet
```

`install.sh` is personal Mac mini wiring: its launchd templates expect this repository at `~/Projects/cobbler`. The three Telegram feeds and listener also expect an ignored `nest/data/tg.json`; the book and knowledge feeds depend on Alice's local libraries. They are not required to run the API or Android app.

App builds read the nest URL from the `EXPO_PUBLIC_NEST_URL` environment variable. For a local app checkout, run `npm install` and `npm run check` under `app/`; EAS preview builds use `app/scripts/build-apk.sh` and a local Expo token file.

## Bring your own history

The nest feeds on two sources, both pluggable and both optional:

- **git history** — everyone has this. `nest/collect.js` scans every repo under `~/Projects/*/` and only counts commits *you* authored (identity read from `git config --global`). Fork the repo, run the nest, and your Cobbler digs "this day N months ago" out of your own commits from day one.
- **learning logs** — my personal markdown check-in tables (`| # | MM-DD | source | topic |` rows in `YYYY-MM.md` files). If the directory doesn't exist, the pipeline silently skips it. To feed your own journal/notes, mimic `nest/lib/parse-learnings.js` — any parser that returns `{date, kind, title, detail}` items plugs straight in.

There is no Cobbler account, hosted backend, or telemetry. Raw history remains on the Mac mini, but selected source text is sent through the installed Claude CLI when generation is enabled; museum cards call the Met API, Telegram feeds call the Bot API, and EAS builds use Expo's service. Source text is marked as untrusted data and Claude runs with tools, browser integration, and session persistence disabled. Plain templates cover Claude failures.

## Status

- [x] Nest: daily pipeline + API + launchd + lazy self-heal (v0.1–0.3)
- [x] App: sensor play (lay flat / walk / shake), card drawer, offline cache (v0.1)
- [x] Daily local notification (v0.2), touch play — poke fireworks / drag & spring-back (v0.3)
- [x] Floating bubble overlay — Cobbler's face floats over any app, drag to snap, tap to return (v0.4, native Kotlin module)
- [x] Knowledge-page gacha feed (v0.5), Telegram follow-up slips and listener (v0.6)
- [x] Met artwork gacha (v0.7), local-book gacha (v0.8)
- [x] Reliability, CI, dependency, and documentation maintenance (v0.8.1; Android app v0.4.1)
- [ ] Mood-aware bubble face, hand-drawn art pass, FCM push

Personal toy, built for one user, shared as-is. Not affiliated with Anthropic; Cobbler's personality text originates from the discontinued Buddy feature and is preserved here as an act of remembrance.

## License

This repository currently has no repository-wide open-source license. `app/LICENSE` is the original Expo scaffold notice for Expo-owned material; it is not a license grant for Cobbler as a whole.
