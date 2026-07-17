/**
 * Students section (Spec §6.10): roster, individual enrollment, admin-initiated
 * PIN reset (OD-9). super_admin only until mentor assignment (OD-6) exists.
 */
import { useEffect, useState } from 'react';
import {
  listStudents,
  resetStudentPin,
  type IssuedCredentials,
  type StudentRoster,
} from '@/lib/adminStudents';
import { useAuth } from '@/lib/authStore';
import { AddStudentForm } from '@/components/admin/AddStudentForm';
import { CsvImport } from '@/components/admin/CsvImport';
import { IssuedPinCard } from '@/components/admin/IssuedPinCard';

type RosterState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; roster: StudentRoster };

type IssuedPanel = { issued: IssuedCredentials; reason: 'created' | 'reset' } | null;

const CONSENT_LABELS: Readonly<Record<string, string>> = {
  pending: 'Consent pending',
  verified: 'Consent verified',
  denied: 'Consent denied',
};

export function StudentsPage() {
  const [state, setState] = useState<RosterState>({ status: 'loading' });
  const [page, setPage] = useState(1);
  // Bumping `reload` re-runs the roster fetch (after enroll/reset/retry).
  const [reload, setReload] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [issuedPanel, setIssuedPanel] = useState<IssuedPanel>(null);
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null);
  const [resetError, setResetError] = useState('');
  const session = useAuth();
  const token = session?.token;

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    listStudents(token, page)
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

  function refresh(): void {
    setState({ status: 'loading' });
    setReload((n) => n + 1);
  }

  function handleReset(studentId: string): void {
    if (token === undefined) {
      return;
    }
    setConfirmResetId(null);
    setResetError('');
    void resetStudentPin(token, studentId).then((result) => {
      if (result.ok) {
        setIssuedPanel({ issued: result.data, reason: 'reset' });
      } else {
        setResetError('Couldn’t reset the PIN. Try again.');
      }
    });
  }

  if (token === undefined) {
    return null;
  }

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-section-title">Students</h2>
        {!showForm && !showImport && issuedPanel === null && (
          <div className="admin-confirm-group">
            <button
              type="button"
              className="admin-retry-button"
              onClick={() => {
                setShowForm(true);
              }}
            >
              Add student
            </button>
            <button
              type="button"
              className="admin-retry-button"
              onClick={() => {
                setShowImport(true);
              }}
            >
              Import CSV
            </button>
          </div>
        )}
      </div>

      {showImport && (
        <CsvImport
          sessionToken={token}
          onFinished={() => {
            setShowImport(false);
            refresh();
          }}
          onCancel={() => {
            setShowImport(false);
          }}
        />
      )}

      {issuedPanel !== null && (
        <IssuedPinCard
          issued={issuedPanel.issued}
          reason={issuedPanel.reason}
          onDismiss={() => {
            setIssuedPanel(null);
          }}
        />
      )}

      {showForm && issuedPanel === null && (
        <AddStudentForm
          sessionToken={token}
          onEnrolled={(issued) => {
            setShowForm(false);
            setIssuedPanel({ issued, reason: 'created' });
            refresh();
          }}
          onCancel={() => {
            setShowForm(false);
          }}
        />
      )}

      {resetError !== '' && (
        <p className="admin-section-note" role="alert">
          {resetError}
        </p>
      )}

      {state.status === 'loading' && <p className="admin-section-note">Loading the roster…</p>}

      {state.status === 'error' && (
        <>
          <p className="admin-section-note" role="alert">
            Couldn&rsquo;t load the roster. Check your connection and try again.
          </p>
          <button type="button" className="admin-retry-button" onClick={refresh}>
            Try again
          </button>
        </>
      )}

      {state.status === 'ready' && state.roster.students.length === 0 && (
        <p className="admin-section-note">
          No students enrolled yet. &ldquo;Add student&rdquo; starts the first enrollment.
        </p>
      )}

      {state.status === 'ready' && state.roster.students.length > 0 && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Crown code</th>
                  <th scope="col">Status</th>
                  <th scope="col">COPPA</th>
                  <th scope="col">Phase</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.roster.students.map((student) => (
                  <tr key={student.id}>
                    <td>
                      {student.lastName}, {student.firstName}
                      <span className="admin-table-sub"> ({student.displayName})</span>
                    </td>
                    <td>{student.loginCode ?? '—'}</td>
                    <td>{student.status}</td>
                    <td>
                      {student.coppaRequired
                        ? (CONSENT_LABELS[student.coppaConsentStatus] ?? student.coppaConsentStatus)
                        : 'Not required'}
                    </td>
                    <td>{student.phase ?? '—'}</td>
                    <td>
                      {confirmResetId === student.id ? (
                        <span className="admin-confirm-group">
                          <button
                            type="button"
                            className="admin-danger-button"
                            onClick={() => {
                              handleReset(student.id);
                            }}
                          >
                            Confirm reset
                          </button>
                          <button
                            type="button"
                            className="logout-button"
                            onClick={() => {
                              setConfirmResetId(null);
                            }}
                          >
                            Keep PIN
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="logout-button"
                          onClick={() => {
                            setConfirmResetId(student.id);
                          }}
                        >
                          Reset PIN
                        </button>
                      )}
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
