/** The app's pop-up: white box, title and × at the top, buttons at the bottom. */
import type { ReactNode } from 'react';

export function Modal({ title, onClose, children, footer, size = 'medium' }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'small' | 'medium' | 'large';
}) {
  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className={`modal-box ${size}`}>
        <header className="modal-head">
          <strong>{title}</strong>
          <button className="x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}
