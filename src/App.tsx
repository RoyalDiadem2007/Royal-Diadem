import { brand } from '@/config/branding.config';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

export function App() {
  return (
    <ErrorBoundary>
      <div className="app-shell">
        <header className="app-header">
          <img src={brand.logo} alt={`${brand.name} logo`} className="app-logo" />
          <h1 className="app-title">{brand.name}</h1>
          {brand.tagline !== '' && <p className="app-tagline">{brand.tagline}</p>}
        </header>
      </div>
    </ErrorBoundary>
  );
}
