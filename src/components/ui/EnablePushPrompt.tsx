/**
 * Gentle push-notification opt-in shown to signed-in students and guardians.
 * Renders nothing when unsupported, already subscribed, denied, or dismissed
 * this visit — never a nag, and never a false "done": a failed enrollment
 * says so gently instead of silently closing. The first real use: the
 * guardian access request nudge (OD-19), so the consent code reaches her
 * even with the app closed.
 */
import { useEffect, useState } from 'react';
import { enablePushNotifications, notificationPermission, pushSupported } from '@/lib/push';
import { promptMemory } from '@/lib/promptMemory';
import { useAuth } from '@/lib/authStore';

export function EnablePushPrompt() {
  const session = useAuth();
  const [hidden, setHidden] = useState(promptMemory.pushDismissed || promptMemory.pushEnabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // null = still checking whether a subscription already exists; only a
  // granted permission warrants the async check.
  const [alreadySubscribed, setAlreadySubscribed] = useState<boolean | null>(() =>
    pushSupported() && notificationPermission() === 'granted' ? null : false,
  );

  useEffect(() => {
    if (alreadySubscribed !== null) {
      return;
    }
    let cancelled = false;
    // Permission granted: only re-offer if no live subscription exists in
    // THIS context (a browser tab and the installed app hold separate ones).
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (!cancelled) {
          setAlreadySubscribed(subscription !== null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAlreadySubscribed(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [alreadySubscribed]);

  if (
    session === null ||
    session.subject.type === 'admin' ||
    hidden ||
    !pushSupported() ||
    notificationPermission() === 'denied' ||
    alreadySubscribed !== false
  ) {
    return null;
  }
  const token = session.token;

  return (
    <section className="passkey-prompt" aria-label="Turn on notifications">
      <p className="passkey-prompt-text">
        Want a heads-up when something needs you? Turn on notifications.
      </p>
      {message !== null && (
        <p role="alert" className="passkey-prompt-error">
          {message}
        </p>
      )}
      <div className="admin-confirm-group">
        <button
          type="button"
          className="admin-retry-button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setMessage(null);
            void enablePushNotifications(token)
              .then((result) => {
                if (result.ok) {
                  promptMemory.pushEnabled = true;
                  setHidden(true);
                } else if (result.reason === 'denied') {
                  // Her browser-level no is respected; the permission state
                  // now hides the prompt on its own.
                  setHidden(true);
                } else {
                  setMessage(
                    'Notifications didn’t switch on this time. You can try again whenever.',
                  );
                }
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
            promptMemory.pushDismissed = true;
            setHidden(true);
          }}
        >
          Not now
        </button>
      </div>
    </section>
  );
}
