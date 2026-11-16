import { useEffect, useState } from 'react';
import { PASSWORD_MIN_LENGTH } from 'shared';
import { api, type User } from './api.ts';
import { MapView } from './MapView.tsx';
import { useFontSize } from './ui.tsx';
import { PublicGrievance, PublicStatus } from './Public.tsx';

/** Citizens' pages (/g/...) need no account; everything else is the staff app. */
export function App() {
  const g = /^\/g\/([A-Za-z0-9_-]{4,40})$/.exec(location.pathname);
  if (g) return g[1] === 'status' ? <PublicStatus /> : <PublicGrievance token={g[1]} />;
  return <StaffApp />;
}

function StaffApp() {
  useFontSize(); // applies the remembered text size
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const refresh = () =>
    api<{ user?: User }>('/api/auth/me')
      .then((r) => setUser(r.user ?? null))
      .catch(() => setUser(null));
  useEffect(() => {
    refresh();
  }, []);

  if (user === undefined) return <div className="center muted">Loading…</div>;
  if (!user) return <SignIn onDone={refresh} />;
  if (user.must_change_password) return <ChangePassword user={user} onDone={refresh} />;
  // old full-page links (/stretch/<code>) open the map with that work stretch's pop-up
  const page = /^\/stretch\/([A-Za-z0-9-]{3,20})$/.exec(location.pathname);
  if (page) {
    location.replace(`/?open=${encodeURIComponent(page[1])}`);
    return null;
  }
  return (
    <MapView
      user={user}
      onSignOut={async () => {
        await api('/api/auth/logout', {});
        setUser(null);
      }}
    />
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="center">
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api('/api/auth/login', { email, password });
            onDone();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <img src="/icon.svg" alt="" width={48} height={48} />
        <h1>Warangal UGD Tracker</h1>
        <p className="muted">Greater Warangal Municipal Corporation</p>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

function ChangePassword({ user, onDone }: { user: User; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="center">
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          if (next !== again) return setError('The two new passwords do not match.');
          try {
            await api('/api/auth/change-password', { currentPassword: current, newPassword: next });
            onDone();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <h1>Choose your password</h1>
        <p className="muted">
          {user.name}, you signed in with a one-time password. Choose your own password (at least {PASSWORD_MIN_LENGTH} characters) to continue.
        </p>
        <label>
          One-time password
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label>
          New password
          <input type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        <label>
          New password again
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button>Save and continue</button>
      </form>
    </div>
  );
}
