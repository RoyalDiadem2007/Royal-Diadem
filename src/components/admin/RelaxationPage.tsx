/**
 * Relaxation section (Phase 11, Spec §6.3): curate the calming library —
 * affirmations, scripture, grounding prompts. Retire keeps an item out of
 * the girls' room without losing it; delete is for mistakes.
 */
import { useEffect, useState } from 'react';
import {
  createRelaxItem,
  deleteRelaxItem,
  listRelaxItems,
  updateRelaxItem,
  type AdminRelaxItem,
} from '@/lib/adminRelaxation';
import type { RelaxKind } from '@/lib/relaxation';
import { useAuth } from '@/lib/authStore';

type ListState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: AdminRelaxItem[] };

const KIND_LABELS: Readonly<Record<RelaxKind, string>> = {
  affirmation: 'Affirmation',
  scripture: 'Scripture',
  grounding: 'Grounding prompt',
};

export function RelaxationPage() {
  const session = useAuth();
  const token = session?.token;

  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [kind, setKind] = useState<RelaxKind>('affirmation');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    void listRelaxItems(token).then((result) => {
      if (cancelled) {
        return;
      }
      setList(result.ok ? { status: 'ready', items: result.data } : { status: 'error' });
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
        <h2 className="admin-section-title">Relaxation</h2>
      </div>

      <p className="admin-section-note">
        The calming library in the girls&rsquo; Relax room. Breathing, sounds and the 5·4·3·2·1 walk
        are built in — everything here is extra comfort you curate.
      </p>

      {notice !== '' && (
        <p className="admin-section-note" role="status">
          {notice}
        </p>
      )}

      <div className="calendar-editor">
        <label className="crown-check-note">
          <span className="crown-check-note-label">Kind</span>
          <select
            value={kind}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value;
              if (next === 'affirmation' || next === 'scripture' || next === 'grounding') {
                setKind(next);
              }
            }}
          >
            <option value="affirmation">Affirmation</option>
            <option value="scripture">Scripture</option>
            <option value="grounding">Grounding prompt</option>
          </select>
        </label>
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
          <span className="crown-check-note-label">Text</span>
          <textarea
            value={body}
            maxLength={2000}
            rows={3}
            onChange={(e) => {
              setBody(e.target.value);
            }}
          />
        </label>
        <div className="admin-confirm-group">
          <button
            type="button"
            className="admin-retry-button"
            disabled={busy || title.trim() === '' || body.trim() === ''}
            onClick={() => {
              const input = { kind, title: title.trim(), body: body.trim() };
              setTitle('');
              setBody('');
              run(createRelaxItem(token, input), 'Added to the library.');
            }}
          >
            Add to library
          </button>
        </div>
      </div>

      {list.status === 'loading' && <p className="admin-section-note">Loading the library…</p>}
      {list.status === 'error' && (
        <>
          <p className="admin-section-note" role="alert">
            Couldn&rsquo;t load the library. Check your connection and try again.
          </p>
          <button type="button" className="admin-retry-button" onClick={refresh}>
            Try again
          </button>
        </>
      )}

      {list.status === 'ready' && list.items.length === 0 && (
        <p className="admin-section-note">The library is empty — add the first comfort above.</p>
      )}

      {list.status === 'ready' &&
        list.items.map((item) => (
          <article key={item.id} className="announcement-item">
            <p className="admin-table-sub">
              {KIND_LABELS[item.kind]}
              {!item.active && <span className="journal-prompt-retired"> · retired</span>}
            </p>
            <h3 className="announcement-title">{item.title}</h3>
            <p className="announcement-body">{item.body}</p>
            {confirmDeleteId === item.id ? (
              <span className="admin-confirm-group">
                <span className="admin-table-sub">Delete this item?</span>
                <button
                  type="button"
                  className="admin-retry-button"
                  disabled={busy}
                  onClick={() => {
                    run(deleteRelaxItem(token, item.id), 'Deleted.');
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
                    run(
                      updateRelaxItem(token, { ...item, active: !item.active }),
                      item.active ? 'Retired — hidden from the room.' : 'Back in the room.',
                    );
                  }}
                >
                  {item.active ? 'Retire' : 'Reactivate'}
                </button>
                <button
                  type="button"
                  className="logout-button"
                  disabled={busy}
                  onClick={() => {
                    setConfirmDeleteId(item.id);
                  }}
                >
                  Delete
                </button>
              </span>
            )}
          </article>
        ))}
    </section>
  );
}
