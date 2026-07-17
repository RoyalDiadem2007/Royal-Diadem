/**
 * Gentle push-notification opt-in shown to signed-in students and guardians.
 * Renders nothing when unsupported, already decided, or dismissed — never a
 * nag. The first real use: the guardian access request nudge (OD-19), so the
 * consent code reaches her even with the app closed.
 */
import { useState } from 'react';
import { enablePushNotifications, notificationPermission, pushSupported } from '@/lib/push';
import { useAuth } from '@/lib/authStore';

export function EnablePushPrompt() {
  const session = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (
    session === null ||
    session.subject.type === 'admin' ||
    dismissed ||
    done ||
    !pushSupported() ||
    notificationPermission() !== 'default'
  ) {
    return null;
  }
  const token = session.token;

  return (
    <section className="passkey-prompt" aria-label="Turn on notifications">
      <p className="passkey-prompt-text">
        Want a heads-up when something needs you? Turn on notifications.
      </p>
      <div className="admin-confirm-group">
        <button
          type="button"
          className="admin-retry-button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void enablePushNotifications(token)
              .then(() => {
                setDone(true);
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {busy ? 'Turning on…' : 'Turn on'}
        </button>
        <button
          type="button"
          className="logout-button"
          disabled={busy}
          onClick={() => {
            setDismissed(true);
          }}
        >
          Not now
        </button>
      </div>
    </section>
  );
}
