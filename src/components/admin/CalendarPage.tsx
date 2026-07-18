/**
 * Calendar section (Phase 9, Spec §6.6 / §6.10): add/edit/delete program
 * events. Repeats are the weekly subset only — a "repeats weekly" switch
 * with an optional end date; every event is visible to all students (no
 * group model yet).
 */
import { useEffect, useState } from 'react';
import {
  createEvent,
  deleteEvent,
  listEvents,
  updateEvent,
  type AdminCalendarEvent,
  type EventInput,
} from '@/lib/adminCalendar';
import { useAuth } from '@/lib/authStore';

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; events: AdminCalendarEvent[]; total: number };

type Draft = {
  title: string;
  description: string;
  eventDate: string;
  eventTime: string;
  endTime: string;
  repeatsWeekly: boolean;
  repeatUntil: string;
};

const EMPTY_DRAFT: Draft = {
  title: '',
  description: '',
  eventDate: '',
  eventTime: '',
  endTime: '',
  repeatsWeekly: false,
  repeatUntil: '',
};

function draftFrom(event: AdminCalendarEvent): Draft {
  const until = /UNTIL=(\d{8})/.exec(event.recurrenceRule ?? '')?.[1];
  return {
    title: event.title,
    description: event.description ?? '',
    eventDate: event.eventDate,
    eventTime: event.eventTime ?? '',
    endTime: event.endTime ?? '',
    repeatsWeekly: event.repeatsWeekly,
    repeatUntil:
      until === undefined ? '' : `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`,
  };
}

function inputFrom(draft: Draft): EventInput {
  return {
    title: draft.title.trim(),
    description: draft.description.trim() === '' ? null : draft.description.trim(),
    eventDate: draft.eventDate,
    eventTime: draft.eventTime === '' ? null : draft.eventTime,
    endTime: draft.endTime === '' ? null : draft.endTime,
    repeatsWeekly: draft.repeatsWeekly,
    repeatUntil: draft.repeatsWeekly && draft.repeatUntil !== '' ? draft.repeatUntil : null,
  };
}

function draftValid(draft: Draft): boolean {
  if (draft.title.trim() === '' || draft.eventDate === '') {
    return false;
  }
  if (draft.endTime !== '' && (draft.eventTime === '' || draft.endTime <= draft.eventTime)) {
    return false;
  }
  if (draft.repeatsWeekly && draft.repeatUntil !== '' && draft.repeatUntil < draft.eventDate) {
    return false;
  }
  return true;
}

export function CalendarPage() {
  const session = useAuth();
  const token = session?.token;

  const [list, setList] = useState<ListState>({ status: 'loading' });
  // 'new', an event id, or null when the form is closed.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    void listEvents(token, 1).then((result) => {
      if (cancelled) {
        return;
      }
      setList(
        result.ok
          ? { status: 'ready', events: result.data.events, total: result.data.total }
          : { status: 'error' },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [token, reload]);

  if (token === undefined) {
    return null;
  }

  const refresh = (): void => {
    setList({ status: 'loading' });
    setEditing(null);
    setConfirmDeleteId(null);
    setReload((n) => n + 1);
  };

  const run = (work: Promise<{ ok: boolean }>, successNotice: string): void => {
    setBusy(true);
    setNotice('');
    void work
      .then((result) => {
        if (result.ok) {
          setNotice(successNotice);
          refresh();
        } else {
          setNotice('That didn’t go through. Try again.');
        }
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-section-title">Calendar</h2>
        <button
          type="button"
          className="admin-retry-button"
          disabled={busy || editing === 'new'}
          onClick={() => {
            setEditing('new');
            setDraft(EMPTY_DRAFT);
            setNotice('');
          }}
        >
          Add event
        </button>
      </div>

      <p className="admin-section-note">
        Events every student sees — program nights, meetups, special days. Repeating events run
        weekly until their end date (or until you delete them).
      </p>

      {notice !== '' && (
        <p className="admin-section-note" role="status">
          {notice}
        </p>
      )}

      {editing !== null && (
        <div className="calendar-editor">
          <label className="crown-check-note">
            <span className="crown-check-note-label">Title</span>
            <input
              type="text"
              value={draft.title}
              maxLength={120}
              onChange={(e) => {
                setField('title', e.target.value);
              }}
            />
          </label>
          <label className="crown-check-note">
            <span className="crown-check-note-label">Details (optional)</span>
            <textarea
              value={draft.description}
              maxLength={2000}
              rows={2}
              onChange={(e) => {
                setField('description', e.target.value);
              }}
            />
          </label>
          <div className="calendar-editor-row">
            <label className="crown-check-note">
              <span className="crown-check-note-label">Date</span>
              <input
                type="date"
                value={draft.eventDate}
                onChange={(e) => {
                  setField('eventDate', e.target.value);
                }}
              />
            </label>
            <label className="crown-check-note">
              <span className="crown-check-note-label">Starts (optional)</span>
              <input
                type="time"
                value={draft.eventTime}
                onChange={(e) => {
                  setField('eventTime', e.target.value);
                }}
              />
            </label>
            <label className="crown-check-note">
              <span className="crown-check-note-label">Ends (optional)</span>
              <input
                type="time"
                value={draft.endTime}
                onChange={(e) => {
                  setField('endTime', e.target.value);
                }}
              />
            </label>
          </div>
          <div className="calendar-editor-row">
            <label className="calendar-repeat-toggle">
              <input
                type="checkbox"
                checked={draft.repeatsWeekly}
                onChange={(e) => {
                  setField('repeatsWeekly', e.target.checked);
                }}
              />
              <span>Repeats weekly</span>
            </label>
            {draft.repeatsWeekly && (
              <label className="crown-check-note">
                <span className="crown-check-note-label">Until (optional)</span>
                <input
                  type="date"
                  value={draft.repeatUntil}
                  onChange={(e) => {
                    setField('repeatUntil', e.target.value);
                  }}
                />
              </label>
            )}
          </div>
          <div className="admin-confirm-group">
            <button
              type="button"
              className="admin-retry-button"
              disabled={busy || !draftValid(draft)}
              onClick={() => {
                const input = inputFrom(draft);
                if (editing === 'new') {
                  run(createEvent(token, input), 'Event added.');
                } else {
                  run(updateEvent(token, editing, input), 'Event updated.');
                }
              }}
            >
              {editing === 'new' ? 'Add to calendar' : 'Save changes'}
            </button>
            <button
              type="button"
              className="logout-button"
              disabled={busy}
              onClick={() => {
                setEditing(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {list.status === 'loading' && <p className="admin-section-note">Loading events…</p>}
      {list.status === 'error' && (
        <>
          <p className="admin-section-note" role="alert">
            Couldn&rsquo;t load the calendar. Check your connection and try again.
          </p>
          <button type="button" className="admin-retry-button" onClick={refresh}>
            Try again
          </button>
        </>
      )}

      {list.status === 'ready' && list.events.length === 0 && (
        <p className="admin-section-note">No upcoming events yet — add the first one above.</p>
      )}

      {list.status === 'ready' && list.events.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Time</th>
                <th scope="col">Event</th>
                <th scope="col">Repeats</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.events.map((event) => (
                <tr key={event.id}>
                  <td>{event.eventDate}</td>
                  <td>
                    {event.eventTime === null
                      ? 'All day'
                      : event.endTime === null
                        ? event.eventTime
                        : `${event.eventTime}–${event.endTime}`}
                  </td>
                  <td>
                    {event.title}
                    {event.description !== null && (
                      <span className="admin-table-sub"> — {event.description}</span>
                    )}
                  </td>
                  <td>{event.repeatsWeekly ? 'Weekly' : '—'}</td>
                  <td>
                    {confirmDeleteId === event.id ? (
                      <span className="admin-confirm-group">
                        <span className="admin-table-sub">Delete this event?</span>
                        <button
                          type="button"
                          className="admin-retry-button"
                          disabled={busy}
                          onClick={() => {
                            run(deleteEvent(token, event.id), 'Event deleted.');
                          }}
                        >
                          Yes, delete
                        </button>
                        <button
                          type="button"
                          className="logout-button"
                          disabled={busy}
                          onClick={() => {
                            setConfirmDeleteId(null);
                          }}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="admin-confirm-group">
                        <button
                          type="button"
                          className="logout-button"
                          disabled={busy}
                          onClick={() => {
                            setEditing(event.id);
                            setDraft(draftFrom(event));
                            setNotice('');
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="logout-button"
                          disabled={busy}
                          onClick={() => {
                            setConfirmDeleteId(event.id);
                          }}
                        >
                          Delete
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
