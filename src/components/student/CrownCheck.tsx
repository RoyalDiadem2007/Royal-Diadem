/**
 * Crown Check (Spec §6.2): the daily emotional temp check. Emoji scale +
 * optional one-line note, under 30 seconds, zero friction. One check per day
 * — coming back the same day edits it (her latest feeling counts). Flags are
 * a server-side admin concern; nothing about them ever renders here.
 */
import { useEffect, useState } from 'react';
import { MOOD_SCALE, moodTierFor, NOTE_MAX_LENGTH, NOTE_PROMPT } from '@/config/crownCheck.config';
import { fetchCrownCheckStatus, submitCrownCheck, type CrownCheckEntry } from '@/lib/crownCheck';
import type { ApiFailure } from '@/lib/api';
import { useAuth } from '@/lib/authStore';

type ViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'picking'; today: CrownCheckEntry | null }
  | { status: 'done'; today: CrownCheckEntry };

const FAILURE_MESSAGES: Readonly<Record<ApiFailure['kind'], string>> = {
  rate_limited: 'Whoa, lots of taps! Take a breath and try again in a minute.',
  denied: 'Your session ended. Sign in again to check in.',
  network: "Can't reach Royal Diadem right now. Check your connection and try again.",
  server: 'Something went wrong on our side. Try again in a moment.',
};

export function CrownCheck() {
  const session = useAuth();
  const token = session?.token;

  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Bumping `attempt` re-runs the fetch effect — the retry mechanism.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    fetchCrownCheckStatus(token)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          setState({ status: 'error' });
          return;
        }
        const today = result.data.today;
        setState(today === null ? { status: 'picking', today: null } : { status: 'done', today });
      })
      .catch(() => {
        // The client never rejects (typed result); a broken contract must
        // still land in the visible error state, not vanish.
        if (!cancelled) {
          setState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  if (token === undefined) {
    return null;
  }

  const startEditing = (today: CrownCheckEntry): void => {
    setSelectedScore(today.moodScore);
    setNote(today.note ?? '');
    setErrorMessage(null);
    setState({ status: 'picking', today });
  };

  const handleSubmit = (): void => {
    const tier = selectedScore === null ? undefined : moodTierFor(selectedScore);
    if (tier === undefined || submitting) {
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    const trimmedNote = note.trim();
    void submitCrownCheck(token, {
      moodScore: tier.score,
      moodEmoji: tier.emoji,
      ...(trimmedNote === '' ? {} : { note: trimmedNote }),
    })
      .then((result) => {
        if (result.ok) {
          setState({ status: 'done', today: result.data });
        } else {
          setErrorMessage(FAILURE_MESSAGES[result.failure.kind]);
        }
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  if (state.status === 'loading') {
    return (
      <section className="crown-check-card" aria-busy="true" aria-label="Crown Check">
        <p className="crown-check-note-text">Getting your Crown Check ready…</p>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="crown-check-card" aria-label="Crown Check">
        <p role="alert" className="crown-check-error">
          {FAILURE_MESSAGES.network}
        </p>
        <button
          type="button"
          className="crown-check-retry"
          onClick={() => {
            setState({ status: 'loading' });
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </button>
      </section>
    );
  }

  if (state.status === 'done') {
    const tier = moodTierFor(state.today.moodScore);
    return (
      <section className="crown-check-card" aria-label="Crown Check">
        <h2 className="crown-check-title">Crown Check ✓</h2>
        <p className="crown-check-done">
          <span className="crown-check-done-emoji" aria-hidden="true">
            {state.today.moodEmoji}
          </span>
          You checked in feeling {tier?.label.toLowerCase() ?? 'yourself'} today.
        </p>
        {state.today.note !== null && <p className="crown-check-note-text">“{state.today.note}”</p>}
        <button
          type="button"
          className="crown-check-edit"
          onClick={() => {
            startEditing(state.today);
          }}
        >
          Feeling different? Update it
        </button>
      </section>
    );
  }

  return (
    <section className="crown-check-card" aria-label="Crown Check">
      <h2 className="crown-check-title">Crown Check</h2>
      <p className="crown-check-question">How are you feeling today, queen?</p>
      <div role="radiogroup" aria-label="How are you feeling?" className="crown-check-scale">
        {MOOD_SCALE.map((tier) => (
          <button
            key={tier.score}
            type="button"
            role="radio"
            aria-checked={selectedScore === tier.score}
            className={
              selectedScore === tier.score
                ? 'crown-check-mood crown-check-mood-selected'
                : 'crown-check-mood'
            }
            disabled={submitting}
            onClick={() => {
              setSelectedScore(tier.score);
            }}
          >
            <span className="crown-check-mood-emoji" aria-hidden="true">
              {tier.emoji}
            </span>
            <span className="crown-check-mood-label">{tier.label}</span>
          </button>
        ))}
      </div>
      <label className="crown-check-note">
        <span className="crown-check-note-label">{NOTE_PROMPT} (optional)</span>
        <input
          type="text"
          value={note}
          maxLength={NOTE_MAX_LENGTH}
          disabled={submitting}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
      </label>
      {errorMessage !== null && (
        <p role="alert" className="crown-check-error">
          {errorMessage}
        </p>
      )}
      <button
        type="button"
        className="crown-check-submit"
        disabled={selectedScore === null || submitting}
        onClick={handleSubmit}
      >
        {submitting ? 'Saving…' : state.today === null ? 'Check in' : 'Update my check-in'}
      </button>
    </section>
  );
}
