/**
 * Journal card (Phase 6, Spec §6.4): free-write or prompted entries. The
 * transparency line is part of the product, not boilerplate — she knows her
 * mentor reads what she writes. Entries are encrypted server-side before
 * they ever touch the database; nothing is stored on this device.
 */
import { useEffect, useState } from 'react';
import {
  fetchJournal,
  writeJournalEntry,
  type JournalEntry,
  type JournalPrompt,
} from '@/lib/journal';
import { useAuth } from '@/lib/authStore';

const TEXT_MAX = 4000;

type ViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; prompts: JournalPrompt[]; entries: JournalEntry[] };

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
}

export function Journal() {
  const session = useAuth();
  const token = session?.token;

  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [promptId, setPromptId] = useState('');
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    fetchJournal(token)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setState(
          result.ok
            ? { status: 'ready', prompts: result.data.prompts, entries: result.data.entries }
            : { status: 'error' },
        );
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, reload]);

  if (token === undefined) {
    return null;
  }

  const handleSubmit = (): void => {
    const trimmed = text.trim();
    if (trimmed === '' || submitting) {
      return;
    }
    setSubmitting(true);
    setNotice('');
    void writeJournalEntry(token, {
      text: trimmed,
      ...(promptId === '' ? {} : { promptId }),
    })
      .then((result) => {
        if (result.ok) {
          setText('');
          setPromptId('');
          setNotice('Saved. Your words are safe here.');
          setReload((n) => n + 1);
        } else {
          setNotice("Couldn't save your entry. Check your connection and try again.");
        }
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  if (state.status === 'loading') {
    return (
      <section className="crown-check-card" aria-busy="true" aria-label="Journal">
        <p className="crown-check-note-text">Opening your journal…</p>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="crown-check-card" aria-label="Journal">
        <p role="alert" className="crown-check-error">
          Your journal couldn&rsquo;t open right now. Check your connection and try again.
        </p>
        <button
          type="button"
          className="crown-check-retry"
          onClick={() => {
            setState({ status: 'loading' });
            setReload((n) => n + 1);
          }}
        >
          Try again
        </button>
      </section>
    );
  }

  return (
    <section className="crown-check-card" aria-label="Journal">
      <h2 className="crown-check-title">Journal</h2>
      <p className="journal-transparency">
        Your mentor can read what you write here — that&rsquo;s how she walks with you.
      </p>

      {state.prompts.length > 0 && (
        <label className="crown-check-note">
          <span className="crown-check-note-label">Want a prompt? (optional)</span>
          <select
            value={promptId}
            disabled={submitting}
            onChange={(e) => {
              setPromptId(e.target.value);
            }}
          >
            <option value="">Free write</option>
            {state.prompts.map((prompt) => (
              <option key={prompt.id} value={prompt.id}>
                {prompt.text}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="crown-check-note">
        <span className="crown-check-note-label">What&rsquo;s in your heart today?</span>
        <textarea
          value={text}
          maxLength={TEXT_MAX}
          rows={4}
          disabled={submitting}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
      </label>

      {notice !== '' && (
        <p role="status" className="crown-check-note-text">
          {notice}
        </p>
      )}

      <button
        type="button"
        className="crown-check-submit"
        disabled={text.trim() === '' || submitting}
        onClick={handleSubmit}
      >
        {submitting ? 'Saving…' : 'Save entry'}
      </button>

      {state.entries.length > 0 && (
        <details className="journal-history">
          <summary>Your past entries ({state.entries.length})</summary>
          <ul className="journal-history-list">
            {state.entries.map((entry) => (
              <li key={entry.id}>
                <span className="journal-history-date">{formatWhen(entry.createdAt)}</span>
                {entry.promptText !== null && (
                  <span className="journal-history-prompt"> · {entry.promptText}</span>
                )}
                <p className="journal-history-text">{entry.text}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
