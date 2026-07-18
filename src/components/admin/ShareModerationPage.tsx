/**
 * Share Moderation section (Phase 10a, Spec §6.8 / §6.10): the review queue
 * for pending posts and comments — including peer-flagged content, with the
 * flagger named (anonymous to students only) — plus the pre/post moderation
 * mode switch. Approve or remove; "address privately" happens off-app and
 * belongs in the removal note.
 */
import { useEffect, useState } from 'react';
import {
  fetchQueue,
  moderate,
  setModerationMode,
  type ModerationQueue,
  type QueuedComment,
  type QueuedPost,
} from '@/lib/adminShare';
import { useAuth } from '@/lib/authStore';

type ViewState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; queue: ModerationQueue };

type Removal = { entityType: 'post' | 'comment'; entityId: string } | null;

export function ShareModerationPage() {
  const session = useAuth();
  const token = session?.token;

  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [removal, setRemoval] = useState<Removal>(null);
  const [removalNote, setRemovalNote] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    void fetchQueue(token, 1).then((result) => {
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
    setRemoval(null);
    setRemovalNote('');
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

  const renderItem = (item: QueuedPost | QueuedComment, entityType: 'post' | 'comment') => (
    <article key={item.id} className="announcement-item">
      <p className="admin-table-sub">
        <strong>{item.authorName}</strong> · {item.createdAt.slice(0, 10)}
        {item.flag !== null && (
          <span className="announcement-urgent-tag">
            {' '}
            Peer-flagged by {item.flag.flaggedBy} ({item.flag.flaggedAt.slice(0, 10)})
          </span>
        )}
      </p>
      <p className="announcement-body">{item.text}</p>
      {removal?.entityId === item.id ? (
        <div className="encouragement-editor">
          <label className="crown-check-note">
            <span className="crown-check-note-label">
              Note (optional — e.g. how it was addressed privately)
            </span>
            <input
              type="text"
              value={removalNote}
              maxLength={1000}
              onChange={(e) => {
                setRemovalNote(e.target.value);
              }}
            />
          </label>
          <div className="admin-confirm-group">
            <button
              type="button"
              className="admin-retry-button"
              disabled={busy}
              onClick={() => {
                const note = removalNote.trim();
                run(
                  moderate(token, entityType, item.id, 'remove', note === '' ? undefined : note),
                  'Removed. Any open peer flag on it is resolved.',
                );
              }}
            >
              Confirm remove
            </button>
            <button
              type="button"
              className="logout-button"
              disabled={busy}
              onClick={() => {
                setRemoval(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="admin-confirm-group">
          <button
            type="button"
            className="admin-retry-button"
            disabled={busy}
            onClick={() => {
              run(
                moderate(token, entityType, item.id, 'approve'),
                'Approved — it’s visible to the girls now.',
              );
            }}
          >
            Approve
          </button>
          <button
            type="button"
            className="logout-button"
            disabled={busy}
            onClick={() => {
              setRemoval({ entityType, entityId: item.id });
              setRemovalNote('');
            }}
          >
            Remove
          </button>
        </div>
      )}
    </article>
  );

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-section-title">Share Moderation</h2>
      </div>

      <p className="admin-section-note">
        The Share feed is a safe space — everything here waits on your judgment. Peer flags name the
        student who spoke up; that stays between you and her.
      </p>

      {notice !== '' && (
        <p className="admin-section-note" role="status">
          {notice}
        </p>
      )}

      {state.status === 'loading' && <p className="admin-section-note">Loading the queue…</p>}
      {state.status === 'error' && (
        <>
          <p className="admin-section-note" role="alert">
            Couldn&rsquo;t load the moderation queue. Check your connection and try again.
          </p>
          <button type="button" className="admin-retry-button" onClick={refresh}>
            Try again
          </button>
        </>
      )}

      {state.status === 'ready' && (
        <>
          <div className="calendar-editor">
            <p className="crown-check-note-label">Moderation mode</p>
            <div className="admin-confirm-group" role="radiogroup" aria-label="Moderation mode">
              <label className="calendar-repeat-toggle">
                <input
                  type="radio"
                  name="moderation-mode"
                  checked={state.queue.mode === 'pre'}
                  disabled={busy}
                  onChange={() => {
                    run(
                      setModerationMode(token, 'pre'),
                      'Pre-approval on: posts wait for you before anyone sees them.',
                    );
                  }}
                />
                <span>Pre-approve (posts wait for review)</span>
              </label>
              <label className="calendar-repeat-toggle">
                <input
                  type="radio"
                  name="moderation-mode"
                  checked={state.queue.mode === 'post'}
                  disabled={busy}
                  onChange={() => {
                    run(
                      setModerationMode(token, 'post'),
                      'Post-approval on: posts appear immediately; review after the fact.',
                    );
                  }}
                />
                <span>Post-approve (posts appear immediately)</span>
              </label>
            </div>
          </div>

          <h3 className="admin-subsection-title">Pending posts ({state.queue.totalPosts})</h3>
          {state.queue.posts.length === 0 && (
            <p className="admin-section-note">Nothing waiting — the queue is clear. 👑</p>
          )}
          {state.queue.posts.map((post) => renderItem(post, 'post'))}

          <h3 className="admin-subsection-title">Pending comments ({state.queue.totalComments})</h3>
          {state.queue.comments.length === 0 && (
            <p className="admin-section-note">No comments waiting.</p>
          )}
          {state.queue.comments.map((comment) => renderItem(comment, 'comment'))}
        </>
      )}
    </section>
  );
}
