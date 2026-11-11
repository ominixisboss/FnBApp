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
- Decks are saved in your browser's localStorage.

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

Hero abilities are not automated yet either. Every card's detail view shows what is and isn't automated. In a game, the **🛠 Manual** panel lets you apply any missing effect yourself: change life, draw, add resources or action points, change attack power, or create tokens. The bots play every card using its stats plus whatever text is automated.

## Development

```bash
npm install
npm run dev            # start the dev server
npm test               # rules tests + 70 bot-vs-bot simulated games
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
src/test/                 vitest tests
```

## Credits

Card data comes from the open-source [the-fab-cube/flesh-and-blood-cards](https://github.com/the-fab-cube/flesh-and-blood-cards) project. Card images are hosted by Legend Story Studios. Flesh and Blood is a trademark of Legend Story Studios. This is an unofficial fan project and is not affiliated with or endorsed by LSS.
