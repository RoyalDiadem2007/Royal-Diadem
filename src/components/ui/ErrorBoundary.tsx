import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '@/lib/logger';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

/**
 * Calm fallback instead of a white screen (CLAUDE.md §12). Wraps the app and,
 * as routes are added, each major feature. Errors are reported through the
 * audit logger — never console, never shown as a stack trace to the user.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('ui.error_boundary', {
      errorName: error.name,
      errorDetail: error.message,
      componentStack: info.componentStack ?? null,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div role="alert" className="error-fallback">
          <h1>Something went wrong</h1>
          <p>Please refresh the page. If it keeps happening, let your mentor or an admin know.</p>
          <button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
          >
            Refresh
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
