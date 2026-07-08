import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Local-only tool: log to console for now. Nothing is sent anywhere.
    console.error('Line17 Face Attendance crashed:', error, info.componentStack);
  }

  private reload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  private dismiss = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="crash-screen">
          <div className="crash-card">
            <span className="eyebrow">Something went wrong</span>
            <h1>This page hit an unexpected error</h1>
            <p>
              Your local data in IndexedDB is untouched — workers, attendance records,
              and camera events are not affected by this crash. Reload to recover, or
              try continuing if this looks like a one-off UI glitch.
            </p>
            <pre className="crash-detail">{this.state.error.message}</pre>
            <div className="action-row">
              <button className="primary-btn" onClick={this.reload}>Reload App</button>
              <button className="ghost-btn" onClick={this.dismiss}>Try to Continue</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
