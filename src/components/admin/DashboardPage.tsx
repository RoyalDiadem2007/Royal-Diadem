/**
 * Admin Dashboard (Spec §6.10): at-a-glance counts — active students, flags
 * needing attention, today's Crown Check activity. Aggregates only; the
 * drill-down views arrive with their own phases.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { fetchDashboardCounts, type DashboardCounts } from '@/lib/adminDashboard';
import { adminSectionUrl, sectionsForRole, type AdminRole } from '@/config/adminSections';
import { useAuth } from '@/lib/authStore';

type LoadState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; counts: DashboardCounts };

/**
 * A dashboard tile is a live link into its section when that section exists
 * for this role — tiles connect to the registry, so each section wires itself
 * up here the moment its phase ships.
 */
function StatCard({
  value,
  label,
  sectionId,
  role,
  alert = false,
}: {
  value: number;
  label: string;
  sectionId: string;
  role: AdminRole;
  alert?: boolean;
}) {
  const section = sectionsForRole(role).find((s) => s.id === sectionId);
  const className = alert ? 'admin-stat-card admin-stat-card-alert' : 'admin-stat-card';
  const body = (
    <>
      <span className="admin-stat-value">{value}</span>
      <span className="admin-stat-label">{label}</span>
    </>
  );
  if (section === undefined) {
    return <div className={className}>{body}</div>;
  }
  return (
    <Link to={adminSectionUrl(section)} className={`${className} admin-stat-card-link`}>
      {body}
    </Link>
  );
}

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
  const role = session?.subject.role;
  if (role === undefined || role === 'student' || role === 'guardian') {
    return null;
  }
  return (
    <section className="admin-section">
      <h2 className="admin-section-title">Dashboard</h2>
      <div className="admin-stat-grid">
        <StatCard
          value={counts.activeStudents}
          label="Active students"
          sectionId="students"
          role={role}
        />
        <StatCard
          value={counts.newFlags}
          label={
            counts.highSeverityNewFlags > 0
              ? `New flags (${String(counts.highSeverityNewFlags)} high severity)`
              : 'New flags'
          }
          sectionId="flags"
          role={role}
          alert={counts.highSeverityNewFlags > 0}
        />
        <StatCard
          value={counts.todaysCrownChecks}
          label="Crown Checks today"
          sectionId="crown-checks"
          role={role}
        />
      </div>
    </section>
  );
}
