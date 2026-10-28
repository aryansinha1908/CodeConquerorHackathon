import React from 'react';
import { Button } from './Button';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Unhandled UI error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#f5f0e8] flex items-center justify-center p-6 font-mono">
          <div className="bg-white border-2 border-[#1a1a1a] rounded-xl p-8 max-w-lg w-full shadow-[6px_6px_0_#1a1a1a]">
            <div className="flex items-center gap-3 text-[#c0392b] mb-4">
              <div className="p-2 border-2 border-[#1a1a1a] bg-[#c0392b]/10 rounded-lg">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-black text-[#1a1a1a]">SYSTEM EXCEPTION</h2>
            </div>
            <p className="text-sm text-[#1a1a1a]/80 mb-4 leading-relaxed">
              An unexpected client error occurred while rendering this interface.
            </p>
            <div className="p-3 bg-[#ede8df] border-2 border-[#1a1a1a] rounded-lg text-xs font-mono text-[#c0392b] mb-6 overflow-x-auto">
              {this.state.error?.message || 'Unknown runtime error'}
            </div>
            <div className="flex gap-3">
              <Button onClick={this.handleReset} variant="primary" size="md">
                <RotateCcw className="w-4 h-4" />
                Reload Page
              </Button>
              <Button
                onClick={() => (window.location.href = '/explore')}
                variant="outline"
                size="md"
              >
                Back to Explore
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

