/**
 * Crown Checks section (Spec §6.10): per-student trend views + AI flag
 * alerts. super_admin only until mentor assignment (OD-6) exists.
 *
 * The needs-review indicator is deliberately DISCREET — a tilted crown, not a
 * red alarm (client decision 2026-07-17): it should invite a gentle check-in,
 * not broadcast a crisis across the room. Students never see any of this;
 * flags exist only on this side of the app.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  fetchStudentTrend,
  listCrownCheckRoster,
  type CrownCheckRoster,
  type StudentTrendDetail,
  type TrendPoint,
} from '@/lib/adminCrownChecks';
import { moodTierFor } from '@/config/crownCheck.config';
import { useAuth } from '@/lib/authStore';

type RosterState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; roster: CrownCheckRoster };

type DetailState =
  | { status: 'closed' }
  | { status: 'loading'; studentId: string }
  | { status: 'error'; studentId: string }
  | { status: 'ready'; detail: StudentTrendDetail };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Shape of a ?student= deep-link value worth fetching (the server rejects
 * anything that isn't a UUID anyway — this just skips the doomed request). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Mon 7/14" from a YYYY-MM-DD string, without timezone drift. */
function formatCheckDate(checkDate: string): string {
  const parsed = new Date(`${checkDate}T00:00:00Z`);
  const weekday = WEEKDAYS[parsed.getUTCDay()] ?? '';
  return `${weekday} ${String(parsed.getUTCMonth() + 1)}/${String(parsed.getUTCDate())}`;
}

/** The discreet tilted crown — calm styling, no alarm color. */
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

/** Mini bar strip, oldest → newest so it reads left-to-right in time. */
function TrendStrip({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return <span className="admin-table-sub">No check-ins yet</span>;
  }
  const ordered = [...points].reverse();
  return (
    <span className="crown-trend" aria-label={`${String(points.length)} recent check-ins`}>
      {ordered.map((point) => (
        <span
          key={point.checkDate}
          className={`crown-trend-bar crown-trend-bar-${String(point.moodScore)}`}
          title={`${formatCheckDate(point.checkDate)}: ${String(point.moodScore)}/5`}
        />
      ))}
    </span>
  );
}

export function CrownChecksPage() {
  const [state, setState] = useState<RosterState>({ status: 'loading' });
  const [page, setPage] = useState(1);
  // Bumping `reload` re-runs the roster fetch — the retry mechanism.
  const [reload, setReload] = useState(0);
  // Deep link from the Flag Center: /admin/crown-checks?student=<id> opens
  // that student's check-ins directly.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkStudentId = searchParams.get('student');
  const [detail, setDetail] = useState<DetailState>(() =>
    deepLinkStudentId !== null && UUID_PATTERN.test(deepLinkStudentId)
      ? { status: 'loading', studentId: deepLinkStudentId }
      : { status: 'closed' },
  );
  const session = useAuth();
  const token = session?.token;

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    listCrownCheckRoster(token, page)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setState(result.ok ? { status: 'ready', roster: result.data } : { status: 'error' });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, page, reload]);

  useEffect(() => {
    if (token === undefined || deepLinkStudentId === null) {
      return;
    }
    if (!UUID_PATTERN.test(deepLinkStudentId)) {
      // A mangled link falls back to the roster with a clean URL.
      setSearchParams({}, { replace: true });
      return;
    }
    // The initial "loading" state came from the useState initializer; this
    // effect only performs the fetch itself.
    void fetchStudentTrend(token, deepLinkStudentId).then((result) => {
      setDetail(
        result.ok
          ? { status: 'ready', detail: result.data }
          : { status: 'error', studentId: deepLinkStudentId },
      );
    });
  }, [token, deepLinkStudentId, setSearchParams]);

  function openDetail(studentId: string): void {
    if (token === undefined) {
      return;
    }
    setDetail({ status: 'loading', studentId });
    void fetchStudentTrend(token, studentId).then((result) => {
      setDetail(
        result.ok ? { status: 'ready', detail: result.data } : { status: 'error', studentId },
      );
    });
  }

  if (token === undefined) {
    return null;
  }

  if (detail.status !== 'closed') {
    return (
      <section className="admin-section">
        <div className="admin-section-header">
          <h2 className="admin-section-title">
            {detail.status === 'ready' ? detail.detail.student.displayName : 'Crown Checks'}
            {detail.status === 'ready' && detail.detail.student.needsReview && <NeedsReviewMark />}
          </h2>
          <button
            type="button"
            className="logout-button"
            onClick={() => {
              setDetail({ status: 'closed' });
              // Clear the deep link so the roster stays put on refresh/back.
              if (deepLinkStudentId !== null) {
                setSearchParams({}, { replace: true });
              }
            }}
          >
            Back to all students
          </button>
        </div>

        {detail.status === 'loading' && <p className="admin-section-note">Loading check-ins…</p>}

        {detail.status === 'error' && (
          <>
            <p className="admin-section-note" role="alert">
              Couldn&rsquo;t load this student&rsquo;s check-ins. Try again.
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

        {detail.status === 'ready' && detail.detail.checks.length === 0 && (
          <p className="admin-section-note">No check-ins recorded yet.</p>
        )}

        {detail.status === 'ready' && detail.detail.checks.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Mood</th>
                  <th scope="col">Note</th>
                  <th scope="col">Review</th>
                </tr>
              </thead>
              <tbody>
                {detail.detail.checks.map((check) => (
                  <tr key={check.id}>
                    <td>{formatCheckDate(check.checkDate)}</td>
                    <td>
                      <span aria-hidden="true">{check.moodEmoji}</span>{' '}
                      {moodTierFor(check.moodScore)?.label ?? ''} ({check.moodScore}/5)
                    </td>
                    <td>{check.note ?? '—'}</td>
                    <td>
                      {check.aiFlagTriggered ? (
                        <>
                          <NeedsReviewMark />
                          <span className="admin-table-sub"> {check.aiFlagReason ?? ''}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-section-title">Crown Checks</h2>
      </div>

      {state.status === 'loading' && <p className="admin-section-note">Loading trends…</p>}

      {state.status === 'error' && (
        <>
          <p className="admin-section-note" role="alert">
            Couldn&rsquo;t load Crown Check trends. Check your connection and try again.
          </p>
          <button
            type="button"
            className="admin-retry-button"
            onClick={() => {
              setState({ status: 'loading' });
              setReload((n) => n + 1);
            }}
          >
            Try again
          </button>
        </>
      )}

      {state.status === 'ready' && state.roster.students.length === 0 && (
        <p className="admin-section-note">No active students yet.</p>
      )}

      {state.status === 'ready' && state.roster.students.length > 0 && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Last check-in</th>
                  <th scope="col">Recent trend</th>
                  <th scope="col">Review</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.roster.students.map((entry) => (
                  <tr key={entry.studentId}>
                    <td>
                      {entry.lastName}, {entry.firstName}
                      <span className="admin-table-sub"> ({entry.displayName})</span>
                    </td>
                    <td>
                      {entry.lastCheck === null ? (
                        '—'
                      ) : (
                        <>
                          <span aria-hidden="true">{entry.lastCheck.moodEmoji}</span>{' '}
                          {formatCheckDate(entry.lastCheck.checkDate)}
                        </>
                      )}
                    </td>
                    <td>
                      <TrendStrip points={entry.recent} />
                    </td>
                    <td>{entry.needsReview ? <NeedsReviewMark /> : '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="logout-button"
                        onClick={() => {
                          openDetail(entry.studentId);
                        }}
                      >
                        View check-ins
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.roster.total > state.roster.pageSize && (
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
        </>
      )}
    </section>
  );
}
