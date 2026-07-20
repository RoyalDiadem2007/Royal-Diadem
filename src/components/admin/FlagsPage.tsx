/**
 * Flags section — the Flag Center (Phase 14, Spec §7 / §6.10): every AI and
 * peer flag in one place. High severity leads with the tilted crown (calm,
 * never an alarm — the same mark the trend views use). Each row links to
 * the section holding the actual content; what happens beyond this panel
 * (calls, outreach) is the OD-3 human protocol.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { listFlags, sectionPathFor, updateFlag, type CenterFlag } from '@/lib/adminFlags';
import { useAuth } from '@/lib/authStore';

type ViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; flags: CenterFlag[]; total: number };

const ENTITY_LABELS: Readonly<Record<CenterFlag['entityType'], string>> = {
  crown_check: 'Crown Check',
  journal: 'Journal',
  share_post: 'Share post',
  share_comment: 'Share comment',
};

export function FlagsPage() {
  const session = useAuth();
  const token = session?.token;

  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    void listFlags(token, scope, 1).then((result) => {
      if (cancelled) {
        return;
      }
      setState(
        result.ok
          ? { status: 'ready', flags: result.data.flags, total: result.data.total }
          : { status: 'error' },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [token, scope, reload]);

  if (token === undefined) {
    return null;
  }

  const refresh = (): void => {
    setState({ status: 'loading' });
    setResolveId(null);
    setResolveNote('');
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
        <h2 className="admin-section-title">Flags</h2>
        <div className="admin-confirm-group" role="radiogroup" aria-label="Which flags">
          <label className="calendar-repeat-toggle">
            <input
              type="radio"
              name="flag-scope"
              checked={scope === 'open'}
              disabled={busy}
              onChange={() => {
                setScope('open');
                setState({ status: 'loading' });
              }}
            />
            <span>Needs attention</span>
          </label>
          <label className="calendar-repeat-toggle">
            <input
              type="radio"
              name="flag-scope"
              checked={scope === 'all'}
              disabled={busy}
              onChange={() => {
                setScope('all');
                setState({ status: 'loading' });
              }}
            />
            <span>Everything (history)</span>
          </label>
        </div>
      </div>

      <p className="admin-section-note">
        Every AI and peer flag, one place. Reasons show as categories only — the content itself
        lives in its own section. What happens beyond this panel is your protocol, not the
        app&rsquo;s.
      </p>

      {notice !== '' && (
        <p className="admin-section-note" role="status">
          {notice}
        </p>
      )}

      {state.status === 'loading' && <p className="admin-section-note">Gathering the flags…</p>}
      {state.status === 'error' && (
        <>
          <p className="admin-section-note" role="alert">
            Couldn&rsquo;t load the flags. Check your connection and try again.
          </p>
          <button type="button" className="admin-retry-button" onClick={refresh}>
            Try again
          </button>
        </>
      )}

      {state.status === 'ready' && state.flags.length === 0 && (
        <p className="admin-section-note">
          {scope === 'open' ? 'Nothing needs attention. 👑' : 'No flags recorded yet.'}
        </p>
      )}

      {state.status === 'ready' &&
        state.flags.map((flag) => (
          <article key={flag.id} className="announcement-item">
            <p className="admin-table-sub">
              {flag.severity === 'high' && (
                <span
                  className="crown-flag"
                  role="img"
                  aria-label="High severity — needs a gentle check-in"
                >
                  👑
                </span>
              )}{' '}
              <strong>{flag.studentName ?? 'Unknown student'}</strong> ·{' '}
              {ENTITY_LABELS[flag.entityType]} · {flag.source === 'ai' ? 'AI flag' : 'Peer flag'}
              {flag.flaggedBy !== null && ` from ${flag.flaggedBy}`} · {flag.createdAt.slice(0, 10)}{' '}
              · <span className={`flag-status flag-status-${flag.status}`}>{flag.status}</span>
            </p>
            {flag.detail !== null && <p className="announcement-body">{flag.detail}</p>}
            {flag.adminNotes !== null && <p className="admin-table-sub">Note: {flag.adminNotes}</p>}
            <div className="admin-confirm-group">
              <Link className="logout-button" to={sectionPathFor(flag.entityType, flag.studentId)}>
                Open {ENTITY_LABELS[flag.entityType]}s
              </Link>
              {flag.status === 'new' && (
                <button
                  type="button"
                  className="logout-button"
                  disabled={busy}
                  onClick={() => {
                    run(updateFlag(token, flag.id, 'reviewed'), 'Marked reviewed.');
                  }}
                >
                  Mark reviewed
                </button>
              )}
              {flag.status !== 'resolved' &&
                (resolveId === flag.id ? (
                  <span className="admin-confirm-group">
                    <input
                      type="text"
                      value={resolveNote}
                      maxLength={1000}
                      placeholder="How it was handled (optional)"
                      aria-label="Resolution note"
                      disabled={busy}
                      onChange={(e) => {
                        setResolveNote(e.target.value);
                      }}
                    />
                    <button
                      type="button"
                      className="admin-retry-button"
                      disabled={busy}
                      onClick={() => {
                        const note = resolveNote.trim();
                        run(
                          updateFlag(token, flag.id, 'resolved', note === '' ? undefined : note),
                          'Resolved.',
                        );
                      }}
                    >
                      Confirm resolve
                    </button>
                    <button
                      type="button"
                      className="logout-button"
                      disabled={busy}
                      onClick={() => {
                        setResolveId(null);
                      }}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="admin-retry-button"
                    disabled={busy}
                    onClick={() => {
                      setResolveId(flag.id);
                      setResolveNote('');
                    }}
                  >
                    Resolve
                  </button>
                ))}
            </div>
          </article>
        ))}
    </section>
  );
}
