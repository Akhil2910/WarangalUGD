import { useEffect, useState } from 'react';
import { PASSWORD_MIN_LENGTH } from 'shared';
import { api, type User } from './api.ts';
import { MapView } from './MapView.tsx';
import { setPerms } from './perm.ts';
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
      .then((r) => { setPerms(r.user?.perms); setUser(r.user ?? null); })
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
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <div className="login-bg" aria-hidden />
      <div className="login-shade" aria-hidden />
      {/* sewer lines flowing across the city */}
      <svg className="login-flow" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <path d="M-50 640 C 300 600 520 700 820 610 S 1300 520 1650 560" />
        <path d="M-50 380 C 260 420 520 330 800 400 S 1260 470 1650 380" />
        <path d="M300 -50 C 360 240 280 480 420 700 S 520 900 480 1050" />
        <path d="M1150 -50 C 1100 260 1230 460 1150 700 S 1080 900 1180 1050" />
        <path d="M820 610 C 880 520 760 470 800 400" className="thin" />
      </svg>
      <main className="login-center">
        <form
          className="login-card"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await api('/api/auth/login', { email: email.trim(), password });
              onDone();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="login-mark"><img src="/icon.svg" alt="" width={56} height={56} /></div>
          <h1>Warangal UGD Tracker</h1>
          <p className="login-sub">Greater Warangal Municipal Corporation</p>
          <label>
            User ID
            <input type="email" autoComplete="username" placeholder="name@gwmc.local" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label>
            Password
            <span className="pw-wrap">
              <input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" className="pw-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}>
                {show ? (
                  <svg viewBox="0 0 24 24" aria-hidden><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10.4 10.4 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 19 12 19a9.6 9.6 0 0 0 5.4-1.6" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" /><circle cx="12" cy="12" r="3" /></svg>
                )}
              </button>
            </span>
          </label>
          {error && <p className="login-error">{error}</p>}
          <button className="login-btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<span aria-hidden>→</span></button>
        </form>
      </main>
      <footer className="login-foot">
        <a href="/g/status">Citizen complaint status</a>
        <span>Background: Sentinel-2 cloudless 2016 by EOX (Copernicus data)</span>
      </footer>
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
