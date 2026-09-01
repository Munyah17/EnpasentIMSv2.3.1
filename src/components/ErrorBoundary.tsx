import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReload = () => {
    this.setState({ error: null })
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', padding: '2rem', textAlign: 'center', fontFamily: 'DM Sans, sans-serif',
        }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ color: '#666', marginBottom: '1.5rem', maxWidth: 480 }}>
            An unexpected error occurred and this page couldn't continue. Your data has not been lost;
            reloading the app should fix this.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              background: '#7e14ff', color: '#fff', border: 'none', borderRadius: 8,
              padding: '0.6rem 1.4rem', fontSize: '1rem', cursor: 'pointer',
            }}
          >
            Reload app
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
