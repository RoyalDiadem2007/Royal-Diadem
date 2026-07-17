/**
 * Admin Dashboard (Spec §6.10): at-a-glance counts — active students, flags
 * needing attention, today's Crown Check activity. Aggregates only; the
 * drill-down views arrive with their own phases.
 */
import { useEffect, useState } from 'react';
import { fetchDashboardCounts, type DashboardCounts } from '@/lib/adminDashboard';
import { useAuth } from '@/lib/authStore';

type LoadState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; counts: DashboardCounts };

export function DashboardPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // Bumping `attempt` re-runs the fetch effect — the retry mechanism.
  const [attempt, setAttempt] = useState(0);
  const session = useAuth();
  const token = session?.token;

  useEffect(() => {
    if (token === undefined) {
      // Logout race: the route guard is about to unmount this page.
      return;
    }
    let cancelled = false;
    fetchDashboardCounts(token)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setState(result.ok ? { status: 'ready', counts: result.data } : { status: 'error' });
      })
      .catch(() => {
        // fetchDashboardCounts never rejects (typed result), but a rejection
        // must not vanish silently if that contract ever breaks.
        if (!cancelled) {
          setState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  if (state.status === 'loading') {
    return (
      <section className="admin-section" aria-busy="true">
        <h2 className="admin-section-title">Dashboard</h2>
        <p className="admin-section-note">Loading today&rsquo;s numbers…</p>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="admin-section">
        <h2 className="admin-section-title">Dashboard</h2>
        <p className="admin-section-note" role="alert">
          Couldn&rsquo;t load the dashboard. Check your connection and try again.
        </p>
        <button
          type="button"
          className="admin-retry-button"
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

  const { counts } = state;
  return (
    <section className="admin-section">
      <h2 className="admin-section-title">Dashboard</h2>
      <div className="admin-stat-grid">
        <div className="admin-stat-card">
          <span className="admin-stat-value">{counts.activeStudents}</span>
          <span className="admin-stat-label">Active students</span>
        </div>
        <div
          className={
            counts.highSeverityNewFlags > 0
              ? 'admin-stat-card admin-stat-card-alert'
              : 'admin-stat-card'
          }
        >
          <span className="admin-stat-value">{counts.newFlags}</span>
          <span className="admin-stat-label">
            {counts.highSeverityNewFlags > 0
              ? `New flags (${String(counts.highSeverityNewFlags)} high severity)`
              : 'New flags'}
          </span>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-value">{counts.todaysCrownChecks}</span>
          <span className="admin-stat-label">Crown Checks today</span>
        </div>
      </div>
    </section>
  );
}
