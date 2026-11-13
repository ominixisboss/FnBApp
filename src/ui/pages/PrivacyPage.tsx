// Privacy policy (also linked from the Play Store listing).
export default function PrivacyPage() {
  return (
    <div className="panel lesson" style={{ maxWidth: 820 }}>
      <h1>Privacy policy</h1>
      <p className="muted small">FaB Trainer is a free, unofficial fan app for learning and playing Flesh and Blood. Last updated: November 2026.</p>
      <h3>Without an account</h3>
      <p>Everything stays on your device: decks, match history, progress, settings and saved card images are kept in the app’s local storage. Nothing is sent anywhere, except that card images are downloaded from Legend Story Studios’ public image server when they are shown.</p>
      <h3>With an account (optional)</h3>
      <p>If you create an account to sync between devices and play online, the game server stores:</p>
      <ul>
        <li>your username and a salted, scrypt-hashed password (never the password itself);</li>
        <li>your profile (display name, avatar hero, equipped cosmetics), decks and match history;</li>
        <li>for online play: ranked ratings (all-time and per season), friends list, friend cups, your pools and decks at draft/sealed tables (kept in memory for a day), and replays of online games (kept for 60 days, visible only to the two players);</li>
        <li>if you turn on notifications: your browser’s push subscription, used only to tell you about friend challenges and friend cups. Turning notifications off deletes it.</li>
      </ul>
      <p>This data is used only to run the app’s features. It is not sold, shared with third parties, or used for advertising. The app has no ads and no analytics or tracking. Other players can see your display name, avatar and rating on the leaderboards, and your friends can see when you’re online.</p>
      <h3>Deleting your data</h3>
      <p>Signing out leaves your local data on the device; clearing the app’s storage (or uninstalling) removes it. To delete your account and everything stored on the server, contact the app’s maintainer through the project’s GitHub page and it will be removed.</p>
      <h3>Children</h3>
      <p>The app is not directed at children under 13 and does not knowingly collect their data.</p>
      <h3>Trademarks</h3>
      <p>Flesh and Blood is a trademark of Legend Story Studios. Card data comes from the open-source the-fab-cube project. This app is not affiliated with or endorsed by LSS.</p>
    </div>
  );
}
