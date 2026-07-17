/**
 * Journals section (Phase 6, Spec §6.10): entry review + AI flag alerts +
 * prompt management. super_admin only until mentor assignment (OD-6). The
 * needs-review mark stays the discreet tilted crown — same language as
 * Crown Checks, never an alarm.
 */
import { useEffect, useState } from 'react';
import {
  createPrompt,
  fetchJournalDetail,
  listJournalRoster,
  listPrompts,
  togglePrompt,
  type AdminJournalDetail,
  type AdminPrompt,
  type JournalRoster,
} from '@/lib/adminJournal';
import { useAuth } from '@/lib/authStore';

type RosterState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; roster: JournalRoster };

type DetailState =
  | { status: 'closed' }
  | { status: 'loading'; studentId: string }
  | { status: 'error'; studentId: string }
  | { status: 'ready'; detail: AdminJournalDetail };

function NeedsReviewMark() {
  return (
    <span
      className="crown-flag"
      role="img"
      aria-label="Needs a gentle check-in"
      title="Needs a gentle check-in"
    >
      👑
    </span>
  );
}

function formatWhen(iso: string | null): string {
  if (iso === null) {
    return '—';
  }
  const d = new Date(iso);
  return `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
}

export function JournalsPage() {
  const [state, setState] = useState<RosterState>({ status: 'loading' });
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [detail, setDetail] = useState<DetailState>({ status: 'closed' });
  const [prompts, setPrompts] = useState<AdminPrompt[] | null>(null);
  const [newPrompt, setNewPrompt] = useState('');
  const [promptNotice, setPromptNotice] = useState('');
  const session = useAuth();
  const token = session?.token;

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    void Promise.all([listJournalRoster(token, page), listPrompts(token)]).then(
      ([rosterResult, promptsResult]) => {
        if (cancelled) {
          return;
        }
        setState(
          rosterResult.ok ? { status: 'ready', roster: rosterResult.data } : { status: 'error' },
        );
        setPrompts(promptsResult.ok ? promptsResult.data : null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, page, reload]);

  if (token === undefined) {
    return null;
  }

  const refresh = (): void => {
    setState({ status: 'loading' });
    setReload((n) => n + 1);
  };

  function openDetail(studentId: string): void {
    if (token === undefined) {
      return;
    }
    setDetail({ status: 'loading', studentId });
    void fetchJournalDetail(token, studentId).then((result) => {
      setDetail(
        result.ok ? { status: 'ready', detail: result.data } : { status: 'error', studentId },
      );
    });
  }

  function handleCreatePrompt(): void {
    const text = newPrompt.trim();
    if (token === undefined || text === '') {
      return;
    }
    setPromptNotice('');
    void createPrompt(token, text).then((result) => {
      if (result.ok) {
        setNewPrompt('');
        setPromptNotice('Prompt added.');
        refresh();
      } else {
        setPromptNotice('Couldn’t add the prompt. Try again.');
      }
    });
  }

  function handleToggle(prompt: AdminPrompt): void {
    if (token === undefined) {
      return;
    }
    void togglePrompt(token, prompt.id, !prompt.active).then((result) => {
      if (result.ok) {
        refresh();
      } else {
        setPromptNotice('Couldn’t update the prompt. Try again.');
      }
    });
  }

  if (detail.status !== 'closed') {
    return (
      <section className="admin-section">
        <div className="admin-section-header">
          <h2 className="admin-section-title">
            {detail.status === 'ready' ? detail.detail.student.displayName : 'Journals'}
          </h2>
          <button
            type="button"
            className="logout-button"
            onClick={() => {
              setDetail({ status: 'closed' });
            }}
          >
            Back to all students
          </button>
        </div>

        {detail.status === 'loading' && <p className="admin-section-note">Loading entries…</p>}

        {detail.status === 'error' && (
          <>
            <p className="admin-section-note" role="alert">
              Couldn&rsquo;t load this student&rsquo;s journal. Try again.
            </p>
            <button
              type="button"
              className="admin-retry-button"
              onClick={() => {
                openDetail(detail.studentId);
              }}
            >
              Try again
            </button>
          </>
        )}

        {detail.status === 'ready' && detail.detail.entries.length === 0 && (
          <p className="admin-section-note">No entries yet.</p>
        )}

        {detail.status === 'ready' &&
          detail.detail.entries.map((entry) => (
            <article key={entry.id} className="journal-review-entry">
              <p className="admin-table-sub">
                {formatWhen(entry.createdAt)}
                {entry.promptText !== null && ` · ${entry.promptText}`}
                {entry.aiFlagTriggered && (
                  <>
                    {' '}
                    <NeedsReviewMark />
                    <span className="admin-table-sub"> {entry.aiFlagReason ?? ''}</span>
                  </>
                )}
              </p>
              <p className="journal-review-text">{entry.text}</p>
            </article>
          ))}
      </section>
    );
  }

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-section-title">Journals</h2>
      </div>

      {state.status === 'loading' && <p className="admin-section-note">Loading…</p>}

      {state.status === 'error' && (
        <>
          <p className="admin-section-note" role="alert">
            Couldn&rsquo;t load journals. Check your connection and try again.
          </p>
          <button type="button" className="admin-retry-button" onClick={refresh}>
            Try again
          </button>
        </>
      )}

      {state.status === 'ready' && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Entries</th>
                <th scope="col">Last entry</th>
                <th scope="col">Review</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.roster.students.map((row) => (
                <tr key={row.studentId}>
                  <td>
                    {row.lastName}, {row.firstName}
                    <span className="admin-table-sub"> ({row.displayName})</span>
                  </td>
                  <td>{row.entryCount}</td>
                  <td>{formatWhen(row.lastEntryAt)}</td>
                  <td>{row.needsReview ? <NeedsReviewMark /> : '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="logout-button"
                      onClick={() => {
                        openDetail(row.studentId);
                      }}
                    >
                      Read entries
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {state.status === 'ready' && state.roster.total > state.roster.pageSize && (
        <div className="admin-pagination">
          <button
            type="button"
            className="logout-button"
            disabled={page <= 1}
            onClick={() => {
              setState({ status: 'loading' });
              setPage((p) => Math.max(1, p - 1));
            }}
          >
            Previous
          </button>
          <span className="admin-section-note">
            Page {state.roster.page} of{' '}
            {Math.max(1, Math.ceil(state.roster.total / state.roster.pageSize))}
          </span>
          <button
            type="button"
            className="logout-button"
            disabled={page >= Math.ceil(state.roster.total / state.roster.pageSize)}
            onClick={() => {
              setState({ status: 'loading' });
              setPage((p) => p + 1);
            }}
          >
            Next
          </button>
        </div>
      )}

      <div className="journal-prompts-manager">
        <h3 className="admin-subsection-title">Prompts</h3>
        {promptNotice !== '' && (
          <p className="admin-section-note" role="status">
            {promptNotice}
          </p>
        )}
        <div className="journal-prompt-add">
          <input
            type="text"
            value={newPrompt}
            maxLength={500}
            placeholder="e.g. What made you feel strong this week?"
            aria-label="New prompt"
            onChange={(e) => {
              setNewPrompt(e.target.value);
            }}
          />
          <button
            type="button"
            className="admin-retry-button"
            disabled={newPrompt.trim() === ''}
            onClick={handleCreatePrompt}
          >
            Add prompt
          </button>
        </div>
        {prompts !== null && prompts.length > 0 && (
          <ul className="journal-prompt-list">
            {prompts.map((prompt) => (
              <li key={prompt.id}>
                <span className={prompt.active ? '' : 'journal-prompt-retired'}>{prompt.text}</span>
                <button
                  type="button"
                  className="logout-button"
                  onClick={() => {
                    handleToggle(prompt);
                  }}
                >
                  {prompt.active ? 'Retire' : 'Reactivate'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
