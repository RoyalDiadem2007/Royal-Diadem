import { brand } from '@/config/branding.config';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { EnablePasskeyPrompt } from '@/components/ui/EnablePasskeyPrompt';
import { LoginScreen } from '@/components/student/LoginScreen';
import { logout, useAuth } from '@/lib/authStore';

function AuthenticatedHome() {
  const session = useAuth();
  if (session === null) {
    return null;
  }
  return (
    <div className="app-shell">
      <header className="app-header">
        <img src={brand.logo} alt={`${brand.name} logo`} className="app-logo" />
        <h1 className="app-title">Welcome, {session.subject.displayName}</h1>
        {brand.tagline !== '' && <p className="app-tagline">{brand.tagline}</p>}
      </header>
      <EnablePasskeyPrompt />
      <button
        type="button"
        className="logout-button"
        onClick={() => {
          void logout();
        }}
      >
        Sign out
      </button>
    </div>
  );
}

export function App() {
  const session = useAuth();
  return (
    <ErrorBoundary>{session === null ? <LoginScreen /> : <AuthenticatedHome />}</ErrorBoundary>
  );
}
