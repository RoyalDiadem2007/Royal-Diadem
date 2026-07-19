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

/** One pending-work chip: text + count, never color alone (SXU brief). */
function PendingChip({
  count,
  label,
  sectionId,
  role,
  alert = false,
}: {
  count: number;
  label: string;
  /** Empty string = informational chip with no destination (never a dead link). */
  sectionId: string;
  role: AdminRole;
  alert?: boolean;
}) {
  if (count === 0) {
    return null;
  }
  const section =
    sectionId === '' ? undefined : sectionsForRole(role).find((s) => s.id === sectionId);
  const className = alert ? 'pending-chip pending-chip-alert' : 'pending-chip';
  const body = (
    <>
      <span className="pending-chip-count">{count}</span> {label}
    </>
  );
  if (section === undefined) {
    return <span className={className}>{body}</span>;
  }
  return (
    <Link to={adminSectionUrl(section)} className={`${className} pending-chip-link`}>
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
  const { pending } = counts;
  const nothingPending =
    pending.openFlags === 0 &&
    pending.moderation === 0 &&
    pending.guardianRequests === 0 &&
    pending.encouragementDrafts === 0;
  return (
    <section className="admin-section">
      <h2 className="admin-section-title">Dashboard</h2>

      {/* The pending-work strip (SXU): what waits on a human, first. */}
      <div className="pending-strip" aria-label="Waiting on you">
        {nothingPending ? (
          <span className="pending-chip pending-chip-clear">
            Nothing waiting on you right now. 👑
          </span>
        ) : (
          <>
            <PendingChip
              count={pending.openFlags}
              label={pending.openFlags === 1 ? 'open flag' : 'open flags'}
              sectionId="flags"
              role={role}
              alert={counts.highSeverityNewFlags > 0}
            />
            <PendingChip
              count={pending.moderation}
              label="waiting for moderation"
              sectionId="share-moderation"
              role={role}
            />
            <PendingChip
              count={pending.guardianRequests}
              label={
                pending.guardianRequests === 1
                  ? 'guardian request in progress'
                  : 'guardian requests in progress'
              }
              sectionId=""
              role={role}
            />
            <PendingChip
              count={pending.encouragementDrafts}
              label={
                pending.encouragementDrafts === 1
                  ? 'encouragement draft to review'
                  : 'encouragement drafts to review'
              }
              sectionId="encouragement"
              role={role}
            />
          </>
        )}
        <PendingChip
          count={pending.upcomingEvents}
          label={pending.upcomingEvents === 1 ? 'event this week' : 'events this week'}
          sectionId="calendar"
          role={role}
        />
      </div>

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
