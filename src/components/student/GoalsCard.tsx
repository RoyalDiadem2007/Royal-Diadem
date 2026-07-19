/**
 * "What I'm growing toward" (SXU mockup): the home's gentle progress card —
 * up to three active goals, the first one's next step, and never a rank,
 * streak, or comparison. Fills the desktop right column beside the hero.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { fetchQueenCard, GOAL_STATUS_LABELS, type StudentGoal } from '@/lib/profile';
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

  return (
    <section className="goals-card" aria-label="What I'm growing toward">
      <h2 className="events-title">What I&rsquo;m growing toward</h2>

      {state.status === 'loading' && <p className="daily-message-loading">One moment…</p>}
      {state.status === 'error' && (
        // Quiet: the card is ambient; her Queen Card page has the retry.
        <p className="daily-message-loading">
          Your goals couldn&rsquo;t load right now — they&rsquo;re safe on your Queen Card.
        </p>
      )}

      {state.status === 'ready' && state.goals.length === 0 && (
        <>
          <p className="door-sub">
            You don&rsquo;t need to have it all figured out. Choose one thing you&rsquo;d like to
            grow toward.
          </p>
          <Link to="/profile" className="crown-check-submit goals-card-action">
            Choose a goal
          </Link>
        </>
      )}

      {state.status === 'ready' && state.goals.length > 0 && (
        <>
          {state.goals.map((goal, index) => (
            <article key={goal.id} className="goal-item">
              <p className="goal-title">{goal.title}</p>
              <p className="goal-meta">
                <span className={`goal-status goal-status-${goal.status}`}>
                  {GOAL_STATUS_LABELS[goal.status]}
                </span>
              </p>
              {index === 0 && goal.nextStep !== null && (
                <p className="goal-next">
                  <span className="today-row-label">Next gentle step</span>
                  {goal.nextStep}
                </p>
              )}
            </article>
          ))}
          <Link to="/profile" className="crown-check-submit goals-card-action">
            View my goals
          </Link>
        </>
      )}
    </section>
  );
}
