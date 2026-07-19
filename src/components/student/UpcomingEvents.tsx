/**
 * Upcoming events (Spec §6.6, Phase 9): the next program dates, read-only.
 * Weekly repeats are expanded into real dates client-side; nothing upcoming
 * renders nothing — the card only speaks when there's something to say.
 */
import { useEffect, useState } from 'react';
import { fetchVisibleEvents, upcomingOccurrences, type EventOccurrence } from '@/lib/calendar';
import { localDateIso } from '@/lib/dailyMessage';
import { useAuth } from '@/lib/authStore';
import { GatheringIcon } from '@/components/student/todayIcons';

const WINDOW_DAYS = 60;
const LIMIT = 5;

type ViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'empty' }
  | { status: 'ready'; occurrences: EventOccurrence[] };

/** "Fri, Jul 24" from a date-only ISO string, in the device locale. */
function friendlyDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function UpcomingEvents() {
  const session = useAuth();
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  // Bumping `attempt` re-runs the fetch effect — the retry mechanism.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (session === null) {
      return;
    }
    let cancelled = false;
    const today = localDateIso(new Date());
    fetchVisibleEvents(today)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          setState({ status: 'error' });
          return;
        }
        const occurrences = upcomingOccurrences(result.data, today, WINDOW_DAYS, LIMIT);
        setState(occurrences.length === 0 ? { status: 'empty' } : { status: 'ready', occurrences });
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
      <section className="events-card" aria-busy="true" aria-label="Upcoming events">
        <p className="daily-message-loading">Checking what’s coming up…</p>
      </section>
    );
  }

  if (state.status === 'error') {
    // Passive content, so no alert role — a quiet line and a retry suffice.
    return (
      <section className="events-card" aria-label="Upcoming events">
        <p className="daily-message-loading">
          Upcoming events couldn’t load. Check your connection and try again.
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

  const [next, ...rest] = state.occurrences;
  if (next === undefined) {
    return null;
  }
  return (
    <section className="today-tile-row" aria-label="Upcoming events">
      <span className="today-tile today-tile-dark" aria-hidden="true">
        <GatheringIcon />
      </span>
      <span className="today-tile-body">
        <h2 className="eyebrow eyebrow-rose">Coming up</h2>
        <span className="today-tile-text">{next.event.title}</span>
        <span className="today-tile-sub">
          {friendlyDate(next.date)}
          {next.event.eventTime !== null && (
            <>
              {' · '}
              {next.event.eventTime}
              {next.event.endTime !== null ? `–${next.event.endTime}` : ''}
            </>
          )}
        </span>
        {next.event.description !== null && (
          <span className="today-tile-sub">{next.event.description}</span>
        )}
        {rest.length > 0 && (
          <ul className="events-more">
            {rest.map(({ event, date }) => (
              <li key={`${event.id}-${date}`}>
                {friendlyDate(date)}
                {event.eventTime !== null ? ` · ${event.eventTime}` : ''} — {event.title}
              </li>
            ))}
          </ul>
        )}
      </span>
    </section>
  );
}
