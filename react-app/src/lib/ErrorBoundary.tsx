import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onReset?: () => void
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  handleReset = () => {
    this.props.onReset?.()
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="blog-error" role="alert">
            <p>Something went wrong:</p>
            <pre>{this.state.error.message}</pre>
            <button onClick={this.handleReset}>Retry</button>
          </div>
        )
      )
    }
    return this.props.children
  }
}
