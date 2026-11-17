/**
 * Citizens' pages (no account): the complaint form opened by a work stretch's QR code (/g/<token>)
 * and the status check (/g/status). English and Telugu. Three simple steps, big tap targets, works on any phone.
 * Telugu wording to be checked by a GWMC Telugu speaker before going live.
 */
import { useEffect, useState } from 'react';
import { CSRF_HEADER } from 'shared';

type Lang = 'en' | 'te';
interface Cat { key: string; en: string; te: string }
interface Work { code: string; name: string; ward: number; zone: string; stage: string; categories: Cat[]; due_days: number }

const T = {
  title: { en: 'Report a problem at this road work', te: 'ఈ రోడ్డు పనిలో సమస్యను తెలియజేయండి' },
  sub: { en: 'Greater Warangal Municipal Corporation', te: 'గ్రేటర్ వరంగల్ మున్సిపల్ కార్పొరేషన్' },
  sub2: { en: 'Underground Drainage works', te: 'భూగర్భ డ్రైనేజీ పనులు' },
  ward: { en: 'Ward', te: 'వార్డు' },
  step1: { en: 'What is wrong?', te: 'ఏమి సమస్య?' },
  step2: { en: 'Tell us a little more', te: 'కొంచెం వివరంగా చెప్పండి' },
  step3: { en: 'Your details', te: 'మీ వివరాలు' },
  describeHint: { en: 'Where exactly, since when, how serious…', te: 'ఎక్కడ, ఎప్పటి నుంచి, ఎంత తీవ్రంగా…' },
  moreChars: { en: 'more letters needed', te: 'ఇంకా అక్షరాలు అవసరం' },
  photo: { en: 'Add a photo', te: 'ఫోటో జోడించండి' },
  photoHint: { en: 'Optional · up to 3', te: 'ఐచ్ఛికం · 3 వరకు' },
  location: { en: 'Add my location', te: 'నా లొకేషన్ జోడించండి' },
  locationOn: { en: 'Location added', te: 'లొకేషన్ జతచేయబడింది' },
  locationWait: { en: 'Finding your location…', te: 'మీ లొకేషన్ కోసం చూస్తోంది…' },
  locationHint: { en: 'Helps the officer find the exact spot', te: 'అధికారి స్థలాన్ని సులభంగా కనుగొనడానికి సహాయపడుతుంది' },
  name: { en: 'Your name', te: 'మీ పేరు' },
  mobile: { en: 'Mobile number', te: 'మొబైల్ నంబర్' },
  house: { en: 'House / door number (optional)', te: 'ఇంటి / డోర్ నంబర్ (ఐచ్ఛికం)' },
  consent: { en: 'GWMC may use my name, mobile number and photos only to resolve this complaint.', te: 'ఈ ఫిర్యాదు పరిష్కారానికి మాత్రమే నా పేరు, మొబైల్ నంబర్, ఫోటోలను GWMC ఉపయోగించుకోవచ్చు.' },
  submit: { en: 'Send complaint', te: 'ఫిర్యాదు పంపండి' },
  sending: { en: 'Sending…', te: 'పంపుతోంది…' },
  needed: { en: 'Still needed', te: 'ఇంకా అవసరం' },
  nCat: { en: 'the problem', te: 'సమస్య' },
  nDesc: { en: 'a few words', te: 'కొన్ని మాటలు' },
  nName: { en: 'your name', te: 'మీ పేరు' },
  nMobile: { en: 'a 10-digit mobile number', te: '10 అంకెల మొబైల్ నంబర్' },
  nConsent: { en: 'your agreement', te: 'మీ అంగీకారం' },
  thanks: { en: 'Thank you. Your complaint is registered.', te: 'ధన్యవాదాలు. మీ ఫిర్యాదు నమోదైంది.' },
  number: { en: 'Your complaint number', te: 'మీ ఫిర్యాదు నంబర్' },
  copy: { en: 'Copy', te: 'కాపీ' },
  copied: { en: 'Copied', te: 'కాపీ అయింది' },
  keep: { en: 'Keep this number. The officer will act within', te: 'ఈ నంబర్‌ను గుర్తుంచుకోండి. అధికారి ఇన్ని రోజుల్లో చర్య తీసుకుంటారు:' },
  days: { en: 'days', te: 'రోజులు' },
  check: { en: 'Check the status of a complaint', te: 'ఫిర్యాదు స్థితిని చూడండి' },
  another: { en: 'Report another problem', te: 'మరో సమస్యను తెలియజేయండి' },
  statusTitle: { en: 'Complaint status', te: 'ఫిర్యాదు స్థితి' },
  numberField: { en: 'Complaint number', te: 'ఫిర్యాదు నంబర్' },
  show: { en: 'Show status', te: 'స్థితి చూపించు' },
  received: { en: 'Received', te: 'స్వీకరించిన తేదీ' },
  due: { en: 'Answer due by', te: 'పరిష్కార గడువు' },
  updates: { en: 'Updates', te: 'తాజా సమాచారం' },
  sReceived: { en: 'Received', te: 'స్వీకరించబడింది' },
  sAttended: { en: 'Being attended', te: 'పరిష్కార దశలో ఉంది' },
  sResolved: { en: 'Resolved', te: 'పరిష్కరించబడింది' },
};
const tr = (k: keyof typeof T, l: Lang) => T[k][l];

/** Simple pictures for the problem tiles. */
const CAT_ICON: Record<string, string> = {
  open_trench: 'M12 3 2 20h20L12 3zM12 10v4M12 17v.1',
  road_damage: 'M8 3 5 21M16 3l3 18M12 4v3M12 10v2M12 15v2M11 19l2-1',
  water_cut: 'M12 3c3 4 5 6.6 5 9.5a5 5 0 0 1-10 0C7 9.6 9 7 12 3zM4 4l16 16',
  drain_blocked: 'M3 8h18M3 16h18M7 8v8M12 8v8M17 8v8',
  sewage_overflow: 'M12 3c3 4 5 6.6 5 9.5a5 5 0 0 1-10 0C7 9.6 9 7 12 3zM3 21c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0',
  dust_noise: 'M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7',
  debris: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  traffic: 'M5 16h14l-1.5-6h-11zM7 16v3M17 16v3M8 13h.1M16 13h.1M8 10l1-4h6l1 4',
  work_quality: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 16c1.8-1.6 5.2-1.6 7 0M9 9.5h.1M15 9.5h.1',
  other: 'M5 12h.1M12 12h.1M19 12h.1',
};
const Pic = ({ d, size = 26 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);

async function call<X>(url: string, body?: unknown): Promise<X> {
  const r = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json', [CSRF_HEADER]: '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? `Error ${r.status}`);
  return d as X;
}

async function shrink(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const s = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('photo'))), 'image/jpeg', 0.8));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function Header({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <header className="gf-head">
      <img src="/icon.svg" alt="" width={40} height={40} />
      <div className="gf-org"><b>{tr('sub', lang)}</b><span>{tr('sub2', lang)}</span></div>
      <div className="gf-lang" role="group" aria-label="Language">
        <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
        <button className={lang === 'te' ? 'on' : ''} onClick={() => setLang('te')}>తెలుగు</button>
      </div>
    </header>
  );
}

const mobileOk = (m: string) => /^[6-9]\d{9}$/.test(m.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''));

export function PublicGrievance({ token }: { token: string }) {
  const [lang, setLang] = useState<Lang>(navigator.language.startsWith('te') ? 'te' : 'en');
  const [w, setW] = useState<Work | null>(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ category: '', description: '', name: '', mobile: '', house_no: '', consent: false, share: false });
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lon: number; accuracy_m: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<{ number: string; due_date: string } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    call<Work>(`/api/public/w/${encodeURIComponent(token)}`).then(setW).catch((e) => setErr((e as Error).message));
  }, [token]);
  useEffect(() => {
    if (!f.share || !navigator.geolocation) return;
    setGps(null);
    navigator.geolocation.getCurrentPosition((p) => setGps({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy) }), () => { setGps(null); setF((x) => ({ ...x, share: false })); }, { enableHighAccuracy: true, timeout: 15000 });
  }, [f.share]);
  if (err && !w) return <div className="gf"><Header lang={lang} setLang={setLang} /><main className="gf-main"><div className="gf-card gf-center"><p className="gf-error">{err}</p></div></main></div>;
  if (!w) return <div className="gf"><Header lang={lang} setLang={setLang} /><main className="gf-main"><div className="gf-card gf-center">…</div></main></div>;
  const descLeft = Math.max(0, 10 - f.description.trim().length);
  const missing: string[] = [];
  if (!f.category) missing.push(tr('nCat', lang));
  if (descLeft) missing.push(tr('nDesc', lang));
  if (f.name.trim().length < 2) missing.push(tr('nName', lang));
  if (!mobileOk(f.mobile)) missing.push(tr('nMobile', lang));
  if (!f.consent) missing.push(tr('nConsent', lang));
  const send = async () => {
    setTried(true);
    if (missing.length) return;
    setBusy(true);
    setErr('');
    try {
      const r = await call<{ number: string; due_date: string }>('/api/public/grievances', {
        token, category: f.category, description: f.description, name: f.name, mobile: f.mobile, house_no: f.house_no, consent: f.consent,
        language: lang, photos: photos.map((p) => p.id), gps: f.share ? gps : null,
      });
      setDone(r);
      window.scrollTo(0, 0);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const addPhoto = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const data = await shrink(file);
      const r = await call<{ id: string }>('/api/public/photos', { token, name: file.name, mime: 'image/jpeg', data });
      setPhotos((x) => [...x, { id: r.id, url: URL.createObjectURL(file) }]);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const stepDone = [!!f.category, descLeft === 0, f.name.trim().length >= 2 && mobileOk(f.mobile) && f.consent];
  return (
    <div className="gf">
      <Header lang={lang} setLang={setLang} />
      <main className="gf-main">
        {done ? (
          <div className="gf-card gf-done">
            <div className="gf-tick"><Pic d="M5 12l5 5 9-10" size={40} /></div>
            <h1>{tr('thanks', lang)}</h1>
            <div className="gf-num-label">{tr('number', lang)}</div>
            <div className="gf-num">
              <span>{done.number}</span>
              <button onClick={async () => { try { await navigator.clipboard.writeText(done.number); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }}>{copied ? tr('copied', lang) : tr('copy', lang)}</button>
            </div>
            <p className="gf-muted">{tr('keep', lang)} {w.due_days} {tr('days', lang)}.</p>
            <a className="gf-btn" href={`/g/status?n=${done.number}`}>{tr('check', lang)}</a>
            <button className="gf-btn ghost" onClick={() => { setDone(null); setTried(false); setF({ ...f, category: '', description: '' }); setPhotos([]); }}>{tr('another', lang)}</button>
          </div>
        ) : (
          <>
            <div className="gf-intro">
              <h1>{tr('title', lang)}</h1>
              <div className="gf-work"><span className="gf-code">{w.code}</span><span><b>{w.name}</b><small>{tr('ward', lang)} {w.ward} · {w.stage}</small></span></div>
            </div>

            <section className={`gf-card ${tried && !stepDone[0] ? 'need' : ''}`}>
              <div className="gf-step"><span className={stepDone[0] ? 'ok' : ''}>{stepDone[0] ? '✓' : '1'}</span>{tr('step1', lang)}</div>
              <div className="gf-cats">
                {w.categories.map((c) => (
                  <button key={c.key} className={f.category === c.key ? 'on' : ''} onClick={() => setF({ ...f, category: c.key })} aria-pressed={f.category === c.key}>
                    <Pic d={CAT_ICON[c.key] ?? CAT_ICON.other} /><span>{c[lang]}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className={`gf-card ${tried && !stepDone[1] ? 'need' : ''}`}>
              <div className="gf-step"><span className={stepDone[1] ? 'ok' : ''}>{stepDone[1] ? '✓' : '2'}</span>{tr('step2', lang)}</div>
              <textarea rows={3} value={f.description} placeholder={tr('describeHint', lang)} onChange={(e) => setF({ ...f, description: e.target.value })} />
              {descLeft > 0 && f.description.length > 0 && <div className="gf-hint">{descLeft} {tr('moreChars', lang)}</div>}
              <div className="gf-photos">
                {photos.map((p) => <span key={p.id} className="gf-photo"><img src={p.url} alt="" /><button aria-label="Remove" onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))}>×</button></span>)}
                {photos.length < 3 && (
                  <label className="gf-photo add">
                    <Pic d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
                    <span>{uploading ? '…' : tr('photo', lang)}</span><small>{tr('photoHint', lang)}</small>
                    <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; void addPhoto(file); }} />
                  </label>
                )}
              </div>
              <button className={`gf-loc ${f.share ? 'on' : ''}`} onClick={() => setF({ ...f, share: !f.share })} aria-pressed={f.share}>
                <Pic d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" size={22} />
                <span><b>{f.share ? (gps ? tr('locationOn', lang) : tr('locationWait', lang)) : tr('location', lang)}</b><small>{tr('locationHint', lang)}</small></span>
                <i className="gf-switch" />
              </button>
            </section>

            <section className={`gf-card ${tried && !stepDone[2] ? 'need' : ''}`}>
              <div className="gf-step"><span className={stepDone[2] ? 'ok' : ''}>{stepDone[2] ? '✓' : '3'}</span>{tr('step3', lang)}</div>
              <label className="gf-field">{tr('name', lang)}<input value={f.name} autoComplete="name" onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
              <label className="gf-field">{tr('mobile', lang)}
                <span className="gf-tel"><em>+91</em><input value={f.mobile} inputMode="numeric" autoComplete="tel-national" maxLength={14} placeholder="98xxxxxx10" onChange={(e) => setF({ ...f, mobile: e.target.value })} /></span>
              </label>
              <label className="gf-field">{tr('house', lang)}<input value={f.house_no} onChange={(e) => setF({ ...f, house_no: e.target.value })} /></label>
              <label className="gf-consent"><input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} /><span>{tr('consent', lang)}</span></label>
            </section>

            {err && <p className="gf-error">{err}</p>}
            {tried && missing.length > 0 && <p className="gf-missing">{tr('needed', lang)}: {missing.join(', ')}</p>}
            <div className="gf-send">
              <button className="gf-btn primary" disabled={busy} onClick={send}>{busy ? tr('sending', lang) : tr('submit', lang)}</button>
            </div>
            <a className="gf-link" href="/g/status">{tr('check', lang)}</a>
          </>
        )}
      </main>
    </div>
  );
}

export function PublicStatus() {
  const [lang, setLang] = useState<Lang>(navigator.language.startsWith('te') ? 'te' : 'en');
  const [n, setN] = useState(new URLSearchParams(location.search).get('n') ?? '');
  const [m, setM] = useState('');
  const [r, setR] = useState<{ number: string; category: Cat; status: { key: string; en: string; te: string }; received: string; due_date: string; updates: { at: string; note: string }[] } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const show = async () => {
    setErr('');
    setR(null);
    setBusy(true);
    try {
      setR(await call(`/api/public/grievances/${encodeURIComponent(n.trim().toUpperCase())}?mobile=${encodeURIComponent(m)}`));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const fmt = (s: string) => new Date(s).toLocaleString(lang === 'te' ? 'te-IN' : 'en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  const stage = r ? (r.status.key === 'new' ? 0 : r.status.key === 'assigned' ? 1 : 2) : 0;
  return (
    <div className="gf">
      <Header lang={lang} setLang={setLang} />
      <main className="gf-main">
        <div className="gf-intro"><h1>{tr('statusTitle', lang)}</h1></div>
        <section className="gf-card">
          <label className="gf-field">{tr('numberField', lang)}<input value={n} placeholder="G-000123" onChange={(e) => setN(e.target.value)} /></label>
          <label className="gf-field">{tr('mobile', lang)}<span className="gf-tel"><em>+91</em><input value={m} inputMode="numeric" maxLength={14} onChange={(e) => setM(e.target.value)} /></span></label>
          <button className="gf-btn primary" disabled={busy || !n || m.replace(/\D/g, '').length < 10} onClick={show}>{busy ? '…' : tr('show', lang)}</button>
          {err && <p className="gf-error">{err}</p>}
        </section>
        {r && (
          <section className="gf-card">
            <div className="gf-num small"><span>{r.number}</span></div>
            <div className="gf-cat-line"><Pic d={CAT_ICON[r.category.key] ?? CAT_ICON.other} size={22} /> <b>{r.category[lang]}</b></div>
            {r.status.key === 'rejected' ? <p className="gf-closed">{r.status[lang]}</p> : (
              <ol className="gf-track">
                {[tr('sReceived', lang), tr('sAttended', lang), tr('sResolved', lang)].map((l, i) => <li key={l} className={i <= stage ? 'done' : ''}><span>{i < stage || stage === 2 ? '✓' : i + 1}</span>{l}</li>)}
              </ol>
            )}
            <p className="gf-muted">{tr('received', lang)}: {fmt(r.received)} · {tr('due', lang)}: {r.due_date}</p>
            {r.updates.length > 0 && (
              <div className="gf-updates"><b>{tr('updates', lang)}</b>
                {r.updates.map((u, i) => <div key={i}><span className="gf-muted">{fmt(u.at)}</span><p>{u.note}</p></div>)}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
