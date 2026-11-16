/** Printable A4 board for a work stretch, with its QR code for citizens' complaints. */
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Modal } from './Modal.tsx';
import type { Card } from './StretchCard.tsx';

export function QrBoard({ card, onClose }: { card: Card; onClose: () => void }) {
  const s = card.stretch;
  const [qr, setQr] = useState<{ url: string; svg: string } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<{ url: string; svg: string }>(`/api/stretches/${s.code}/qr`).then(setQr).catch((e) => setErr((e as Error).message));
  }, [s.code]);
  const local = qr && /\/\/(localhost|127\.0\.0\.1)/.test(qr.url);
  return (
    <Modal title={`QR board · ${s.code}`} onClose={onClose} size="medium"
      footer={<><span className="grow" /><button className="btn" onClick={onClose}>Close</button><button className="btn primary" disabled={!qr} onClick={() => window.print()}>Print board</button></>}>
      {err && <p className="error">{err}</p>}
      {local && <p className="note">This link works only on this computer until the app is put on the internet. Print the final boards after that.</p>}
      <div className="qr-board" id="qr-board">
        <div className="qb-head">
          <div className="qb-org">Greater Warangal Municipal Corporation</div>
          <div className="qb-org te">గ్రేటర్ వరంగల్ మున్సిపల్ కార్పొరేషన్</div>
          <div className="qb-title">Underground Drainage Work · భూగర్భ డ్రైనేజీ పని</div>
        </div>
        <div className="qb-work"><b>{s.code}</b> {s.road_name}<br />Ward {s.ward} · {s.admin_zone} · {Math.round(s.length_m)} m</div>
        <div className="qb-qr" dangerouslySetInnerHTML={{ __html: qr?.svg ?? '' }} />
        <div className="qb-call">
          <b>Problem at this work? Scan to tell us.</b>
          <b className="te">ఈ పనిలో సమస్య ఉందా? స్కాన్ చేసి తెలియజేయండి.</b>
        </div>
        <div className="qb-url">{qr?.url}</div>
        <div className="qb-foot">Open trench · water cut · drain blocked · dust · debris · any other problem<br />Your complaint number lets you check progress.</div>
      </div>
    </Modal>
  );
}
