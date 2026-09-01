import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ErrorBoundary from './ErrorBoundary'

function Bomb(): never {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>All good</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('All good')).toBeInTheDocument()
  })

  it('renders a fallback UI instead of white-screening when a child throws', () => {
    // React logs the caught error to the console; silence it for this test.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload app/i })).toBeInTheDocument()
    consoleError.mockRestore()
  })
})
