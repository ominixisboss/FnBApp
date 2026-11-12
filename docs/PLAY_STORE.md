# Publishing FaB Trainer on Google Play

The repo builds a signed Play Store bundle (`.aab`) with `.github/workflows/play-store.yml`. These steps need
your own Google account and a private signing key. Neither can be created for you.

## 1. One-time setup

1. **Developer account**: sign up at <https://play.google.com/console> (one-time US$25 fee, identity check).
2. **Create your upload key** on your computer (keep the file and passwords safe and private, and never commit them):
   ```bash
   keytool -genkeypair -v -keystore upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 upload.keystore > upload.keystore.b64     # macOS: base64 -i upload.keystore -o upload.keystore.b64
   ```
3. **Add GitHub secrets** (repo → Settings → Secrets and variables → Actions → New repository secret):
   | Secret | Value |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | contents of `upload.keystore.b64` |
   | `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
   | `ANDROID_KEY_ALIAS` | `upload` (or the alias you chose) |
   | `ANDROID_KEY_PASSWORD` | the key password |
4. **Build the bundle**: Actions → *Play Store release* → *Run workflow* (or push a tag such as `v1.0.0`).
   Download `fab-trainer.aab` from the run's artifacts.
5. **Create the app in Play Console**, enable *Play App Signing*, and upload that first `.aab` by hand to
   *Testing → Internal testing*.
6. *(Optional, for automatic uploads afterwards)* create a Google Cloud service account with access to the app
   (Play Console → Users and permissions), download its JSON key and save it as the `PLAY_SERVICE_ACCOUNT_JSON`
   secret. From then on, every run uploads a draft to the internal testing track.

## 2. Store listing

- **App name:** FaB Trainer
- **Short description (80 chars max):** Learn and play Flesh and Blood vs AI bots, build decks and play friends online.
- **Full description:**

  > FaB Trainer is a free, fan-made companion for learning and playing the Flesh and Blood trading card game.
  >
  > • Play against Easy, Normal and Hard AI bots with every hero, using tuned starter decks or your own.
  > • Learn the game: short lessons, a keyword glossary, a guided practice game, and move hints that light up the cards to play, in order.
  > • Lethal puzzles: win-this-turn positions that even the bots can't solve.
  > • The Gauntlet: beat eight opponents in a row.
  > • Sealed and Draft: open packs or draft against bots, build a deck and play it.
  > • Deck builder with the full card database, legality checks, draw odds and decklist import/export.
  > • Online play: ranked ladder, friends, challenges, emotes and replays.
  > • Progression: XP, daily quests, achievements, card sleeves, playmats and avatar frames.
  > • Works offline against the bots.
  >
  > Flesh and Blood is a trademark of Legend Story Studios. FaB Trainer is an unofficial fan project and is not affiliated with or endorsed by Legend Story Studios.

- **Category:** Games → Card. **Tags:** card game, strategy.
- **Graphics** (in `docs/store/`): app icon `icon-512.png`, feature graphic `feature-graphic.png` (1024×500),
  phone screenshots in `screenshots/` (1920×1080, landscape).
- **Privacy policy URL:** `https://fab-trainer-free.onrender.com/#privacy` (the in-app policy page).

## 3. Questionnaires

- **Ads:** no ads.
- **Content rating (IARC):** a card game with fantasy art and no real-money gambling, chat (only preset emotes)
  or user-generated content. This normally rates *Everyone 10+ / PEGI 7*, but answer the questionnaire honestly.
- **Target audience:** 13+.
- **Data safety:**
  - Data collected only if the player creates an account: username, password (stored hashed), and app activity
    (decks, match history, ratings, friends, replays).
  - Purpose: app functionality and account management only. Not shared with third parties. Encrypted in transit
    (HTTPS). Players can ask for deletion (see the privacy page).
  - No location, contacts, photos, advertising ID or analytics.

## 4. Things to know before publishing

- **Card art and trademarks.** The app shows official card images (loaded from Legend Story Studios' public image
  server) and uses the Flesh and Blood name. Fan apps are generally tolerated, but Google may ask you to show
  permission from the rights holder if anyone complains. Read LSS's current fan content / IP policy before
  publishing and consider asking LSS directly.
- **Server.** Accounts and online play need the server running (`fab-trainer-free.onrender.com`). On Render's free
  plan it sleeps when idle, so the first sign-in can take about a minute.
- **Versions.** Each Play build's version code comes from the workflow run number, so newer builds always
  upgrade older ones. The sideload APK from `android.yml` uses the same package name, so uninstall the
  sideloaded app before installing the Play version, because the signing keys differ.
