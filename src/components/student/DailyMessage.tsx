/**
 * Daily Crown Message (Spec §6.5 step 7): today's admin-approved
 * encouragement, shown to every signed-in student. Read-only and passive —
 * no message posted for today simply renders nothing.
 */
import { useEffect, useState } from 'react';
import { fetchDailyMessage, localDateIso, type DailyMessage as Message } from '@/lib/dailyMessage';
import { useAuth } from '@/lib/authStore';

type ViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'empty' }
  | { status: 'ready'; message: Message };

export function DailyMessage() {
  const session = useAuth();
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  // Bumping `attempt` re-runs the fetch effect — the retry mechanism.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (session === null) {
      return;
    }
    let cancelled = false;
    fetchDailyMessage(localDateIso(new Date()))
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          setState({ status: 'error' });
          return;
        }
        setState(
          result.data === null ? { status: 'empty' } : { status: 'ready', message: result.data },
        );
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
  }, [session, attempt]);

  if (session === null || state.status === 'empty') {
    return null;
  }

  if (state.status === 'loading') {
    return (
      <section className="daily-message-card" aria-busy="true" aria-label="Daily Crown Message">
        <p className="daily-message-loading">Polishing today’s Crown Message…</p>
      </section>
    );
  }

  if (state.status === 'error') {
    // Passive content, so no alert role — a quiet line and a retry suffice.
    return (
      <section className="daily-message-card" aria-label="Daily Crown Message">
        <p className="daily-message-loading">
          Today’s Crown Message couldn’t load. Check your connection and try again.
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
    <section className="daily-message-card" aria-label="Daily Crown Message">
      <h2 className="daily-message-title">
        <span aria-hidden="true">👑</span> Today’s Crown Message
      </h2>
      <blockquote className="daily-message-text">{state.message.text}</blockquote>
    </section>
  );
}
