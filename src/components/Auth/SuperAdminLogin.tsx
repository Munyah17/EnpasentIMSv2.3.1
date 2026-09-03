import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import Copyright from '../Layout/Copyright'

export default function SuperAdminLogin() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    // Gate on the profile login() already fetched (profiles.role — the
    // authoritative source) rather than a second, separate
    // supabase.auth.getSession() call: that re-read the JWT's
    // user_metadata.role right after sign-in and would occasionally see a
    // not-yet-settled session, signing the user straight back out a moment
    // after a genuinely successful login.
    const { profile, error: loginError } = await login(email, password)
    setLoading(false)
    if (profile) {
      if (profile.role === 'super_admin') {
        navigate('/', { replace: true })
      } else {
        await supabase.auth.signOut()
        setError('Access denied. Super Admin credentials required.')
      }
    } else {
      setError(loginError ?? 'Invalid credentials. Please try again.')
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <div className="logo-mark">T</div>
          <div>
            <div className="logo-name">ENPASENT IMS</div>
            <div className="logo-sub">Super Admin Access · Restricted</div>
          </div>
        </div>

        <div className="login-badge" style={{ textAlign: 'center', marginBottom: '1rem' }}>
          <span style={{
            display: 'inline-block',
            background: '#7c3aed',
            color: '#fff',
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.08em',
            padding: '0.25rem 0.75rem',
            borderRadius: '999px',
            textTransform: 'uppercase',
          }}>Super Admin Portal</span>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            {/* Username, not full name: resolve_login_email() matches on
                profiles.username alone, so a full name never resolved and
                the label was promising a sign-in that could not work. */}
            <label htmlFor="email">Email or Username</label>
            <input
              id="email"
              type="text"
              placeholder="Enter super admin email or username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? 'Authenticating…' : 'Sign In as Super Admin'}
          </button>
        </form>

        <div className="login-footer">
          <Copyright />
        </div>
      </div>
    </div>
  )
}
