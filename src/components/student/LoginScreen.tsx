import { useState } from 'react';
import { brand } from '@/config/branding.config';
import { login } from '@/lib/authStore';

type Mode = 'student' | 'admin';

export function LoginScreen() {
  const [mode, setMode] = useState<Mode>('student');
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const identifierLabel = mode === 'student' ? 'Crown code' : 'Email';
  const canSubmit = !submitting && identifier.trim() !== '' && pin.trim() !== '';

  const handleSubmit = (): void => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    void login({ subjectType: mode, identifier, pin })
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

      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        className="login-form"
        aria-label="Sign in"
      >
        <label className="login-field">
          <span>{identifierLabel}</span>
          <input
            type={mode === 'admin' ? 'email' : 'text'}
            name="identifier"
            autoComplete="username"
            autoCapitalize="none"
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value);
            }}
            disabled={submitting}
          />
        </label>

        <label className="login-field">
          <span>PIN</span>
          <input
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

      <button
        type="button"
        className="login-mode-toggle"
        onClick={() => {
          setMode(mode === 'student' ? 'admin' : 'student');
          setErrorMessage(null);
        }}
      >
        {mode === 'student'
          ? 'Mentor or admin? Sign in here'
          : 'Student? Sign in with your crown code'}
      </button>
    </div>
  );
}
