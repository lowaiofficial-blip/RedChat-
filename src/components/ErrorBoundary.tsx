import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary yakaladı:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[200px] w-full flex flex-col items-center justify-center p-6 text-center bg-zinc-50 dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 m-2">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center mb-3">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-1">
            Görünüm yüklenirken bir sorun oluştu
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xs mb-4">
            Uygulama çalışmaya devam ediyor. Bu bileşeni yenilemeyi deneyebilirsiniz.
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Tekrar Dene</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
