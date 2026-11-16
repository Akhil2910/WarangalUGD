/**
 * Citizens' pages (no account): the complaint form opened by a work stretch's QR code (/g/<token>)
 * and the status check (/g/status). English and Telugu.
 */
import { useEffect, useState } from 'react';
import { CSRF_HEADER } from 'shared';

type Lang = 'en' | 'te';
interface Cat { key: string; en: string; te: string }
interface Work { code: string; name: string; ward: number; zone: string; stage: string; categories: Cat[]; due_days: number }

const T = {
  title: { en: 'Report a problem at this road work', te: 'ఈ రోడ్డు పనిలో సమస్యను తెలియజేయండి' },
  sub: { en: 'Greater Warangal Municipal Corporation · Underground Drainage works', te: 'గ్రేటర్ వరంగల్ మున్సిపల్ కార్పొరేషన్ · భూగర్భ డ్రైనేజీ పనులు' },
  work: { en: 'Work', te: 'పని' },
  ward: { en: 'Ward', te: 'వార్డు' },
  problem: { en: 'What is the problem?', te: 'సమస్య ఏమిటి?' },
  describe: { en: 'Describe the problem', te: 'సమస్యను వివరించండి' },
  describeHint: { en: 'Where exactly, since when, how serious…', te: 'ఎక్కడ, ఎప్పటి నుంచి, ఎంత తీవ్రంగా…' },
  photos: { en: 'Photos (optional, up to 3)', te: 'ఫోటోలు (ఐచ్ఛికం, 3 వరకు)' },
  addPhoto: { en: '+ Photo', te: '+ ఫోటో' },
  name: { en: 'Your name', te: 'మీ పేరు' },
  mobile: { en: 'Mobile number (10 digits)', te: 'మొబైల్ నంబర్ (10 అంకెలు)' },
  house: { en: 'House / door number (optional)', te: 'ఇంటి / డోర్ నంబర్ (ఐచ్ఛికం)' },
  location: { en: 'Share my location (helps us find the place)', te: 'నా లొకేషన్ పంపండి (స్థలాన్ని కనుగొనడానికి సహాయపడుతుంది)' },
  consent: { en: 'I agree that GWMC may use my name, mobile number and photos only to resolve this complaint.', te: 'ఈ ఫిర్యాదు పరిష్కారానికి మాత్రమే నా పేరు, మొబైల్ నంబర్, ఫోటోలను GWMC ఉపయోగించుకోవచ్చని నేను అంగీకరిస్తున్నాను.' },
  submit: { en: 'Submit complaint', te: 'ఫిర్యాదు పంపండి' },
  sending: { en: 'Sending…', te: 'పంపుతోంది…' },
  thanks: { en: 'Thank you. Your complaint is registered.', te: 'ధన్యవాదాలు. మీ ఫిర్యాదు నమోదైంది.' },
  number: { en: 'Your complaint number', te: 'మీ ఫిర్యాదు నంబర్' },
  keep: { en: 'Please note this number. The officer will act within', te: 'ఈ నంబర్‌ను గుర్తుంచుకోండి. అధికారి లోపు చర్య తీసుకుంటారు:' },
  days: { en: 'days', te: 'రోజులు' },
  check: { en: 'Check the status of a complaint', te: 'ఫిర్యాదు స్థితిని చూడండి' },
  another: { en: 'Report another problem', te: 'మరో సమస్యను తెలియజేయండి' },
  statusTitle: { en: 'Complaint status', te: 'ఫిర్యాదు స్థితి' },
  numberField: { en: 'Complaint number (e.g. G-000123)', te: 'ఫిర్యాదు నంబర్ (ఉదా. G-000123)' },
  show: { en: 'Show status', te: 'స్థితి చూపించు' },
  received: { en: 'Received', te: 'స్వీకరించిన తేదీ' },
  due: { en: 'Answer due by', te: 'పరిష్కార గడువు' },
  updates: { en: 'Updates', te: 'తాజా సమాచారం' },
};
const tr = (k: keyof typeof T, l: Lang) => T[k][l];

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

function LangSwitch({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="lang">
      <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
      <button className={lang === 'te' ? 'on' : ''} onClick={() => setLang('te')}>తెలుగు</button>
    </div>
  );
}

export function PublicGrievance({ token }: { token: string }) {
  const [lang, setLang] = useState<Lang>(navigator.language.startsWith('te') ? 'te' : 'en');
  const [w, setW] = useState<Work | null>(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ category: '', description: '', name: '', mobile: '', house_no: '', consent: false, share: false });
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [gps, setGps] = useState<{ lat: number; lon: number; accuracy_m: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ number: string; due_date: string } | null>(null);
  useEffect(() => {
    call<Work>(`/api/public/w/${encodeURIComponent(token)}`).then(setW).catch((e) => setErr((e as Error).message));
  }, [token]);
  useEffect(() => {
    if (!f.share || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => setGps({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy) }), () => setGps(null), { enableHighAccuracy: true, timeout: 15000 });
  }, [f.share]);
  if (err && !w) return <div className="pub"><div className="pub-card"><h1>{err}</h1></div></div>;
  if (!w) return <div className="pub"><div className="pub-card">…</div></div>;
  const send = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await call<{ number: string; due_date: string }>('/api/public/grievances', {
        token, category: f.category, description: f.description, name: f.name, mobile: f.mobile, house_no: f.house_no, consent: f.consent,
        language: lang, photos: photos.map((p) => p.id), gps: f.share ? gps : null,
      });
      setDone(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ready = f.category && f.description.trim().length >= 10 && f.name.trim().length >= 2 && /^\D*([6-9]\d{9})\D*$/.test(f.mobile.replace(/\s|^\+?91/g, '')) && f.consent;
  return (
    <div className="pub">
      <div className="pub-card">
        <div className="pub-top"><span className="logo">GWMC</span><LangSwitch lang={lang} setLang={setLang} /></div>
        {done ? (
          <div className="pub-done">
            <div className="tick">✓</div>
            <h1>{tr('thanks', lang)}</h1>
            <p>{tr('number', lang)}</p>
            <div className="big-number">{done.number}</div>
            <p className="muted">{tr('keep', lang)} {w.due_days} {tr('days', lang)}.</p>
            <a className="btn" href={`/g/status?n=${done.number}`}>{tr('check', lang)}</a>
            <button className="btn ghost" onClick={() => { setDone(null); setF({ ...f, category: '', description: '' }); setPhotos([]); }}>{tr('another', lang)}</button>
          </div>
        ) : (
          <>
            <h1>{tr('title', lang)}</h1>
            <p className="muted">{tr('sub', lang)}</p>
            <div className="pub-work"><b>{tr('work', lang)}: {w.code}</b> {w.name}<br /><span className="muted">{tr('ward', lang)} {w.ward} · {w.zone} · {w.stage}</span></div>
            <div className="field">{tr('problem', lang)}
              <div className="cat-grid">
                {w.categories.map((c) => (
                  <button key={c.key} className={f.category === c.key ? 'on' : ''} onClick={() => setF({ ...f, category: c.key })}>{c[lang]}</button>
                ))}
              </div>
            </div>
            <label className="field">{tr('describe', lang)}
              <textarea rows={4} value={f.description} placeholder={tr('describeHint', lang)} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </label>
            <div className="field">{tr('photos', lang)}
              <div className="photo-tiles">
                {photos.map((p) => <span key={p.id} className="photo-tile"><img src={p.url} alt="" /><button onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))}>×</button></span>)}
                {photos.length < 3 && (
                  <label className="photo-tile add">{tr('addPhoto', lang)}
                    <input type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      try {
                        const data = await shrink(file);
                        const r = await call<{ id: string }>('/api/public/photos', { token, name: file.name, mime: 'image/jpeg', data });
                        setPhotos((x) => [...x, { id: r.id, url: URL.createObjectURL(file) }]);
                      } catch (x) {
                        setErr((x as Error).message);
                      }
                    }} />
                  </label>
                )}
              </div>
            </div>
            <label className="field">{tr('name', lang)}<input value={f.name} autoComplete="name" onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="field">{tr('mobile', lang)}<input value={f.mobile} inputMode="tel" autoComplete="tel" onChange={(e) => setF({ ...f, mobile: e.target.value })} /></label>
            <label className="field">{tr('house', lang)}<input value={f.house_no} onChange={(e) => setF({ ...f, house_no: e.target.value })} /></label>
            <label className="check-row"><input type="checkbox" checked={f.share} onChange={(e) => setF({ ...f, share: e.target.checked })} /> {tr('location', lang)}{f.share && gps ? ' ✓' : ''}</label>
            <label className="check-row"><input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} /> {tr('consent', lang)}</label>
            {err && <p className="error">{err}</p>}
            <button className="btn primary big" disabled={!ready || busy} onClick={send}>{busy ? tr('sending', lang) : tr('submit', lang)}</button>
            <a className="pub-link" href="/g/status">{tr('check', lang)}</a>
          </>
        )}
      </div>
    </div>
  );
}

export function PublicStatus() {
  const [lang, setLang] = useState<Lang>(navigator.language.startsWith('te') ? 'te' : 'en');
  const [n, setN] = useState(new URLSearchParams(location.search).get('n') ?? '');
  const [m, setM] = useState('');
  const [r, setR] = useState<{ number: string; category: Cat; status: { key: string; en: string; te: string }; received: string; due_date: string; updates: { at: string; note: string }[] } | null>(null);
  const [err, setErr] = useState('');
  const show = async () => {
    setErr('');
    setR(null);
    try {
      setR(await call(`/api/public/grievances/${encodeURIComponent(n.trim().toUpperCase())}?mobile=${encodeURIComponent(m)}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const fmt = (s: string) => new Date(s).toLocaleString(lang === 'te' ? 'te-IN' : 'en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="pub">
      <div className="pub-card">
        <div className="pub-top"><span className="logo">GWMC</span><LangSwitch lang={lang} setLang={setLang} /></div>
        <h1>{tr('statusTitle', lang)}</h1>
        <label className="field">{tr('numberField', lang)}<input value={n} onChange={(e) => setN(e.target.value)} /></label>
        <label className="field">{tr('mobile', lang)}<input value={m} inputMode="tel" onChange={(e) => setM(e.target.value)} /></label>
        <button className="btn primary big" disabled={!n || m.replace(/\D/g, '').length < 10} onClick={show}>{tr('show', lang)}</button>
        {err && <p className="error">{err}</p>}
        {r && (
          <div className="pub-status">
            <div className="big-number">{r.number}</div>
            <p><b>{r.category[lang]}</b></p>
            <p className={`status-pill s-${r.status.key}`}>{r.status[lang]}</p>
            <p className="muted">{tr('received', lang)}: {fmt(r.received)} · {tr('due', lang)}: {r.due_date}</p>
            {r.updates.length > 0 && <><h3>{tr('updates', lang)}</h3><ul>{r.updates.map((u, i) => <li key={i}><span className="muted">{fmt(u.at)}</span> — {u.note}</li>)}</ul></>}
          </div>
        )}
      </div>
    </div>
  );
}
