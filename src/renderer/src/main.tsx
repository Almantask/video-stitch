import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

interface ErrorBoundaryState {
  error: Error | null
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
          <div className="max-w-lg w-full rounded-xl bg-zinc-900 border border-red-500/40 p-6 space-y-3">
            <h1 className="text-sm font-semibold text-red-300">Video Stitch Runtime Error</h1>
            <pre className="text-xs text-zinc-300 bg-zinc-950 p-3 rounded overflow-x-auto whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3.5 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white cursor-pointer"
            >
              Reload App
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
)
