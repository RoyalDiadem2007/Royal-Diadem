/**
 * Strengths section (SXU): the vocabulary a student may claim on her Queen
 * Card — administrator-approved words only. Retire hides a word from new
 * picks without stripping it from girls who already chose it.
 */
import { useEffect, useState } from 'react';
import {
  createStrengthOption,
  keyForLabel,
  listStrengthOptions,
  toggleStrengthOption,
  type StrengthOption,
} from '@/lib/adminStrengths';
import { useAuth } from '@/lib/authStore';

type ListState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; options: StrengthOption[] };

export function StrengthsPage() {
  const session = useAuth();
  const token = session?.token;

  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [label, setLabel] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    void listStrengthOptions(token).then((result) => {
      if (cancelled) {
        return;
      }
      setList(result.ok ? { status: 'ready', options: result.data } : { status: 'error' });
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
        <h2 className="admin-section-title">Strengths</h2>
      </div>

      <p className="admin-section-note">
        The words a girl can claim on her Queen Card — she picks only from this list. Warm, specific
        words work best: Brave, Creative, Loyal, Funny, Determined.
      </p>

      {notice !== '' && (
        <p className="admin-section-note" role="status">
          {notice}
        </p>
      )}

      <div className="journal-prompt-add">
        <input
          type="text"
          value={label}
          maxLength={40}
          placeholder="e.g. Brave"
          aria-label="New strength word"
          onChange={(e) => {
            setLabel(e.target.value);
          }}
        />
        <button
          type="button"
          className="admin-retry-button"
          disabled={busy || keyForLabel(label) === ''}
          onClick={() => {
            const trimmed = label.trim();
            setLabel('');
            run(
              createStrengthOption(token, keyForLabel(trimmed), trimmed),
              `“${trimmed}” added to the vocabulary.`,
            );
          }}
        >
          Add word
        </button>
      </div>

      {list.status === 'loading' && <p className="admin-section-note">Loading the vocabulary…</p>}
      {list.status === 'error' && (
        <>
          <p className="admin-section-note" role="alert">
            Couldn&rsquo;t load the vocabulary. Check your connection and try again.
          </p>
          <button type="button" className="admin-retry-button" onClick={refresh}>
            Try again
          </button>
        </>
      )}

      {list.status === 'ready' && list.options.length === 0 && (
        <p className="admin-section-note">
          No words yet — the strengths picker stays hidden from the girls until you add some.
        </p>
      )}

      {list.status === 'ready' && list.options.length > 0 && (
        <ul className="journal-prompt-list">
          {list.options.map((option) => (
            <li key={option.key}>
              <span className={option.active ? '' : 'journal-prompt-retired'}>{option.label}</span>
              <button
                type="button"
                className="logout-button"
                disabled={busy}
                onClick={() => {
                  run(
                    toggleStrengthOption(token, option.key, !option.active),
                    option.active ? 'Retired from new picks.' : 'Back in the vocabulary.',
                  );
                }}
              >
                {option.active ? 'Retire' : 'Reactivate'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
