/**
 * Announcements feed (Spec §6.7, Phase 9): program news, newest first,
 * urgent ones visually emphasized. Viewing the feed records read receipts
 * through the server — best-effort: a failed receipt never disturbs the
 * reading experience, it's logged and retried on the next visit.
 */
import { useEffect, useState } from 'react';
import { fetchAnnouncements, markAnnouncementsRead, type Announcement } from '@/lib/announcements';
import { logger } from '@/lib/logger';
import { useAuth } from '@/lib/authStore';

const FEED_LIMIT = 10;

type ViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'empty' }
  | { status: 'ready'; announcements: Announcement[] };

function friendlyDate(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function Announcements() {
  const session = useAuth();
  const token = session?.token;
  const isStudent = session?.subject.type === 'student';

  const [state, setState] = useState<ViewState>({ status: 'loading' });
  // Bumping `attempt` re-runs the fetch effect — the retry mechanism.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    fetchAnnouncements(FEED_LIMIT)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          setState({ status: 'error' });
          return;
        }
        if (result.data.length === 0) {
          setState({ status: 'empty' });
          return;
        }
        setState({ status: 'ready', announcements: result.data });
        if (isStudent) {
          // Receipts are best-effort; the server enforces idempotency.
          void markAnnouncementsRead(
            token,
            result.data.map((a) => a.id),
          ).then((marked) => {
            if (!marked.ok) {
              logger.warn('announcements.mark_read_failed', { kind: marked.failure.kind });
            }
          });
        }
      })
      .catch(() => {
        // The client never rejects (typed result); a broken contract must
        // still land in the visible error state, not vanish.
        if (!cancelled) {
          setState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, isStudent, attempt]);

  if (token === undefined || state.status === 'empty') {
    return null;
  }

  if (state.status === 'loading') {
    return (
      <section className="announcements-card" aria-busy="true" aria-label="Announcements">
        <p className="daily-message-loading">Gathering the latest news…</p>
      </section>
    );
  }

  if (state.status === 'error') {
    // Passive content, so no alert role — a quiet line and a retry suffice.
    return (
      <section className="announcements-card" aria-label="Announcements">
        <p className="daily-message-loading">
          Announcements couldn’t load. Check your connection and try again.
        </p>
        <button
          type="button"
          className="daily-message-retry"
          onClick={() => {
            setState({ status: 'loading' });
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </button>
      </section>
    );
  }

  return (
    <section className="announcements-card" aria-label="Announcements">
      <h2 className="events-title">Announcements</h2>
      {state.announcements.map((a) => (
        <article
          key={a.id}
          className={
            a.priority === 'urgent'
              ? 'announcement-item announcement-item-urgent'
              : 'announcement-item'
          }
        >
          <p className="announcement-meta">
            {friendlyDate(a.createdAt)}
            {a.priority === 'urgent' && <span className="announcement-urgent-tag"> Urgent</span>}
          </p>
          <h3 className="announcement-title">{a.title}</h3>
          <p className="announcement-body">{a.body}</p>
        </article>
      ))}
    </section>
  );
}
