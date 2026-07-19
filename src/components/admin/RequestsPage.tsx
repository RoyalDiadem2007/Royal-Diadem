/**
 * Requests section — the staff queue behind the students' "Your people"
 * cards. 1:1 asks wait here for a real time; friend invites wait for a
 * human to reach out (the app never emails an invitee — the mailto link
 * opens YOUR mail, and marking it done scrubs the address).
 */
import { useEffect, useState } from 'react';
import {
  confirmSession,
  decideInvite,
  declineSession,
  fetchRequestsQueue,
  type RequestsQueue,
} from '@/lib/adminRequests';
import { SESSION_SLOT_LABELS } from '@/lib/mentorSessions';
import { useAuth } from '@/lib/authStore';

type ViewState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; queue: RequestsQueue };

type ConfirmDraft = { date: string; time: string; endTime: string };

export function RequestsPage() {
  const session = useAuth();
  const token = session?.token;

  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ConfirmDraft>({ date: '', time: '', endTime: '' });
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    void fetchRequestsQueue(token).then((result) => {
      if (cancelled) {
        return;
      }
      setState(result.ok ? { status: 'ready', queue: result.data } : { status: 'error' });
    });
    return () => {
      cancelled = true;
    };
  }, [token, reload]);

  if (token === undefined) {
    return null;
  }

  const refresh = (): void => {
    setState({ status: 'loading' });
    setConfirmId(null);
    setDraft({ date: '', time: '', endTime: '' });
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

  const queue = state.status === 'ready' ? state.queue : { sessions: [], invites: [] };
  const pendingSessions = queue.sessions.filter((s) => s.status === 'pending');
  const confirmedSessions = queue.sessions.filter((s) => s.status === 'confirmed');

  return (
    <section className="admin-section">
      <h2 className="admin-section-title">Requests</h2>
      <p className="admin-section-note">
        What the girls asked for: one-on-one time waiting for a real slot, and friends they want
        invited — the outreach is yours, personally; the app never contacts an invitee.
      </p>

      {notice !== '' && (
        <p className="admin-section-note" role="status">
          {notice}
        </p>
      )}

      {state.status === 'loading' && <p className="admin-section-note">Gathering the requests…</p>}
      {state.status === 'error' && (
        <>
          <p className="admin-section-note" role="alert">
            Couldn&rsquo;t load the requests. Check your connection and try again.
          </p>
          <button type="button" className="admin-retry-button" onClick={refresh}>
            Try again
          </button>
        </>
      )}

      {state.status === 'ready' && (
        <>
          <h3 className="admin-subsection-title">One-on-one time</h3>
          {pendingSessions.length === 0 && confirmedSessions.length === 0 && (
            <p className="admin-section-note">No session requests right now. 👑</p>
          )}
          {pendingSessions.map((request) => (
            <article key={request.id} className="announcement-item">
              <p className="admin-table-sub">
                <strong>{request.studentName}</strong> · asked {request.createdAt.slice(0, 10)}
              </p>
              <p className="announcement-body">
                Times she offered:{' '}
                {request.preferredWindows
                  .map((w) => `${w.date} (${SESSION_SLOT_LABELS[w.slot]})`)
                  .join(' · ')}
              </p>
              <div className="admin-confirm-group">
                {confirmId === request.id ? (
                  <>
                    <input
                      type="date"
                      value={draft.date}
                      aria-label="Session date"
                      disabled={busy}
                      onChange={(e) => {
                        setDraft({ ...draft, date: e.target.value });
                      }}
                    />
                    <input
                      type="time"
                      value={draft.time}
                      aria-label="Start time"
                      disabled={busy}
                      onChange={(e) => {
                        setDraft({ ...draft, time: e.target.value });
                      }}
                    />
                    <input
                      type="time"
                      value={draft.endTime}
                      aria-label="End time (optional)"
                      disabled={busy}
                      onChange={(e) => {
                        setDraft({ ...draft, endTime: e.target.value });
                      }}
                    />
                    <button
                      type="button"
                      className="admin-retry-button"
                      disabled={busy || draft.date === '' || draft.time === ''}
                      onClick={() => {
                        run(
                          confirmSession(token, request.id, {
                            date: draft.date,
                            time: draft.time,
                            endTime: draft.endTime === '' ? null : draft.endTime,
                          }),
                          'Session confirmed — it’s on her card now.',
                        );
                      }}
                    >
                      Confirm time
                    </button>
                    <button
                      type="button"
                      className="logout-button"
                      disabled={busy}
                      onClick={() => {
                        setConfirmId(null);
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="admin-retry-button"
                      disabled={busy}
                      onClick={() => {
                        setConfirmId(request.id);
                        setDraft({
                          date: request.preferredWindows[0]?.date ?? '',
                          time: '',
                          endTime: '',
                        });
                      }}
                    >
                      Pick the time
                    </button>
                    <button
                      type="button"
                      className="logout-button"
                      disabled={busy}
                      onClick={() => {
                        run(
                          declineSession(token, request.id),
                          'Declined — she’ll see it gently; do follow up with her.',
                        );
                      }}
                    >
                      Decline
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
          {confirmedSessions.length > 0 && (
            <>
              <p className="admin-table-sub">Coming up:</p>
              {confirmedSessions.map((request) => (
                <p key={request.id} className="admin-table-sub">
                  <strong>{request.studentName}</strong> · {request.scheduledDate}
                  {request.scheduledTime !== null && ` · ${request.scheduledTime}`}
                  {request.endTime !== null && `–${request.endTime}`}
                </p>
              ))}
            </>
          )}

          <h3 className="admin-subsection-title">Friend invites</h3>
          {queue.invites.length === 0 && (
            <p className="admin-section-note">No invites waiting. 👑</p>
          )}
          {queue.invites.map((invite) => (
            <article key={invite.id} className="announcement-item">
              <p className="admin-table-sub">
                <strong>{invite.studentName}</strong> wants her friend invited · shared{' '}
                {invite.createdAt.slice(0, 10)}
              </p>
              {invite.email !== null && <p className="announcement-body">{invite.email}</p>}
              <div className="admin-confirm-group">
                {invite.email !== null && (
                  <a className="logout-button" href={`mailto:${invite.email}`}>
                    Write to them
                  </a>
                )}
                <button
                  type="button"
                  className="admin-retry-button"
                  disabled={busy}
                  onClick={() => {
                    run(
                      decideInvite(token, invite.id, 'reached-out'),
                      'Marked reached out — the address is now cleared from the app.',
                    );
                  }}
                >
                  I&rsquo;ve reached out
                </button>
                <button
                  type="button"
                  className="logout-button"
                  disabled={busy}
                  onClick={() => {
                    run(
                      decideInvite(token, invite.id, 'decline'),
                      'Declined — the address is now cleared from the app.',
                    );
                  }}
                >
                  Don&rsquo;t send
                </button>
              </div>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
