# FaB Trainer

A web app for learning and playing the **Flesh and Blood** TCG against AI bots, with a deck builder and the full card database.

## Features

- **Full card database**: all ~5,000 cards, including stats, rules text, legality (Blitz, CC, Silver Age, Commoner), sets and images. Search by name, text or keyword, and filter by class, talent, type, pitch and format.
- **Learn**: nine short lessons (pitching, action points and go again, the combat chain, defending, arsenal, reactions, strategy) and a keyword glossary.
- **Guided practice**: a game against an easy bot with move suggestions that explain the reasoning. With hints on (💡), the suggested cards glow on the board: gold numbers give the order to play them in, blue ⛀ marks the cards to pitch, 🛡 the blockers and A the card for your arsenal. You can undo any move.
- **Play vs AI**: easy, normal, hard and **mythic** bots. The bots plan their whole turn (which cards to play, pitch or keep for blocking) and decide blocks and reactions by card value. Mythic also plays out many possible futures before each big decision, with the hidden cards reshuffled each time so it can't cheat. In 160 test games it won 62% against Hard, where Hard won 50% against itself on the same matchups.
- **Tuned bot decks**: each Blitz hero's bot deck was tuned by self-play (`scripts/tune-decks.mts`, output in `public/data/bot-decks.json`) and kept only when it also won more on games it wasn't tuned on. On a third set of held-out games the tuned lists won 54.8% against 43.7% for the original auto-built lists.
- **Deck builder**:
  - Hero picker, with the card pool filtered to the hero's class and talents.
  - Live legality checks: deck size, copy limits, young/adult hero, bans, legendary cards, specializations.
  - Cost curve.
  - Import text decklists (Fabrary *Copy as text*, FaB DB, Talishar) and export them.
  - Auto-build a starter deck for any hero.
- **Deck saving**: edits are kept as a draft until you press **Save** (or Ctrl+S). There's also *Revert*, *Save as copy*, *Duplicate*, an unsaved-changes warning before you leave, `.txt` download per deck, and **Backup all / Restore** as a JSON file to keep decks safe or move them to another device. Decks are stored in the browser (localStorage).
- **Digital-client game feel**: a full-screen battlefield with no page chrome. Your hand is fanned at the bottom; hover a card to lift it, or drag it onto the battlefield to play it. The opponent's hand is fanned at the top. A big contextual action button (End Turn / No Blocks / Pass / …) sits next to a turn-phase tracker. Hovering a card shows a large preview, and the log and manual tools live in a slide-out drawer. Sound effects are synthesized in the browser and can be muted. The Play lobby has hero-art deck boxes, a matchup panel, difficulty and a big PLAY button.
- **Smooth on phones**: the bots think in a background worker, so animations never pause while a bot decides. Effects only animate cheap properties (movement and fades).
- **Animations**: cards dealt into your hand, attacks flying onto the combat chain, blocks sliding in, pitch flashes, floating damage and heal numbers, screen shake on big hits, turn banners, and victory confetti or defeat embers. There's also card tilt with shine, page transitions, and ember particles on the home screen. Toggle them in the top bar; they are also off automatically when your OS asks for reduced motion.
- **Match history**: every finished game vs the AI is recorded locally (heroes, deck, difficulty, result, turns). This is groundwork for a future stats board and player profile.

- **Profile & stats**: display name and hero avatar. Stat tiles show games, record, win rate, streaks and average game length, plus recent form, win rate by your hero, by opponent hero, by opponent type and by format, and full match history.
- **Accounts & cloud sync** (needs the server): username/password sign-in. Profile, decks and match history sync across devices; decks merge newest-wins and deletions carry over.
- **Online play** (needs the server): quick match by format, or private rooms with a 5-letter code. The server runs the game with the same rules engine and validates every move. Each player only receives what they may see: the opponent's hand, both decks and face-down arsenal are hidden. Reconnecting resumes the game; a player who stays disconnected for 2 minutes forfeits. Results feed both players' stats and an online leaderboard.
- **Hero abilities**: 73 of the 86 heroes are automated, including Boltyn, Briar, Chane, Kano, Oldhim, Iyslander, Viserai, Teklovossen, Victor Goldmane, Shiyana, Betsy, Olympia, Zane, Hala, Prism, Levia, Azalea, Enigma, Dromai, Puffin, Marlynn, Gravy Bones, Dorinthea, Bravo, Benji, Arakni, Ira, Fai, Cindra/Fang, Rhinar, Kayo, Aurora, Oscilio, Terra, Vynnset, Kavdaen, Data Doll, Dash, Emperor, Lyath, Valda and Tuffnut. The card pop-out says what's automated for each hero.
- **Hero-tuned decks**: bots and starter decks are built around each hero's archetype (Weapon Warrior, Guardian Crush, Ninja Combo, Brute Big Hits, Draconic Aggro, Stealth Assassin, Arcane Wizard, Runechant Runeblade, Mechanologist Boost) with signature cards.

- **Progression:** XP for every game, levels with titles, three daily quests that change at midnight, 19 achievements, and unlockable card sleeves, playmats and avatar frames. Progress is calculated from your match history, so it syncs with your account.
- **Lethal puzzles:** 20 "win this turn" positions, each checked by a brute-force solver to have a winning line that the bots miss. You can see the solution after a failed attempt.
- **The Gauntlet:** eight bot heroes in a row, from Easy to Hard. One loss ends the run.
- **Sealed & Draft:** open six packs from one of 15 sets, or draft three packs at a table of seven bots. Then pick a hero, build a deck of 30 or more cards (or auto-build one) and play it.
- **Draft & Sealed with friends** (needs the server): open a table, share its code, and draft together. Empty seats get bots and there's a pick timer. The server keeps every pool, so decks are checked against what each player actually drafted. Then play anyone at the table.
- **Campaigns** (`#campaign`): four original story campaigns (Dorinthea, Fai, Arakni, Oscilio). Each is a path of six battles with a short scene and a twist (extra life for the opponent, going second, …), from Easy to a Mythic finale. Finishing one unlocks its own card sleeve.
- **Controls:** on touch screens, tap a card to bring it up large with **Play**, **Details** and **Cancel** (or a reason it can't be played now). Dragging still works: the card leans as you swing it, the board glows where you can drop it, and it springs back if you let go in the hand. On phones held upright the game switches to a one-handed layout.
- **Hero guides** (`#guides`): how each hero wins, its key cards and how to beat it, with *Play as* and *Practice against* buttons.
- **Mistake trainer** (`#drills`): save the positions from a game review where the Hard bot would have played differently, and drill them until you get each right twice in a row.
- **Sound & looks:** a generated soundtrack (calm in menus, driving in games; turn it on in the top bar), living playmats (embers, snow, stars, candlelight, lightning) and a glow around each hero in its talent's colours.
- **Accessibility:** colour-blind pitch markers (▲1 red, ■2 yellow, ●3 blue), larger text, card descriptions for screen readers and a live game log they read out.
- **Game review:** after a game, the Hard bot re-checks your decisions and lists where it would have played differently, and why.
- **Replays:** watch any recent game again, with play, step, scrub and speed controls. Games against the AI are stored in the browser; online games are stored on the server.
- **Online extras:** ranked quick matches with monthly seasons and a ladder per format (Elo, Bronze to Mythic; reaching Gold or Diamond in a season unlocks cosmetics), friends with online status, direct challenges (also to offline friends), and emotes.
- **Notifications** (web and installed web app): opt in on your Profile to get a notification when a friend challenges you or adds you to a friend cup. The server makes its own push keys, so there's nothing to set up. Set `PUSH_CONTACT` (e.g. `mailto:you@example.com`) to give push services a contact. The Android app's WebView can't receive web push; real Android push would need a Firebase project.
- **Deck tools:** pitch balance, average resources per hand, and per-card odds of drawing a card in your opening hand or by turn 2 or 3. Deck links from Fabrary, FaB DB and Talishar are recognised, with steps to copy the list as text.
- **The stack and priority:** played cards and activations go on a stack. Your opponent gets priority to respond with instants (prevention, pumps, …) before anything resolves, just like at a real table. You choose the order of your pitched cards at the end of turn, and the log explains the rule behind each step (tap a 📖 tip).
- **Sandbox mode:** move any card between any zones, shuffle, add counters, flip equipment, for effects the engine doesn't automate. Play against a 🐟 Goldfish (a dummy that never acts) to test a deck, or open a sandbox online room to play a tabletop-style game with a friend.
- **Real match structure:** roll a die for first turn, choose your equipment and cards from your pool before each game (Classic Constructed sideboarding), best of 3 with the loser choosing who goes first, and an optional chess clock.
- **Armory tournament:** three Swiss rounds against bots, then a Top 4 cut.
- **Formats:** Blitz, Classic Constructed, Living Legend, Silver Age, Commoner and Casual, each with its own deck rules and ban list. A weekly workflow (`update-cards.yml`) refreshes the card database and ban lists and opens a pull request; it needs *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests*. Every card's detail view shows the official keyword rules and links to the rules site and rulings.
- **Table tools** (`#tools`): a life counter for two players (keeps the screen awake, hold ± for 5), sample opening hands from your decks, and a printable deck registration sheet.
- **Bot personalities:** aggressive heroes (Brute, Ninja, Assassin, Pirate, Ranger) keep fewer cards back to block, patient ones (Guardian, Wizard, Illusionist, Mechanologist) defend more. The lobby shows each bot's style.
- **Spectating & friend cups:** watch a friend's live online game from your friends list. Friend cups (`#cups`) are private round robins for up to 8 friends; results fill in automatically when cup members finish an online game against each other.
- **Installable web app:** on Android or desktop Chrome or Edge, the Home page offers *Install*. On iPhone, use Safari → Share → *Add to Home Screen*. The installed app runs full screen and plays the bots offline.

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

## Android app

The `android/` folder is a [Capacitor](https://capacitorjs.com) project that packages the web app as a native Android app. It bundles the full card database, so games against the bots work offline, and it connects to the hosted server (`.env.android` → `VITE_API_URL`) for accounts and online play.

- **Download:** every push to `main` builds an APK and publishes it as a GitHub Release (`.github/workflows/android.yml`). The newest one is always at `releases/latest/download/fab-trainer.apk`. On the phone, open the file and allow installing from that source. New versions install over the old one.
- **Google Play:** `docs/PLAY_STORE.md` explains how to publish. It covers the developer account, your private upload key as GitHub secrets, the signed bundle workflow (`play-store.yml`), and the listing text, graphics and questionnaires.
- **Build it yourself:** you need JDK 21 and the Android SDK (`ANDROID_HOME`). Run `npm run android:build`; the APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.
- **Signing:** builds use a fixed key that is committed on purpose (`android/app/fab-trainer-debug.keystore`), so updates install over each other. It's fine for sideloading; publishing to the Play Store would need your own private release key.
- **Full screen, landscape:** the app runs sideways and edge to edge, including the strip beside the camera, with the status and navigation bars hidden. Swipe in from an edge to see them for a moment. Buttons and cards stay clear of the camera.
- **Offline:** games against the bots work without a connection. Card images you've seen are kept on the phone, and **Decks → Save images for offline** downloads the art for every card in your decks.
- **Vibration:** the phone buzzes when you're hit (harder for big hits), and gives lighter taps when you land damage, block or play a card. Turn it off under ☰ → Vibration.
- **Phone layout:** a compact header with icon tabs, and a game board with two rows per side so the cards are bigger. Extra game buttons are under ☰. Tap a card to see its details, and tap it again to play it. In a phone browser held upright, the tabs move to a bottom bar.

## Rules engine

`src/engine/game.ts` is a pure, deterministic engine (seeded RNG, immutable state updates). It automates:

- Setup, start, action and end phases; action points and **go again**; drawing up to intellect; arsenal; pitched cards going to the bottom of the deck.
- The stack and priority: layers resolve last in, first out after both players pass; only instants can be played while the stack is open.
- Paying costs by pitching, with a chosen pitch order. Weapon and equipment activations (once per turn, `destroy this` costs).
- The combat chain: attack, defend (hand and equipment), alternating reaction step, damage, on-hit, resolution, chain close.
- Keywords: dominate, overpower, intimidate, piercing, ward, arcane barrier, spellvoid, battleworn, blade break, temper and boost.
- Common tokens: Runechant, Quicken, Courage, Might, Agility, Vigor, Ponder, Embodiment of Lightning, Blade Dance, Eloquence, Frostbite, Spectral Shield, Zen State, …

Card text is compiled by `src/engine/cardScript.ts`, which recognises the common templated sentences. Examples: *Draw a card*, *Deal N arcane damage*, *Your next X attack this turn gets +N{p}*, *Target attack gets +N{p}*, *When this hits…*, *When this attacks…*, *If this was played from arsenal…*, *Create a … token*, *Gain N{h}*, *Choose 1;* modes, and additional costs.

### Limitations

Flesh and Blood has thousands of unique effects, and this simulator automates only part of them:

| Card text automation | Cards |
| --- | --- |
| Fully automated | ~1,440 |
| Partly automated | ~1,470 |
| Stats only (text not automated) | ~1,910 |

Hero abilities for 73 of the 86 heroes are automated. The 13 still manual are Bolfar, Brevant, Kox, Frankie, Prism (both awakened versions), Reya, Ruu'di, Squizzy, Taipanis, Taylor, The Librarian, Theryon, Yoji and Yorick: they protect or redirect damage between several players, use an inventory or event deck, or are joke heroes with shared decks. Every card's detail view shows what is and isn't automated. In a game, the **🛠 Manual** panel lets you apply any missing effect yourself: change life, draw, add resources or action points, change attack power, create tokens, or (in sandbox mode) move any card between zones.

Recently added: clash, reload, crank, ephemeral, rupture, starfall, high tide, reprise, decompose, chi, and choosing the order of your start-of-turn triggers. `src/test/rules.test.ts` checks rules scenarios (go again, dominate, blade break, temper, arcane barrier, intimidate, the chain closing, trigger order).

**Your choices:** when an effect lets you decide, the game asks: which cards Opt keeps on top and in what order, which card Reload puts in your arsenal, whether to take a wager, and whether Betsy pays for her bonus. Anything that happens after the choice in the same effect waits for your answer. Bots decide instantly, and online the other player only sees that you're choosing, not the cards.

**Wagers and the crowd:** a wager is settled when its chain link resolves. If the attack hit, the attacker wins the wager; otherwise the defender does, and the winner creates the wagered tokens or gets the winner's bonus. The crowd cheering or booing does nothing by itself, but cards and heroes react to it ("whenever the crowd cheers you", "if you've been cheered this turn").

**Lasting effects:** unpreventable damage, "defense reactions can't be played this chain link", "can't be played from hand", "+N defense while defending a weapon attack", "+N defense if an attack reaction was played this chain link", and auras that give your (non-)attack action cards extra defense.

Also automated: heave (from the arsenal at end of turn, making Seismic Surge), aim counters, rune gate, watery grave, fragment, quell, suspense, mirage, guardwell, spectra, scrap, beat chest, Evo upgrades and stealing. Attacks can target an ally or an attackable aura instead of the hero, and damage effects that say "any target" ask you to pick one.

**Ultimate Pit Fight** (3 or 4 heroes, young hero, 40-card deck) is playable offline against 2 or 3 bots. You can attack only the heroes on your left and right: tap a seat at the top of the board to face them. The last hero standing wins. Limits: only the attacker and the defender get priority in the reaction step, and online UPF isn't supported yet. The bots play every card using its stats plus whatever text is automated.

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
