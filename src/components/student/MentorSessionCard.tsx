/**
 * "Time with a mentor" (SXU "Your people"): she proposes up to three
 * windows that work for her; a real person confirms the real time. The
 * confirmed session lives here with an Add-to-calendar that keeps the
 * title generic — her device calendar learns nothing about the program.
 */
import { useEffect, useRef, useState } from 'react';
import {
  createSessionRequest,
  fetchSessionRequests,
  isSessionSlot,
  SESSION_SLOT_LABELS,
  SESSION_SLOTS,
  type SessionRequest,
  type SessionSlot,
  type SessionWindow,
} from '@/lib/mentorSessions';
import { buildIcs } from '@/lib/ics';
import { localDateIso } from '@/lib/dailyMessage';
import { useAuth } from '@/lib/authStore';
import { SparkleIcon } from '@/components/student/moodIcons';

const MAX_WINDOWS = 3;
const HORIZON_DAYS = 60;

type ViewState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; requests: SessionRequest[] };

type DraftWindow = { id: number; date: string; slot: SessionSlot };

/** "Fri, Jul 24" from a date-only ISO string, in the device locale. */
function friendlyDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** YYYY-MM-DD `days` after today in her local calendar. */
function localDaysAhead(days: number): string {
  const base = new Date(`${localDateIso(new Date())}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function downloadIcs(session: SessionRequest): void {
  if (session.scheduledDate === null || session.scheduledTime === null) {
    return;
  }
  const ics = buildIcs({
    uid: `${session.id}@mentor-session`,
    // Generic on purpose — her calendar, her privacy.
    title: 'Mentor time',
    date: session.scheduledDate,
    startTime: session.scheduledTime,
    endTime: session.endTime,
    now: new Date(),
  });
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mentor-time.ics';
  link.click();
  URL.revokeObjectURL(url);
}

export function MentorSessionCard() {
  const session = useAuth();
  const token = session?.token;
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [drafts, setDrafts] = useState<DraftWindow[]>([{ id: 0, date: '', slot: 'after_school' }]);
  // Stable keys for draft rows — never the array index (CLAUDE.md §4.4).
  const nextDraftId = useRef(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    void fetchSessionRequests(token).then((result) => {
      if (cancelled) {
        return;
      }
      setState(result.ok ? { status: 'ready', requests: result.data } : { status: 'error' });
    });
    return () => {
      cancelled = true;
    };
  }, [token, reload]);

  if (token === undefined) {
    return null;
  }

  const today = localDateIso(new Date());
  const requests = state.status === 'ready' ? state.requests : [];
  const open = requests.find((r) => r.status === 'pending');
  const upcoming = requests.find(
    (r) => r.status === 'confirmed' && r.scheduledDate !== null && r.scheduledDate >= today,
  );
  const lastDeclined = open === undefined && upcoming === undefined ? requests[0] : undefined;

  const submit = (): void => {
    const windows: SessionWindow[] = drafts
      .filter((d) => d.date !== '')
      .map((d) => ({ date: d.date, slot: d.slot }));
    if (windows.length === 0) {
      return;
    }
    setBusy(true);
    setNotice('');
    void createSessionRequest(token, windows)
      .then((result) => {
        if (result.ok) {
          setNotice('Request sent. A real person will confirm your time. 💛');
          setDrafts([{ id: nextDraftId.current++, date: '', slot: 'after_school' }]);
          setState({ status: 'loading' });
          setReload((n) => n + 1);
        } else if (result.failure.kind === 'rate_limited') {
          setNotice('That’s a lot of asks at once — give it a little while and try again.');
        } else if (result.failure.kind === 'denied' && result.failure.code === 'request_open') {
          setNotice('You already have a request in — your team is on it.');
          setState({ status: 'loading' });
          setReload((n) => n + 1);
        } else {
          setNotice('That didn’t go through. Check your connection and try again.');
        }
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section className="goals-card connect-card" aria-label="Time with a mentor">
      <SparkleIcon className="goals-card-crown" />
      <h2 className="goals-card-heading">Time with a mentor</h2>

      {state.status === 'loading' && <p className="daily-message-loading">One moment…</p>}
      {state.status === 'error' && (
        // Quiet: the card is ambient — it comes back with the next visit.
        <p className="daily-message-loading">
          This card can&rsquo;t load right now. Your requests are safe.
        </p>
      )}

      {notice !== '' && (
        <p className="connect-card-notice" role="status">
          {notice}
        </p>
      )}

      {state.status === 'ready' && open !== undefined && (
        <>
          <p className="eyebrow eyebrow-gold">Request sent</p>
          <p className="goals-card-goal">A real person is finding your time.</p>
          <hr className="goals-card-rule" />
          <p className="eyebrow eyebrow-gold">Times you offered</p>
          {open.preferredWindows.map((w) => (
            <p key={`${w.date}-${w.slot}`} className="goals-card-also">
              {friendlyDate(w.date)} · {SESSION_SLOT_LABELS[w.slot]}
            </p>
          ))}
        </>
      )}

      {state.status === 'ready' && open === undefined && upcoming !== undefined && (
        <>
          <p className="eyebrow eyebrow-gold">It&rsquo;s on the calendar</p>
          <p className="goals-card-goal">
            {friendlyDate(upcoming.scheduledDate ?? '')}
            {upcoming.scheduledTime !== null && (
              <>
                {' · '}
                {upcoming.scheduledTime}
                {upcoming.endTime !== null ? `–${upcoming.endTime}` : ''}
              </>
            )}
          </p>
          <button
            type="button"
            className="goals-card-button connect-card-button"
            onClick={() => {
              downloadIcs(upcoming);
            }}
          >
            <span>Add to my calendar</span>
            <span aria-hidden="true">›</span>
          </button>
        </>
      )}

      {state.status === 'ready' && open === undefined && upcoming === undefined && (
        <>
          {lastDeclined?.status === 'declined' && (
            <p className="door-sub">
              Last time didn&rsquo;t work out — your team will find you. You can always ask again.
            </p>
          )}
          <p className="door-sub">
            Want some one-on-one time? Offer up to three times that work for you, and a real person
            will confirm one.
          </p>
          {drafts.map((draft) => (
            <div className="calendar-editor-row" key={draft.id}>
              <label className="crown-check-note">
                <span className="crown-check-note-label">Day</span>
                <input
                  type="date"
                  value={draft.date}
                  min={today}
                  max={localDaysAhead(HORIZON_DAYS)}
                  disabled={busy}
                  onChange={(e) => {
                    setDrafts(
                      drafts.map((d) => (d.id === draft.id ? { ...d, date: e.target.value } : d)),
                    );
                  }}
                />
              </label>
              <label className="crown-check-note">
                <span className="crown-check-note-label">Time of day</span>
                <select
                  value={draft.slot}
                  disabled={busy}
                  onChange={(e) => {
                    const slot = e.target.value;
                    if (isSessionSlot(slot)) {
                      setDrafts(drafts.map((d) => (d.id === draft.id ? { ...d, slot } : d)));
                    }
                  }}
                >
                  {SESSION_SLOTS.map((slot) => (
                    <option key={slot} value={slot}>
                      {SESSION_SLOT_LABELS[slot]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
          <div className="admin-confirm-group">
            {drafts.length < MAX_WINDOWS && (
              <button
                type="button"
                className="logout-button"
                disabled={busy}
                onClick={() => {
                  setDrafts([
                    ...drafts,
                    { id: nextDraftId.current++, date: '', slot: 'after_school' },
                  ]);
                }}
              >
                Add another time
              </button>
            )}
            <button
              type="button"
              className="crown-check-submit"
              disabled={busy || drafts.every((d) => d.date === '')}
              onClick={submit}
            >
              Ask for time
            </button>
          </div>
        </>
      )}
    </section>
  );
}
