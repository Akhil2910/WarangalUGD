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
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const FACTS: [string, string][] = [['66', 'wards'], ['2,739 km', 'sewer network planned'], ['1,14,345', 'manholes planned'], ['8', 'GWMC zones']];
  const FEATURES: [string, string, string][] = [
    ['map', 'Work on the satellite map', 'Draw work stretches on DPR pipes and manholes; update status from the field.'],
    ['check', 'Compliance at every stage', 'Permissions, safety, testing and road restoration — recorded with photos and GPS, then verified.'],
    ['alert', 'Issues and citizen grievances', 'Problems reported anywhere on the map; citizens complain by scanning the QR board at the site.'],
    ['chart', 'Dashboards for every level', 'Progress, compliance, issues and grievances — city-wide, by zone, ward and sewerage zone.'],
  ];
  return (
    <div className="login">
      <section className="login-hero">
        <svg className="login-net" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid slice" aria-hidden>
          <g fill="none" stroke="currentColor" strokeLinecap="round">
            <path d="M-20 120 C120 140 180 60 300 90 S480 200 640 160" strokeWidth="3" />
            <path d="M-20 300 C100 260 220 330 320 300 S520 240 640 290" strokeWidth="4" />
            <path d="M80 -20 C110 120 60 240 140 360 S180 560 120 640" strokeWidth="2" />
            <path d="M420 -20 C400 120 470 220 430 340 S380 520 460 640" strokeWidth="2.5" />
            <path d="M-20 480 C160 450 260 520 380 470 S560 430 640 470" strokeWidth="2" />
            <path d="M300 90 L320 300 L380 470" strokeWidth="1.5" strokeDasharray="4 6" />
          </g>
          <g fill="currentColor">
            {[[300, 90], [320, 300], [380, 470], [140, 360], [430, 340], [60, 128], [520, 255], [210, 505]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="5" />)}
          </g>
        </svg>
        <div className="login-hero-in">
          <div className="login-brand"><img src="/icon.svg" alt="" width={44} height={44} /><span>Warangal UGD Tracker</span></div>
          <h1>Underground Drainage Project,<br />Greater Warangal</h1>
          <p className="login-te" lang="te">గ్రేటర్ వరంగల్ మునిసిపల్ కార్పొరేషన్</p>
          <p className="login-lead">One place to plan, build, check and monitor the city's sewer network — from the DPR to every road restored.</p>
          <div className="login-facts">{FACTS.map(([n, l]) => <div key={l}><b>{n}</b><span>{l}</span></div>)}</div>
          <ul className="login-feat">
            {FEATURES.map(([icon, t, d]) => (
              <li key={t}><span className={`lf-icon lf-${icon}`} aria-hidden /><div><b>{t}</b><span>{d}</span></div></li>
            ))}
          </ul>
        </div>
      </section>
      <section className="login-side">
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
          <h2>Sign in</h2>
          <p className="muted">Use the GWMC account given to you.</p>
          <label>
            User ID (email)
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
          {error && <p className="error">{error}</p>}
          <button className="primary big" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="login-roles">
            For the Contractor, PIU, PMU, PGDMC, Commissioner and Financial Institution — each sees what their role needs.
          </div>
        </form>
        <div className="login-citizen">
          <b>Citizen?</b> Scan the QR board at the work site to report a problem, or <a href="/g/status">check the status of your complaint</a>.
        </div>
        <footer className="login-foot">Greater Warangal Municipal Corporation · For official use</footer>
      </section>
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
