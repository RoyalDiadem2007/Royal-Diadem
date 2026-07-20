/**
 * My Queen Card (SXU, Maria's approved model): her avatar, what she's
 * proud of, what she's growing toward, and her strengths. Private — her
 * and authorized staff only, said plainly on the page. No rankings, no
 * streaks; failing to have it all figured out is a fine place to be.
 */
import { useEffect, useState } from 'react';
import {
  ACTIVE_GOAL_LIMIT,
  createGoal,
  fetchQueenCard,
  GOAL_STATUS_LABELS,
  saveProfile,
  setStrengths,
  STRENGTH_LIMIT,
  updateGoal,
  type GoalStatus,
  type QueenCard,
  type StudentGoal,
} from '@/lib/profile';
import { AvatarArt } from '@/components/student/avatarArt';
import { AVATAR_OPTIONS } from '@/lib/avatars';
import { CrownWatermark } from '@/components/student/CrownWatermark';
import { brand } from '@/config/branding.config';
import { useAuth } from '@/lib/authStore';

type ViewState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; card: QueenCard };

type GoalDraft = {
  title: string;
  nextStep: string;
  status: GoalStatus;
  targetDate: string;
};

const EMPTY_GOAL: GoalDraft = { title: '', nextStep: '', status: 'not_started', targetDate: '' };

export function QueenCardPage() {
  const session = useAuth();
  const token = session?.token;

  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [avatarKey, setAvatarKey] = useState<string | null>(null);
  const [proudOf, setProudOf] = useState('');
  const [pickedStrengths, setPickedStrengths] = useState<string[]>([]);
  // 'new', a goal id, or null when no goal editor is open.
  const [editingGoal, setEditingGoal] = useState<string | null>(null);
  const [goalDraft, setGoalDraft] = useState<GoalDraft>(EMPTY_GOAL);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    void fetchQueenCard(token).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setState({ status: 'error' });
        return;
      }
      setState({ status: 'ready', card: result.data });
      setAvatarKey(result.data.profile.avatarKey);
      setProudOf(result.data.profile.proudOf ?? '');
      setPickedStrengths(result.data.strengths);
    });
    return () => {
      cancelled = true;
    };
  }, [token, reload]);

  if (token === undefined) {
    return null;
  }

  const refresh = (): void => {
    setEditingGoal(null);
    setReload((n) => n + 1);
  };

  const run = (
    work: Promise<{ ok: boolean; failure?: { kind: string; code?: string } }>,
    successNotice: string,
  ): void => {
    setBusy(true);
    setNotice('');
    void work
      .then((result) => {
        if (result.ok) {
          setNotice(successNotice);
          refresh();
        } else if (result.failure?.kind === 'denied' && result.failure.code === 'goal_limit') {
          setNotice(
            `Three growing things is a full garden. Finish or update one to plant another.`,
          );
        } else {
          setNotice('That didn’t save. Your words are still here — try again.');
        }
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const card = state.status === 'ready' ? state.card : null;
  const activeGoals = card?.goals.filter((goal) => goal.status !== 'completed') ?? [];
  const completedGoals = card?.goals.filter((goal) => goal.status === 'completed') ?? [];

  const openGoalEditor = (goal: StudentGoal | null): void => {
    setNotice('');
    if (goal === null) {
      setEditingGoal('new');
      setGoalDraft(EMPTY_GOAL);
    } else {
      setEditingGoal(goal.id);
      setGoalDraft({
        title: goal.title,
        nextStep: goal.nextStep ?? '',
        status: goal.status,
        targetDate: goal.targetDate ?? '',
      });
    }
  };

  return (
    <div className="queen-card-page">
      <header className="share-header">
        <h1 className="page-title">
          <span className="page-title-mark" aria-hidden="true">
            👑
          </span>
          My Queen Card
        </h1>
        <p className="journal-transparency">
          This card is yours. Only you and the {brand.name} staff can see it.
        </p>
      </header>

      {state.status === 'loading' && <p className="daily-message-loading">Opening your card…</p>}
      {state.status === 'error' && (
        <section className="relax-card" aria-label="My Queen Card">
          <p className="daily-message-loading">
            Your card couldn’t load. Check your connection and try again.
          </p>
          <button
            type="button"
            className="daily-message-retry"
            onClick={() => {
              setState({ status: 'loading' });
              refresh();
            }}
          >
            Try again
          </button>
        </section>
      )}

      {notice !== '' && (
        <p className="share-notice" role="status">
          {notice}
        </p>
      )}

      {card !== null && (
        <>
          <section className="relax-card" aria-label="My mark">
            <span className="queen-watermark" aria-hidden="true">
              <CrownWatermark />
            </span>
            <h2 className="events-title">My mark</h2>
            <p className="door-sub">Choose the mark that feels like you (no photo needed).</p>
            <div className="avatar-picker" role="radiogroup" aria-label="Choose your mark">
              {AVATAR_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={avatarKey === option.key}
                  aria-label={option.label}
                  className={
                    avatarKey === option.key
                      ? 'avatar-choice avatar-choice-selected'
                      : 'avatar-choice'
                  }
                  disabled={busy}
                  onClick={() => {
                    setAvatarKey(option.key);
                  }}
                >
                  <AvatarArt avatarKey={option.key} />
                </button>
              ))}
            </div>

            <label className="crown-check-note">
              <span className="crown-check-note-label">What I&rsquo;m proud of (optional)</span>
              <textarea
                value={proudOf}
                maxLength={500}
                rows={2}
                disabled={busy}
                spellCheck={true}
                autoCorrect="on"
                autoCapitalize="sentences"
                onChange={(e) => {
                  setProudOf(e.target.value);
                }}
              />
            </label>
            <button
              type="button"
              className="crown-check-submit"
              disabled={busy}
              onClick={() => {
                const text = proudOf.trim();
                run(
                  saveProfile(token, avatarKey, text === '' ? null : text),
                  'Your card is saved.',
                );
              }}
            >
              Save my card
            </button>
          </section>

          <section className="relax-card" aria-label="What I'm growing toward">
            <h2 className="events-title">What I&rsquo;m growing toward</h2>
            {activeGoals.length === 0 && editingGoal !== 'new' && (
              <p className="door-sub">
                You don&rsquo;t need to have it all figured out. Choose one thing you&rsquo;d like
                to grow toward.
              </p>
            )}

            {activeGoals.map((goal) =>
              editingGoal === goal.id ? (
                <GoalEditor
                  key={goal.id}
                  draft={goalDraft}
                  busy={busy}
                  onChange={setGoalDraft}
                  onCancel={() => {
                    setEditingGoal(null);
                  }}
                  onSave={() => {
                    run(
                      updateGoal(token, {
                        id: goal.id,
                        title: goalDraft.title.trim(),
                        nextStep:
                          goalDraft.nextStep.trim() === '' ? null : goalDraft.nextStep.trim(),
                        status: goalDraft.status,
                        targetDate: goalDraft.targetDate === '' ? null : goalDraft.targetDate,
                      }),
                      goalDraft.status === 'completed'
                        ? 'Completed — look at you grow. 👑'
                        : 'Goal saved.',
                    );
                  }}
                />
              ) : (
                <article key={goal.id} className="goal-item">
                  <p className="goal-title">{goal.title}</p>
                  <p className="goal-meta">
                    <span className={`goal-status goal-status-${goal.status}`}>
                      {GOAL_STATUS_LABELS[goal.status]}
                    </span>
                    {goal.targetDate !== null && <span> · by {goal.targetDate}</span>}
                  </p>
                  {goal.nextStep !== null && (
                    <p className="goal-next">
                      <span className="today-row-label">Next gentle step</span>
                      {goal.nextStep}
                    </p>
                  )}
                  <button
                    type="button"
                    className="daily-message-retry"
                    disabled={busy}
                    onClick={() => {
                      openGoalEditor(goal);
                    }}
                  >
                    Update
                  </button>
                </article>
              ),
            )}

            {editingGoal === 'new' ? (
              <GoalEditor
                draft={goalDraft}
                busy={busy}
                isNew
                onChange={setGoalDraft}
                onCancel={() => {
                  setEditingGoal(null);
                }}
                onSave={() => {
                  run(
                    createGoal(token, {
                      title: goalDraft.title.trim(),
                      nextStep: goalDraft.nextStep.trim() === '' ? null : goalDraft.nextStep.trim(),
                      targetDate: goalDraft.targetDate === '' ? null : goalDraft.targetDate,
                    }),
                    'Planted. Grow gently.',
                  );
                }}
              />
            ) : (
              activeGoals.length < ACTIVE_GOAL_LIMIT && (
                <button
                  type="button"
                  className="crown-check-submit"
                  disabled={busy}
                  onClick={() => {
                    openGoalEditor(null);
                  }}
                >
                  Choose a goal
                </button>
              )
            )}

            {completedGoals.length > 0 && (
              <details className="journal-history">
                <summary>Completed ({completedGoals.length})</summary>
                {completedGoals.map((goal) => (
                  <p key={goal.id} className="goal-completed">
                    <span aria-hidden="true">👑</span> {goal.title}
                  </p>
                ))}
              </details>
            )}
          </section>

          {card.strengthOptions.length > 0 && (
            <section className="relax-card" aria-label="My strengths">
              <h2 className="events-title">My strengths</h2>
              <p className="door-sub">Pick up to {STRENGTH_LIMIT} words that sound like you.</p>
              <div className="strength-picker">
                {card.strengthOptions.map((option) => {
                  const picked = pickedStrengths.includes(option.key);
                  return (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={picked}
                      className={picked ? 'share-reaction share-reaction-mine' : 'share-reaction'}
                      disabled={busy || (!picked && pickedStrengths.length >= STRENGTH_LIMIT)}
                      onClick={() => {
                        setPickedStrengths((current) =>
                          picked
                            ? current.filter((key) => key !== option.key)
                            : [...current, option.key],
                        );
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="crown-check-submit"
                disabled={busy}
                onClick={() => {
                  run(setStrengths(token, pickedStrengths), 'Strengths saved.');
                }}
              >
                Save my strengths
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function GoalEditor({
  draft,
  busy,
  isNew = false,
  onChange,
  onSave,
  onCancel,
}: {
  draft: GoalDraft;
  busy: boolean;
  isNew?: boolean;
  onChange: (next: GoalDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="goal-editor">
      <label className="crown-check-note">
        <span className="crown-check-note-label">My goal</span>
        <input
          type="text"
          value={draft.title}
          maxLength={160}
          disabled={busy}
          spellCheck={true}
          autoCorrect="on"
          autoCapitalize="sentences"
          onChange={(e) => {
            onChange({ ...draft, title: e.target.value });
          }}
        />
      </label>
      <label className="crown-check-note">
        <span className="crown-check-note-label">Next gentle step (optional)</span>
        <input
          type="text"
          value={draft.nextStep}
          maxLength={300}
          disabled={busy}
          spellCheck={true}
          autoCorrect="on"
          autoCapitalize="sentences"
          onChange={(e) => {
            onChange({ ...draft, nextStep: e.target.value });
          }}
        />
      </label>
      <div className="calendar-editor-row">
        {!isNew && (
          <label className="crown-check-note">
            <span className="crown-check-note-label">Where is it?</span>
            <select
              value={draft.status}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.value;
                if (next === 'not_started' || next === 'growing' || next === 'completed') {
                  onChange({ ...draft, status: next });
                }
              }}
            >
              <option value="not_started">Not started</option>
              <option value="growing">Growing</option>
              <option value="completed">Completed</option>
            </select>
          </label>
        )}
        <label className="crown-check-note">
          <span className="crown-check-note-label">Target date (optional)</span>
          <input
            type="date"
            value={draft.targetDate}
            disabled={busy}
            onChange={(e) => {
              onChange({ ...draft, targetDate: e.target.value });
            }}
          />
        </label>
      </div>
      <div className="admin-confirm-group">
        <button
          type="button"
          className="crown-check-submit"
          disabled={busy || draft.title.trim() === ''}
          onClick={onSave}
        >
          {isNew ? 'Plant this goal' : 'Save goal'}
        </button>
        <button type="button" className="daily-message-retry" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
