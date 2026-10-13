import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { installErrorReporting, reportClientError } from './errors';
import './styles.css';

installErrorReporting();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A phone in a gym loses focus constantly; refetching on every return is
      // noise for data only this one person changes.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

/**
 * A render crash mid-set shows a way out instead of a blank screen, and is
 * reported. Reloading resumes the workout: every set logged is already saved.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportClientError(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty">
        <h2>Something broke</h2>
        <p>It has been reported. Your logged sets are saved — reloading picks up where you were.</p>
        <button className="btn btn--primary" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
