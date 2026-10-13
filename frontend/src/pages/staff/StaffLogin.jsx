import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import AuthLayout from '../../components/AuthLayout';
import { Notice } from '../../components/ui';

export default function StaffLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [capsLock, setCapsLock] = useState(false);

  const checkCapsLock = (e) => {
    if (typeof e.getModifierState === 'function') setCapsLock(e.getModifierState('CapsLock'));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError('');
      await login(username.trim(), password);
      navigate('/staff/queue');
    } catch (err) {
      if (err.status === 429 && err.data?.code === 'ACCOUNT_LOCKED') {
        setError(err.message);
      } else if (err.status === 429) {
        setError('Too many sign-in attempts. Wait a minute, then try again.');
      } else if (err.status === 401 || /no active account/i.test(err.message || '')) {
        setError('Wrong username or password. Check that Caps Lock is off. If it still fails, ask your office administrator to reset your password.');
      } else {
        setError(err.message || 'Login failed. Please check your credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div style={{ marginBottom: '1.75rem' }}>
        <img src="/dolelogo.png" alt="" style={{ width: '48px', height: '48px', marginBottom: '1rem' }} />
        <h1 className="page-title">Sign in</h1>
        <p className="page-subtitle">Use your DOLE staff account.</p>
      </div>

      <Notice notice={error ? { type: 'error', text: error } : null} />

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1.1rem' }}>
        <div>
          <label htmlFor="staff-username">Username</label>
          <input
            id="staff-username"
            type="text"
            required
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={checkCapsLock}
            onKeyUp={checkCapsLock}
          />
        </div>

        <div>
          <label htmlFor="staff-password">Password</label>
          <div style={{ position: 'relative' }}>
            <input
              id="staff-password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={checkCapsLock}
              onKeyUp={checkCapsLock}
              aria-describedby={capsLock ? 'caps-lock-warning' : undefined}
              style={{ paddingRight: '2.75rem' }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', minHeight: '32px', width: '32px', padding: 0, background: 'transparent', color: 'var(--ui-muted)' }}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          {capsLock && (
            <p id="caps-lock-warning" role="status" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', fontWeight: 600, color: '#b54708' }}>
              Caps Lock is on. Passwords are case-sensitive.
            </p>
          )}
        </div>

        <button type="submit" disabled={loading} className="btn btn-primary btn-lg w-full" style={{ marginTop: '0.35rem' }}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p style={{ marginTop: '1.75rem', fontSize: '0.8rem', color: 'var(--ui-muted)', textAlign: 'center' }}>
        Forgot your password? Ask your office administrator to reset it.
      </p>
    </AuthLayout>
  );
}
