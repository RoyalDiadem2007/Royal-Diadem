/**
 * Announcements section (Phase 9, Spec §6.7 / §6.10): post program news to
 * every student — normal or urgent — and see who's caught up. Read counts
 * count real students only; Student Mode staff identities are excluded
 * server-side.
 */
import { useEffect, useState } from 'react';
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  type AdminAnnouncement,
} from '@/lib/adminAnnouncements';
import { useAuth } from '@/lib/authStore';

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; announcements: AdminAnnouncement[]; activeStudents: number };

export function AnnouncementsPage() {
  const session = useAuth();
  const token = session?.token;

  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    void listAnnouncements(token, 1).then((result) => {
      if (cancelled) {
        return;
      }
      setList(
        result.ok
          ? {
              status: 'ready',
              announcements: result.data.announcements,
              activeStudents: result.data.activeStudents,
            }
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

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-section-title">Announcements</h2>
      </div>

      <p className="admin-section-note">
        Program news for every student, newest first. Urgent announcements stand out visually on the
        girls&rsquo; screens.
      </p>

      {notice !== '' && (
        <p className="admin-section-note" role="status">
          {notice}
        </p>
      )}

      <div className="calendar-editor">
        <label className="crown-check-note">
          <span className="crown-check-note-label">Title</span>
          <input
            type="text"
            value={title}
            maxLength={120}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
        </label>
        <label className="crown-check-note">
          <span className="crown-check-note-label">Message</span>
          <textarea
            value={body}
            maxLength={4000}
            rows={3}
            onChange={(e) => {
              setBody(e.target.value);
            }}
          />
        </label>
        <div className="admin-confirm-group">
          <label className="calendar-repeat-toggle">
            <input
              type="checkbox"
              checked={urgent}
              onChange={(e) => {
                setUrgent(e.target.checked);
              }}
            />
            <span>Urgent</span>
          </label>
          <button
            type="button"
            className="admin-retry-button"
            disabled={busy || title.trim() === '' || body.trim() === ''}
            onClick={() => {
              const input = {
                title: title.trim(),
                body: body.trim(),
                priority: urgent ? ('urgent' as const) : ('normal' as const),
              };
              setTitle('');
              setBody('');
              setUrgent(false);
              run(createAnnouncement(token, input), 'Posted — students see it now.');
            }}
          >
            Post announcement
          </button>
        </div>
      </div>

      {list.status === 'loading' && <p className="admin-section-note">Loading announcements…</p>}
      {list.status === 'error' && (
        <>
          <p className="admin-section-note" role="alert">
            Couldn&rsquo;t load announcements. Check your connection and try again.
          </p>
          <button type="button" className="admin-retry-button" onClick={refresh}>
            Try again
          </button>
        </>
      )}

      {list.status === 'ready' && list.announcements.length === 0 && (
        <p className="admin-section-note">Nothing posted yet — share the first update above.</p>
      )}

      {list.status === 'ready' &&
        list.announcements.map((a) => (
          <article
            key={a.id}
            className={
              a.priority === 'urgent'
                ? 'announcement-item announcement-item-urgent'
                : 'announcement-item'
            }
          >
            <p className="admin-table-sub">
              {a.createdAt.slice(0, 10)}
              {a.priority === 'urgent' && <span className="announcement-urgent-tag"> Urgent</span>}
              <span>
                {' '}
                · Read by {a.readCount} of {list.activeStudents}
              </span>
            </p>
            <h3 className="announcement-title">{a.title}</h3>
            <p className="announcement-body">{a.body}</p>
            {confirmDeleteId === a.id ? (
              <span className="admin-confirm-group">
                <span className="admin-table-sub">Delete this announcement?</span>
                <button
                  type="button"
                  className="admin-retry-button"
                  disabled={busy}
                  onClick={() => {
                    run(deleteAnnouncement(token, a.id), 'Announcement deleted.');
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
              <button
                type="button"
                className="logout-button"
                disabled={busy}
                onClick={() => {
                  setConfirmDeleteId(a.id);
                }}
              >
                Delete
              </button>
            )}
          </article>
        ))}
    </section>
  );
}
