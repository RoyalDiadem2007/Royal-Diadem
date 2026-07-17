/**
 * /welcome — landing for emailed first-login magic links (Phase 4c, OD-19).
 * The token rides the URL fragment (never sent to any server by the browser);
 * claiming is an explicit tap so scanners/prefetchers can't burn the
 * single-use link. On success this screen IS the digital PIN card: crown code
 * + fresh PIN shown exactly once, then continue into the app (where the
 * existing Face ID prompt takes over).
 */
import { useState } from 'react';
import { brand } from '@/config/branding.config';
import { claimMagicLink, installSession, type ClaimedWelcome } from '@/lib/authStore';
import { tokenFromFragment } from '@/lib/linkToken';

type ViewState =
  | { status: 'landing' }
  | { status: 'claiming' }
  | { status: 'revealed'; claimed: ClaimedWelcome }
  | { status: 'failed'; message: string };

const NO_TOKEN_MESSAGE =
  'This welcome page needs the link from your email. Open the email and tap the link again.';

export function WelcomeScreen() {
  const [state, setState] = useState<ViewState>({ status: 'landing' });
  const token = tokenFromFragment(window.location.hash);

  const handleClaim = (): void => {
    if (token === null || state.status === 'claiming') {
      return;
    }
    setState({ status: 'claiming' });
    void claimMagicLink(token).then((result) => {
      setState(
        result.ok
          ? { status: 'revealed', claimed: result.claimed }
          : { status: 'failed', message: result.message },
      );
    });
  };

  if (state.status === 'revealed') {
    const { credentials, session } = state.claimed;
    return (
      <div className="login-screen">
        <img src={brand.logo} alt={`${brand.name} logo`} className="login-logo" />
        <h1 className="login-title">Welcome, {session.subject.displayName}!</h1>
        <div className="welcome-credentials" aria-label="Your sign-in details">
          <p className="welcome-keep-safe">
            These are your sign-in details. They show <strong>only once</strong> — write them down
            or screenshot this before you continue.
          </p>
          <p className="welcome-credential-row">
            <span className="welcome-credential-label">Crown code</span>
            <span className="welcome-credential-value">{credentials.crownCode}</span>
          </p>
          <p className="welcome-credential-row">
            <span className="welcome-credential-label">PIN</span>
            <span className="welcome-credential-value">{credentials.pin}</span>
          </p>
          <p className="welcome-hint">
            Next you can turn on Face ID / Touch ID so you rarely need these — they&rsquo;re your
            backup if you ever get locked out.
          </p>
        </div>
        <button
          type="button"
          className="login-submit"
          onClick={() => {
            installSession(session);
          }}
        >
          I saved them — take me in
        </button>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <img src={brand.logo} alt={`${brand.name} logo`} className="login-logo" />
      <h1 className="login-title">{brand.name}</h1>

      {token === null || state.status === 'failed' ? (
        <>
          <p role="alert" className="login-error">
            {state.status === 'failed' ? state.message : NO_TOKEN_MESSAGE}
          </p>
          <a className="login-mode-toggle" href="/">
            Go to sign-in
          </a>
        </>
      ) : (
        <>
          <p className="welcome-hint">
            Your crown is waiting. Tap below to get your sign-in code — it appears once, so have
            somewhere safe ready to save it.
          </p>
          <button
            type="button"
            className="login-submit"
            disabled={state.status === 'claiming'}
            onClick={handleClaim}
          >
            {state.status === 'claiming' ? 'Opening…' : 'Get my sign-in code'}
          </button>
        </>
      )}
    </div>
  );
}
