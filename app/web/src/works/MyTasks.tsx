/** "My tasks": what the signed-in person has to do now — submit, renew, verify, resolve. */
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Modal } from './Modal.tsx';
import { fmtDate } from './util.tsx';
import { Icon } from '../ui.tsx';

export interface Task { kind: string; tone: 'bad' | 'due' | 'wait'; title: string; detail: string; due: string | null; link: Record<string, string> }

export function useMyTasks(refreshKey: number) {
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => {
    const load = () => api<{ tasks: Task[] }>('/api/my-tasks').then((r) => setTasks(r.tasks)).catch(() => {});
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [refreshKey]);
  return tasks;
}

export function MyTasksButton({ tasks, onOpen }: { tasks: Task[]; onOpen: () => void }) {
  const urgent = tasks.filter((t) => t.tone === 'bad').length;
  return (
    <button className={`btn tasks-btn ${urgent ? 'urgent' : ''}`} onClick={onOpen} title="What you need to do">
      <Icon name="bell" /><span className="tasks-label">My tasks</span>{tasks.length > 0 && <span className="tasks-count">{tasks.length}</span>}
    </button>
  );
}

/** The Today hub: everything waiting for this person, grouped, each opening the exact place to act. */
export function TodayPage({ tasks, name, onGo }: { tasks: Task[]; name: string; onGo: (t: Task) => void }) {
  const groups: [Task['tone'], string, string][] = [['bad', 'Overdue, rejected or expiring', 'Act on these first'], ['wait', 'Waiting for you to verify', 'Others are waiting on you'], ['due', 'Coming up', 'Due soon']];
  const hour = new Date().getHours();
  return (
    <div className="page dash today-page">
      <div className="dash-hero">
        <div className="dash-hero-text">
          <span className="dash-kicker">Today</span>
          <h2>{hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, {name.replace(/^trial\s+/i, '')}</h2>
          <span className="dash-asof">{tasks.length ? `${tasks.length} thing${tasks.length === 1 ? '' : 's'} need${tasks.length === 1 ? 's' : ''} your attention.` : 'Nothing is waiting for you. Everything is up to date.'}</span>
        </div>
      </div>
      {!tasks.length && <section className="dsec"><div className="all-good">All clear. New tasks appear here as soon as they arrive.</div></section>}
      <div className="today-cols">
        {groups.map(([tone, label, sub]) => {
          const list = tasks.filter((t) => t.tone === tone);
          if (!list.length) return null;
          return (
            <section key={tone} className="dsec task-group">
              <div className={`task-head ${tone}`}>{label} · {list.length}<span className="muted small"> — {sub}</span></div>
              {list.map((t, i) => (
                <button key={i} className="task-row" onClick={() => onGo(t)}>
                  <span className={`dotk ${tone === 'bad' ? 'bad' : tone === 'wait' ? 'wait' : 'due'}`} />
                  <span className="grow"><b>{t.title}</b><span className="muted small">{t.detail}{t.due && !t.detail.includes('due') ? ` · due ${fmtDate(t.due)}` : ''}</span></span>
                  <span className="muted">›</span>
                </button>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function MyTasksModal({ tasks, onClose, onGo }: { tasks: Task[]; onClose: () => void; onGo: (t: Task) => void }) {
  const groups: [Task['tone'], string][] = [['bad', 'Overdue, rejected or expiring'], ['wait', 'Waiting for you to verify'], ['due', 'Coming up']];
  return (
    <Modal title={`My tasks (${tasks.length})`} onClose={onClose} size="medium">
      {!tasks.length && <div className="all-good">Nothing waiting for you. Everything is up to date.</div>}
      {groups.map(([tone, label]) => {
        const list = tasks.filter((t) => t.tone === tone);
        if (!list.length) return null;
        return (
          <section key={tone} className="task-group">
            <div className={`task-head ${tone}`}>{label} · {list.length}</div>
            {list.map((t, i) => (
              <button key={i} className="task-row" onClick={() => onGo(t)}>
                <span className={`dotk ${tone === 'bad' ? 'bad' : tone === 'wait' ? 'wait' : 'due'}`} />
                <span className="grow"><b>{t.title}</b><span className="muted small">{t.detail}{t.due && !t.detail.includes('due') ? ` · due ${fmtDate(t.due)}` : ''}</span></span>
                <span className="muted">›</span>
              </button>
            ))}
          </section>
        );
      })}
    </Modal>
  );
}
