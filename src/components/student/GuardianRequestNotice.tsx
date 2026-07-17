/**
 * The student's side of the consent ceremony (OD-19 build B): when a guardian
 * asks to view her account, the request — and the code SHE decides whether to
 * share — appears here. Nothing renders when there is nothing pending, and
 * emergency grants never reach this wire at all (server-enforced).
 */
import { useEffect, useState } from 'react';
import { fetchGuardianRequests, type GuardianRequest } from '@/lib/guardianRequests';
import { useAuth } from '@/lib/authStore';

// Codes live 10 minutes; a light poll keeps the card current while she has
// the app open without hammering the backend.
const POLL_MS = 30_000;

export function GuardianRequestNotice() {
  const session = useAuth();
  const token = session?.token;
  const [requests, setRequests] = useState<GuardianRequest[]>([]);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    const load = (): void => {
      void fetchGuardianRequests(token)
        .then((result) => {
          if (!cancelled && result.ok) {
            setRequests(result.data);
          }
          // Failures leave the last known state — this card is informational
          // and must never block or alarm her home screen.
        })
        .catch(() => undefined);
    };
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token]);

  if (requests.length === 0) {
    return null;
  }

  return (
    <>
      {requests.map((request) => (
        <section
          key={request.id}
          className="guardian-request-card"
          aria-label={`${request.guardianName} is asking to view your account`}
        >
          <p className="guardian-request-text">
            <span aria-hidden="true">👀 </span>
            <strong>{request.guardianName}</strong> is asking to look at your account. Nothing opens
            unless you share this code — it&rsquo;s your call.
          </p>
          <p className="guardian-request-code">{request.code}</p>
          <p className="guardian-request-hint">This code stops working in a few minutes.</p>
        </section>
      ))}
    </>
  );
}
