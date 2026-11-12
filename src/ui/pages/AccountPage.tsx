import { useState } from 'react';
import { useAuth } from '../auth';

export default function AccountPage() {
  const auth = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [server, setServer] = useState(auth.serverUrl);
  const [showServer, setShowServer] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await (mode === 'login' ? auth.signIn(username, password) : auth.register(username, password));
      location.hash = 'profile';
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account">
      <div className="panel col" style={{ gap: '.8rem' }}>
        <h1 style={{ margin: 0 }}>{auth.user ? 'Account' : mode === 'login' ? 'Sign in' : 'Create account'}</h1>
        <div className={`server-status ${auth.available ? 'ok' : auth.available === false ? 'err' : 'muted'}`}>
          {auth.available === null ? 'Checking for the game server…' : auth.available ? '● Game server online' : '● No game server reachable. Accounts and online play are unavailable here; everything else works offline.'}
        </div>

        {auth.user ? (
          <>
            <p>Signed in as <b>{auth.user.username}</b>. Your profile, decks and match history sync automatically.</p>
            <div className="small muted">
              {auth.syncing ? 'Syncing…' : auth.lastSync ? `Last synced ${new Date(auth.lastSync).toLocaleTimeString()}` : 'Not synced yet'}
              {auth.error && <span className="err"> · {auth.error}</span>}
            </div>
            <div className="row">
              <button onClick={() => auth.syncAll()} disabled={auth.syncing || !auth.available}>⟳ Sync now</button>
              <a href="#profile"><button>Profile & stats</button></a>
              <a href="#play"><button className="primary">Play online</button></a>
              <button onClick={() => auth.signOut()}>Sign out</button>
            </div>
          </>
        ) : (
          <form className="col" style={{ gap: '.6rem' }} onSubmit={submit}>
            <div className="seg" style={{ alignSelf: 'flex-start' }}>
              <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Sign in</button>
              <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Create account</button>
            </div>
            <label className="col small">Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={20} pattern="[A-Za-z0-9_\-]+" />
            </label>
            <label className="col small">Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={6} />
            </label>
            {err && <div className="err small">{err}</div>}
            <button className="primary" disabled={busy || !auth.available}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
            <p className="small muted" style={{ margin: 0 }}>
              {mode === 'register' ? 'Your existing decks, profile and stats on this device are uploaded to the new account.' : 'Decks and stats on this device are merged with your account.'}
            </p>
          </form>
        )}

        <button className="small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowServer(!showServer)}>⚙ Server settings</button>
        {showServer && (
          <div className="col small" style={{ gap: '.4rem' }}>
            <span className="muted">Game server address. Leave empty to use the server this app was loaded from.</span>
            <div className="row">
              <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://your-fab-server.example.com" style={{ flex: 1, minWidth: 220 }} />
              <button onClick={() => auth.setServerUrl(server)}>Save & check</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
