# FaB Trainer

A web app for learning and playing the **Flesh and Blood** TCG against AI bots, with a deck builder and the full card database.

## Features

- **Full card database**: all ~5,000 cards, including stats, rules text, legality (Blitz, CC, Silver Age, Commoner), sets and images. Search by name, text or keyword, and filter by class, talent, type, pitch and format.
- **Learn**: nine short lessons (pitching, action points and go again, the combat chain, defending, arsenal, reactions, strategy) and a keyword glossary.
- **Guided practice**: a game against an easy bot with move suggestions that explain the reasoning. You can undo any move.
- **Play vs AI**: easy, normal and hard bots. The bots plan their whole turn (which cards to play, pitch or keep for blocking) and decide blocks and reactions by card value.
- **Deck builder**:
  - Hero picker, with the card pool filtered to the hero's class and talents.
  - Live legality checks: deck size, copy limits, young/adult hero, bans, legendary cards, specializations.
  - Cost curve.
  - Import text decklists (Fabrary *Copy as text*, FaB DB, Talishar) and export them.
  - Auto-build a starter deck for any hero.
- **Deck saving**: edits are kept as a draft until you press **Save** (or Ctrl+S). There's also *Revert*, *Save as copy*, *Duplicate*, an unsaved-changes warning before you leave, `.txt` download per deck, and **Backup all / Restore** as a JSON file to keep decks safe or move them to another device. Decks are stored in the browser (localStorage).
- **Digital-client game feel**: a full-screen battlefield with no page chrome. Your hand is fanned at the bottom; hover a card to lift it, or drag it onto the battlefield to play it. The opponent's hand is fanned at the top. A big contextual action button (End Turn / No Blocks / Pass / …) sits next to a turn-phase tracker. Hovering a card shows a large preview, and the log and manual tools live in a slide-out drawer. Sound effects are synthesized in the browser and can be muted. The Play lobby has hero-art deck boxes, a matchup panel, difficulty and a big PLAY button.
- **Animations**: cards dealt into your hand, attacks flying onto the combat chain, blocks sliding in, pitch flashes, floating damage and heal numbers, screen shake on big hits, turn banners, and victory confetti or defeat embers. There's also card tilt with shine, page transitions, and ember particles on the home screen. Toggle them in the top bar; they are also off automatically when your OS asks for reduced motion.
- **Match history**: every finished game vs the AI is recorded locally (heroes, deck, difficulty, result, turns). This is groundwork for a future stats board and player profile.

- **Profile & stats**: display name and hero avatar. Stat tiles show games, record, win rate, streaks and average game length, plus recent form, win rate by your hero, by opponent hero, by opponent type and by format, and full match history.
- **Accounts & cloud sync** (needs the server): username/password sign-in. Profile, decks and match history sync across devices; decks merge newest-wins and deletions carry over.
- **Online play** (needs the server): quick match by format, or private rooms with a 5-letter code. The server runs the game with the same rules engine and validates every move. Each player only receives what they may see: the opponent's hand, both decks and face-down arsenal are hidden. Reconnecting resumes the game; a player who stays disconnected for 2 minutes forfeits. Results feed both players' stats and an online leaderboard.
- **Hero abilities**: about 27 heroes are automated, including Dorinthea, Bravo, Benji, Arakni, Ira, Fai, Cindra/Fang, Rhinar, Kayo, Aurora, Oscilio, Terra, Vynnset, Kavdaen, Data Doll, Dash, Emperor, Lyath, Valda and Tuffnut. The card pop-out says what's automated for each hero.
- **Hero-tuned decks**: bots and starter decks are built around each hero's archetype (Weapon Warrior, Guardian Crush, Ninja Combo, Brute Big Hits, Draconic Aggro, Stealth Assassin, Arcane Wizard, Runechant Runeblade, Mechanologist Boost) with signature cards.

## Running it online

There are two ways to host it:

1. **Static only (GitHub Pages)**: `.github/workflows/deploy-pages.yml` builds and tests every pull request and publishes the app on every push to `main`. One-time setup: repo **Settings → Pages → Source: GitHub Actions**. Everything works except accounts and online play. You can point it at a server under *Account → Server settings*.
2. **Full app with accounts and online play**: run the Node server, which also serves the app.
   - **Render**: New → Blueprint → this repo (uses `render.yaml`: Docker, a 1 GB persistent disk for the database, and a generated `SESSION_SECRET`).
   - **Completely free, data kept (Render + Neon)**:
     1. Create a free Postgres database at [neon.com](https://neon.com) and copy its connection string (`postgresql://…?sslmode=require`).
     2. On Render: New → Blueprint → this repo, set the blueprint path to `render.free.yaml`, and paste the connection string when it asks for `DATABASE_URL`.

     Accounts, decks, stats and the leaderboard live in Neon and survive restarts. The catch is that Render's free service sleeps after about 15 minutes idle: the first visit then takes about a minute, and online games in progress when it sleeps are lost. If you leave `DATABASE_URL` empty, the server still runs but wipes its data on every restart, and the Account page warns about that.
   - **Any Docker host**: `docker build -t fab-trainer . && docker run -p 8787:8787 -v fab-data:/data fab-trainer`
   - **Locally**: `npm run build && npm run server`, then open http://localhost:8787.

   Environment variables: `PORT` (default 8787); `DATABASE_URL` (a Postgres connection string; when set, all data is stored there instead of SQLite); `DATA_DIR` (SQLite location, default `./data`); and `SESSION_SECRET` (signs login tokens; a random one is stored in the database if unset). Without `DATABASE_URL`, data lives in one SQLite file via Node's built-in `node:sqlite`, which needs Node 22.5 or newer.

## Rules engine

`src/engine/game.ts` is a pure, deterministic engine (seeded RNG, immutable state updates). It automates:

- Setup, start, action and end phases; action points and **go again**; drawing up to intellect; arsenal; pitched cards going to the bottom of the deck.
- Paying costs by pitching. Weapon and equipment activations (once per turn, `destroy this` costs).
- The combat chain: attack, defend (hand and equipment), alternating reaction step, damage, on-hit, resolution, chain close.
- Keywords: dominate, overpower, intimidate, piercing, ward, arcane barrier, spellvoid, battleworn, blade break, temper and boost.
- Common tokens: Runechant, Quicken, Courage, Might, Agility, Vigor, Ponder, Embodiment of Lightning, Blade Dance, Eloquence, Frostbite, Spectral Shield, Zen State, …

Card text is compiled by `src/engine/cardScript.ts`, which recognises the common templated sentences. Examples: *Draw a card*, *Deal N arcane damage*, *Your next X attack this turn gets +N{p}*, *Target attack gets +N{p}*, *When this hits…*, *When this attacks…*, *If this was played from arsenal…*, *Create a … token*, *Gain N{h}*, *Choose 1;* modes, and additional costs.

### Limitations

Flesh and Blood has thousands of unique effects, and this simulator automates only part of them:

| Card text automation | Cards |
| --- | --- |
| Fully automated | ~410 |
| Partly automated | ~1,810 |
| Stats only (text not automated) | ~2,600 |

Hero abilities for about 27 heroes are automated; the rest (mostly ones built on wagers, the crowd, soul, chi or Gold tokens) aren't yet. Every card's detail view shows what is and isn't automated. In a game, the **🛠 Manual** panel lets you apply any missing effect yourself: change life, draw, add resources or action points, change attack power, or create tokens. The bots play every card using its stats plus whatever text is automated.

## Development

```bash
npm install
npm run dev            # start the dev server (proxies /api and /ws to npm run server)
npm run server         # accounts + online play server on :8787 (serves dist/ too)
npm test               # rules, hero, online end-to-end tests + bot-vs-bot simulated games
npm run typecheck      # app + server type checks
npm run build          # production build in dist/ (static, deployable anywhere)
npm run update-cards   # refresh public/data/cards.json from the-fab-cube dataset
```

The app is a static single-page app (React, TypeScript, Vite) with hash routing, so `dist/` can go on GitHub Pages, Netlify or any static host.

### Project layout

```
scripts/build-cards.mjs   builds the compact card DB from the-fab-cube JSON
public/data/cards.json    compact card database (generated)
src/data/                 card types, DB loading, hero/class eligibility
src/engine/               rules engine + card-text compiler
src/ai/bot.ts             AI bots and the hint system
src/deck/deck.ts          deck model, legality, import/export, auto-build
src/learn/lessons.tsx     lesson content and glossary
src/ui/                   pages and components
src/online/               online client + per-player game views (hidden information)
src/stats/                match history, stats summaries, profile
server/                   Node server: SQLite storage, auth, sync API, online game rooms
src/test/                 vitest tests
```

## Credits

Card data comes from the open-source [the-fab-cube/flesh-and-blood-cards](https://github.com/the-fab-cube/flesh-and-blood-cards) project. Card images are hosted by Legend Story Studios. Flesh and Blood is a trademark of Legend Story Studios. This is an unofficial fan project and is not affiliated with or endorsed by LSS.
