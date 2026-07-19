/**
 * "What I'm growing toward" (SXU mockup): the home's gentle progress card —
 * the first active goal in full (MY GOAL / STATUS / NEXT GENTLE STEP),
 * further goals as quiet lines, and never a rank, streak, or comparison.
 * Fills the desktop right column beside the hero.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { fetchQueenCard, GOAL_STATUS_LABELS, type StudentGoal } from '@/lib/profile';
import { CrownIcon } from '@/components/student/moodIcons';
import { useAuth } from '@/lib/authStore';

type ViewState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; goals: StudentGoal[] };

export function GoalsCard() {
  const session = useAuth();
  const token = session?.token;
  const [state, setState] = useState<ViewState>({ status: 'loading' });

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    void fetchQueenCard(token).then((result) => {
      if (cancelled) {
        return;
      }
      setState(
        result.ok
          ? {
              status: 'ready',
              goals: result.data.goals.filter((goal) => goal.status !== 'completed'),
            }
          : { status: 'error' },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (token === undefined) {
    return null;
  }

  const first = state.status === 'ready' ? state.goals[0] : undefined;
  const rest = state.status === 'ready' ? state.goals.slice(1) : [];

  return (
    <section className="goals-card" aria-label="What I'm growing toward">
      <CrownIcon className="goals-card-crown" />
      <h2 className="goals-card-heading">What I&rsquo;m growing toward</h2>

      {state.status === 'loading' && <p className="daily-message-loading">One moment…</p>}
      {state.status === 'error' && (
        // Quiet: the card is ambient; her Queen Card page has the retry.
        <p className="daily-message-loading">
          Your goals couldn&rsquo;t load right now — they&rsquo;re safe on your Queen Card.
        </p>
      )}

      {state.status === 'ready' && first === undefined && (
        <>
          <p className="door-sub">
            You don&rsquo;t need to have it all figured out. Choose one thing you&rsquo;d like to
            grow toward.
          </p>
          <Link to="/profile" className="goals-card-button">
            <span>Choose a goal</span>
            <span aria-hidden="true">›</span>
          </Link>
        </>
      )}

      {first !== undefined && (
        <>
          <p className="eyebrow eyebrow-gold">My goal</p>
          <p className="goals-card-goal">{first.title}</p>
          <hr className="goals-card-rule" />
          <p className="eyebrow eyebrow-gold">Status</p>
          <p className="goal-meta">
            <span className={`goal-status goal-status-${first.status}`}>
              {GOAL_STATUS_LABELS[first.status]}
            </span>
          </p>
          {first.nextStep !== null && (
            <>
              <hr className="goals-card-rule" />
              <p className="eyebrow eyebrow-gold">Next gentle step</p>
              <p className="goals-card-goal goals-card-step">{first.nextStep}</p>
            </>
          )}
          {rest.length > 0 && (
            <>
              <hr className="goals-card-rule" />
              <p className="eyebrow eyebrow-gold">Also growing</p>
              {rest.map((goal) => (
                <p key={goal.id} className="goals-card-also">
                  {goal.title} ·{' '}
                  <span className={`goal-status goal-status-${goal.status}`}>
                    {GOAL_STATUS_LABELS[goal.status]}
                  </span>
                </p>
              ))}
            </>
          )}
          <Link to="/profile" className="goals-card-button">
            <span>View my goals</span>
            <span aria-hidden="true">›</span>
          </Link>
        </>
      )}
    </section>
  );
}
