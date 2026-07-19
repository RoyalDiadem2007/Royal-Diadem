/**
 * "Invite a friend" (SXU "Your people"): she shares a friend's email and a
 * real person from her team does the reaching out — the app itself never
 * emails anyone. Statuses stay soft and honest: with our team, reached
 * out, or not sent this time.
 */
import { useEffect, useState } from 'react';
import {
  createFriendInvite,
  fetchFriendInvites,
  INVITE_STATUS_LABELS,
  type FriendInvite,
} from '@/lib/friendInvites';
import { useAuth } from '@/lib/authStore';
import { RoseIcon } from '@/components/student/moodIcons';

type ViewState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; invites: FriendInvite[] };

export function InviteFriendCard() {
  const session = useAuth();
  const token = session?.token;
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    let cancelled = false;
    void fetchFriendInvites(token).then((result) => {
      if (cancelled) {
        return;
      }
      setState(result.ok ? { status: 'ready', invites: result.data } : { status: 'error' });
    });
    return () => {
      cancelled = true;
    };
  }, [token, reload]);

  if (token === undefined) {
    return null;
  }

  const submit = (): void => {
    const trimmed = email.trim();
    if (trimmed === '') {
      return;
    }
    setBusy(true);
    setNotice('');
    void createFriendInvite(token, trimmed)
      .then((result) => {
        if (result.ok) {
          setNotice('Got it — a real person from your team will reach out to them. 💛');
          setEmail('');
          setState({ status: 'loading' });
          setReload((n) => n + 1);
        } else if (result.failure.kind === 'rate_limited') {
          setNotice('You’ve shared a few friends already — give it a little while and try again.');
        } else if (result.failure.kind === 'denied' && result.failure.code === 'already_invited') {
          setNotice('You’ve already told us about this friend — your team has it. 💛');
        } else if (result.failure.kind === 'denied' && result.failure.code === 'invite_limit') {
          setNotice('Your team is still reaching out to the friends you shared. One at a time. 💛');
        } else {
          setNotice('That didn’t go through. Check your connection and try again.');
        }
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const invites = state.status === 'ready' ? state.invites : [];

  return (
    <section className="goals-card connect-card" aria-label="Invite a friend">
      <RoseIcon className="goals-card-crown" />
      <h2 className="goals-card-heading">Invite a friend</h2>

      {state.status === 'loading' && <p className="daily-message-loading">One moment…</p>}
      {state.status === 'error' && (
        // Quiet: ambient card, comes back with the next visit.
        <p className="daily-message-loading">
          This card can&rsquo;t load right now. Your invites are safe.
        </p>
      )}

      {state.status === 'ready' && (
        <>
          <p className="door-sub">
            Know someone who&rsquo;d love this space? Share her email and a real person from your
            team will reach out — kindly, and only if she&rsquo;s interested.
          </p>
          <label className="crown-check-note">
            <span className="crown-check-note-label">Her email</span>
            <input
              type="email"
              value={email}
              maxLength={254}
              autoComplete="off"
              placeholder="friend@example.com"
              disabled={busy}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          </label>
          <div className="admin-confirm-group">
            <button
              type="button"
              className="crown-check-submit"
              disabled={busy || email.trim() === ''}
              onClick={submit}
            >
              Share with my team
            </button>
          </div>
        </>
      )}

      {notice !== '' && (
        <p className="connect-card-notice" role="status">
          {notice}
        </p>
      )}

      {invites.length > 0 && (
        <>
          <hr className="goals-card-rule" />
          <p className="eyebrow eyebrow-gold">Friends you&rsquo;ve shared</p>
          {invites.map((invite) => (
            <p key={invite.id} className="goals-card-also">
              <span>{invite.email ?? 'A friend'}</span> ·{' '}
              <span className={`invite-status invite-status-${invite.status}`}>
                {INVITE_STATUS_LABELS[invite.status]}
              </span>
            </p>
          ))}
        </>
      )}
    </section>
  );
}
