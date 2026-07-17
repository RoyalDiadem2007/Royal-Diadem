/**
 * Guardian portal home (OD-19 build B). The whole surface enforces the
 * transparency deal: asking to view puts a code in the STUDENT's app; only
 * what she shares opens the 30-minute window. The UI never sees the code
 * except as whatever the guardian types.
 */
import { useEffect, useState } from 'react';
import { brand } from '@/config/branding.config';
import {
  enterConsentCode,
  fetchStudentView,
  listLinkedStudents,
  requestAccess,
  type GuardianStudent,
  type GuardianStudentView,
} from '@/lib/guardianPortal';
import { moodTierFor } from '@/config/crownCheck.config';
import { logout, useAuth } from '@/lib/authStore';

type ListState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; students: GuardianStudent[] };

type ViewState = { status: 'closed' } | { status: 'open'; view: GuardianStudentView };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function formatCheckDate(checkDate: string): string {
  const parsed = new Date(`${checkDate}T00:00:00Z`);
  const weekday = WEEKDAYS[parsed.getUTCDay()] ?? '';
  return `${weekday} ${String(parsed.getUTCMonth() + 1)}/${String(parsed.getUTCDate())}`;
}

function minutesLeft(iso: string | null): number {
  if (iso === null) {
    return 0;
  }
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
}

export function GuardianHome() {
  const session = useAuth();
  const token = session?.token;

  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [codeByStudent, setCodeByStudent] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<ViewState>({ status: 'closed' });

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    listLinkedStudents(token)
      .then((result) => {
        if (!cancelled) {
          setList(result.ok ? { status: 'ready', students: result.data } : { status: 'error' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setList({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, reload]);

  if (token === undefined || session === null) {
    return null;
  }

  const refresh = (): void => {
    setList({ status: 'loading' });
    setReload((n) => n + 1);
  };

  const handleRequest = (studentId: string, displayName: string): void => {
    setBusy(true);
    setNotice('');
    void requestAccess(token, studentId).then((result) => {
      setBusy(false);
      if (result.ok) {
        setNotice(
          `${displayName} now sees your request in her app. Ask her for the 6-digit code — it's her choice to share it.`,
        );
        refresh();
      } else {
        setNotice('Couldn’t send the request. Try again in a moment.');
      }
    });
  };

  const handleEnterCode = (studentId: string): void => {
    const code = (codeByStudent[studentId] ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      setNotice('The code is 6 digits — ask her to read it again.');
      return;
    }
    setBusy(true);
    setNotice('');
    void enterConsentCode(token, studentId, code).then((result) => {
      setBusy(false);
      if (result.ok) {
        setNotice('Access open for 30 minutes.');
        setCodeByStudent((prev) => ({ ...prev, [studentId]: '' }));
        refresh();
        return;
      }
      if (result.failure.kind === 'rate_limited') {
        setNotice('Too many tries. Wait a few minutes and ask her for a fresh code.');
      } else {
        setNotice("That code didn't match or has expired. Ask her to check her app again.");
      }
    });
  };

  const openView = (studentId: string): void => {
    setBusy(true);
    setNotice('');
    void fetchStudentView(token, studentId).then((result) => {
      setBusy(false);
      if (result.ok) {
        setView({ status: 'open', view: result.data });
      } else {
        setNotice('The viewing window has closed. Ask to view again when you need to.');
        refresh();
      }
    });
  };

  if (view.status === 'open') {
    const { student, trend, accessExpiresAt } = view.view;
    return (
      <div className="app-shell">
        <header className="app-header">
          <img src={brand.logo} alt={`${brand.name} logo`} className="app-logo" />
          <h1 className="app-title">{student.displayName}</h1>
          <p className="app-tagline">
            Viewing with her knowledge · window closes in {minutesLeft(accessExpiresAt)} min
          </p>
        </header>
        <section className="guardian-view-card" aria-label="Student overview">
          <p className="guardian-view-row">
            <span>Name</span>
            <span>
              {student.firstName} {student.lastName}
            </span>
          </p>
          <p className="guardian-view-row">
            <span>Status</span>
            <span>{student.status}</span>
          </p>
          <p className="guardian-view-row">
            <span>Phase</span>
            <span>{student.phase ?? '—'}</span>
          </p>
        </section>
        <section className="guardian-view-card" aria-label="Recent check-ins">
          <h2 className="crown-check-title">Recent Crown Checks</h2>
          {trend.length === 0 && <p className="crown-check-note-text">No check-ins yet.</p>}
          <ul className="guardian-trend-list">
            {trend.map((point) => (
              <li key={point.checkDate}>
                <span aria-hidden="true">{point.moodEmoji}</span>{' '}
                {moodTierFor(point.moodScore)?.label ?? ''} — {formatCheckDate(point.checkDate)}
              </li>
            ))}
          </ul>
        </section>
        <button
          type="button"
          className="logout-button"
          onClick={() => {
            setView({ status: 'closed' });
            refresh();
          }}
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <img src={brand.logo} alt={`${brand.name} logo`} className="app-logo" />
        <h1 className="app-title">Hello, {session.subject.displayName}</h1>
        <p className="app-tagline">
          Viewing always happens with her knowledge — she shares a code from her app each time.
        </p>
      </header>

      {notice !== '' && (
        <p className="admin-section-note" role="status">
          {notice}
        </p>
      )}

      {list.status === 'loading' && <p className="crown-check-note-text">Loading…</p>}

      {list.status === 'error' && (
        <>
          <p role="alert" className="crown-check-error">
            Couldn&rsquo;t load right now. Check your connection and try again.
          </p>
          <button type="button" className="crown-check-retry" onClick={refresh}>
            Try again
          </button>
        </>
      )}

      {list.status === 'ready' && list.students.length === 0 && (
        <p className="crown-check-note-text">
          No linked students yet — the program team connects your account.
        </p>
      )}

      {list.status === 'ready' &&
        list.students.map((student) => (
          <section
            key={student.studentId}
            className="guardian-student-card"
            aria-label={student.displayName}
          >
            <h2 className="crown-check-title">{student.displayName}</h2>

            {student.state === 'none' && (
              <button
                type="button"
                className="crown-check-submit"
                disabled={busy}
                onClick={() => {
                  handleRequest(student.studentId, student.displayName);
                }}
              >
                Ask to view her account
              </button>
            )}

            {student.state === 'pending' && (
              <div className="guardian-code-entry">
                <p className="crown-check-note-text">
                  She sees your request in her app. Enter the code she shares with you:
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  aria-label={`Consent code for ${student.displayName}`}
                  value={codeByStudent[student.studentId] ?? ''}
                  disabled={busy}
                  onChange={(e) => {
                    setCodeByStudent((prev) => ({
                      ...prev,
                      [student.studentId]: e.target.value,
                    }));
                  }}
                />
                <button
                  type="button"
                  className="crown-check-submit"
                  disabled={busy}
                  onClick={() => {
                    handleEnterCode(student.studentId);
                  }}
                >
                  Open access
                </button>
              </div>
            )}

            {student.state === 'active' && (
              <button
                type="button"
                className="crown-check-submit"
                disabled={busy}
                onClick={() => {
                  openView(student.studentId);
                }}
              >
                View ({minutesLeft(student.accessExpiresAt)} min left)
              </button>
            )}
          </section>
        ))}

      <button
        type="button"
        className="logout-button"
        onClick={() => {
          void logout();
        }}
      >
        Sign out
      </button>
    </div>
  );
}
