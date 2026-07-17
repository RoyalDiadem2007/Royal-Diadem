import { useState } from 'react';
import { registerPasskey, useAuth } from '@/lib/authStore';
import { passkeysSupported } from '@/lib/passkey';

/**
 * Post-login nudge (Spec §5 step 2: "Enable Face ID / Touch ID?"). Shown only
 * when the device supports passkeys and the account has none yet. Declining
 * is remembered for this visit only — PIN always remains the fallback.
 */
export function EnablePasskeyPrompt() {
  const session = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (session === null || session.webauthnRegistered || dismissed || !passkeysSupported()) {
    return null;
  }

  const handleEnable = (): void => {
    setBusy(true);
    setMessage(null);
    void registerPasskey()
      .then((result) => {
        if (!result.ok) {
          setMessage(result.message);
        }
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section className="passkey-prompt" aria-label="Enable faster sign-in">
      <p>Want faster sign-in next time? Use Face ID, Touch ID, or your device lock.</p>
      {message !== null && (
        <p role="alert" className="passkey-prompt-error">
          {message}
        </p>
      )}
      <div className="passkey-prompt-actions">
        <button type="button" disabled={busy} onClick={handleEnable}>
          {busy ? 'Setting up…' : 'Enable'}
        </button>
        <button
          type="button"
          className="passkey-prompt-dismiss"
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
