/**
 * Students section (Spec §6.10): roster, individual enrollment, admin-initiated
 * PIN reset (OD-9). super_admin only until mentor assignment (OD-6) exists.
 */
import { useEffect, useState } from 'react';
import {
  grantEmergencyAccess,
  inviteGuardian,
  listStudents,
  resetStudentPin,
  sendMagicLink,
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

// Specific, actionable copy per send-link refusal (OD-19 age matrix).
const SEND_LINK_ERRORS: Readonly<Record<string, string>> = {
  no_student_email: 'No student email on file — add one, or print a PIN card instead.',
  no_guardian_email: 'No guardian email on file — add the guardian first.',
  consent_pending: 'Guardian consent must be verified before an under-13 welcome link is sent.',
  account_inactive: 'This account is inactive — reactivate it before sending a link.',
  email_not_configured: 'Email sending isn’t configured yet (Resend key — see KEYS_SETUP §3b).',
  email_send_failed: 'The email couldn’t be delivered. Try again in a moment.',
  not_eligible: 'Students 16 and up don’t have guardian portal access (OD-19).',
  guardian_no_portal: 'The guardian hasn’t claimed a portal invitation yet — invite them first.',
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
  const [linkNotice, setLinkNotice] = useState('');
  const [sendingLinkId, setSendingLinkId] = useState<string | null>(null);
  const [confirmEmergencyId, setConfirmEmergencyId] = useState<string | null>(null);
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

  function handleSendLink(student: { id: string; displayName: string }): void {
    if (token === undefined || sendingLinkId !== null) {
      return;
    }
    setSendingLinkId(student.id);
    setLinkNotice('');
    void sendMagicLink(token, student.id).then((result) => {
      setSendingLinkId(null);
      if (result.ok) {
        const inbox = result.data.recipient === 'guardian' ? 'the guardian' : 'the student';
        setLinkNotice(
          `Welcome link for ${student.displayName} sent to ${inbox} — it works once and expires in 72 hours.`,
        );
        return;
      }
      const specific =
        result.failure.kind === 'denied' ? SEND_LINK_ERRORS[result.failure.code] : undefined;
      setLinkNotice(specific ?? 'Couldn’t send the link. Check your connection and try again.');
    });
  }

  function handleInviteGuardian(student: { id: string; displayName: string }): void {
    if (token === undefined || sendingLinkId !== null) {
      return;
    }
    setSendingLinkId(student.id);
    setLinkNotice('');
    void inviteGuardian(token, student.id).then((result) => {
      setSendingLinkId(null);
      if (result.ok) {
        setLinkNotice(
          `Guardian portal invitation for ${student.displayName} sent — the link works once and expires in 72 hours.`,
        );
        return;
      }
      const specific =
        result.failure.kind === 'denied' ? SEND_LINK_ERRORS[result.failure.code] : undefined;
      setLinkNotice(specific ?? 'Couldn’t send the invitation. Try again.');
    });
  }

  function handleEmergency(student: { id: string; displayName: string }): void {
    if (token === undefined) {
      return;
    }
    setConfirmEmergencyId(null);
    setLinkNotice('');
    void grantEmergencyAccess(token, student.id).then((result) => {
      if (result.ok) {
        setLinkNotice(
          `Emergency guardian access for ${student.displayName} is open for 60 minutes. The student is not notified; the grant is fully audited.`,
        );
        return;
      }
      const specific =
        result.failure.kind === 'denied' ? SEND_LINK_ERRORS[result.failure.code] : undefined;
      setLinkNotice(specific ?? 'Couldn’t grant emergency access. Try again.');
    });
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

      {linkNotice !== '' && (
        <p className="admin-section-note" role="status">
          {linkNotice}
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
                      {student.isStaff && <span className="staff-badge">STAFF</span>}
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
                      ) : confirmEmergencyId === student.id ? (
                        <span className="admin-confirm-group">
                          <button
                            type="button"
                            className="admin-danger-button"
                            onClick={() => {
                              handleEmergency(student);
                            }}
                          >
                            Confirm emergency access
                          </button>
                          <button
                            type="button"
                            className="logout-button"
                            onClick={() => {
                              setConfirmEmergencyId(null);
                            }}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span className="admin-confirm-group">
                          <button
                            type="button"
                            className="logout-button"
                            onClick={() => {
                              setConfirmResetId(student.id);
                            }}
                          >
                            Reset PIN
                          </button>
                          <button
                            type="button"
                            className="logout-button"
                            disabled={sendingLinkId !== null}
                            onClick={() => {
                              handleSendLink(student);
                            }}
                          >
                            {sendingLinkId === student.id ? 'Sending…' : 'Email link'}
                          </button>
                          <button
                            type="button"
                            className="logout-button"
                            disabled={sendingLinkId !== null}
                            onClick={() => {
                              handleInviteGuardian(student);
                            }}
                          >
                            Invite guardian
                          </button>
                          <button
                            type="button"
                            className="logout-button"
                            onClick={() => {
                              setConfirmEmergencyId(student.id);
                            }}
                          >
                            Emergency access
                          </button>
                        </span>
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
