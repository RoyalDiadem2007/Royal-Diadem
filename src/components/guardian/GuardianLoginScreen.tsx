/**
 * Guardian portal sign-in (OD-19 build B): email + the PIN issued when the
 * guardian claimed their invitation link. Same auth pipeline as every other
 * login (Turnstile, rate limits, opaque session) — just a guardian subject.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { brand } from '@/config/branding.config';
import { login } from '@/lib/authStore';

export function GuardianLoginScreen() {
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canSubmit = !submitting && email.trim() !== '' && pin.trim() !== '';

  const handleSubmit = (): void => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    void login({ subjectType: 'guardian', identifier: email, pin })
      .then((result) => {
        if (!result.ok) {
          setErrorMessage(result.message);
        }
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <div className="login-screen">
      <img src={brand.logo} alt={`${brand.name} logo`} className="login-logo" />
      <h1 className="login-title">{brand.name}</h1>
      <p className="welcome-hint">Guardian sign-in</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        className="login-form"
        aria-label="Guardian sign in"
      >
        <label className="login-field">
          <span>Email</span>
          <input
            type="email"
            name="identifier"
            autoComplete="username"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            disabled={submitting}
          />
        </label>

        <label className="login-field">
          <span>PIN</span>
          <input
            className="login-pin-input"
            type="password"
            name="pin"
            inputMode="numeric"
            autoComplete="current-password"
            maxLength={8}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
            }}
            disabled={submitting}
          />
        </label>

        {errorMessage !== null && (
          <p role="alert" className="login-error">
            {errorMessage}
          </p>
        )}

        <button type="submit" disabled={!canSubmit} className="login-submit">
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <Link className="login-mode-toggle" to="/login">
        Student or admin? Sign in here
      </Link>
    </div>
  );
}
