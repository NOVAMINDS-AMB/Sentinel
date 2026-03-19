import React from 'react';
import { AlertTriangle } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[Sentinel] Component error:', error.message, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center gap-3">
          <AlertTriangle className="text-medium" size={24} />
          <p className="font-mono text-sm text-secondaryText">
            {this.props.fallback || 'Something went wrong loading this section.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="text-xs font-mono text-teal-400 hover:text-teal-300 transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
