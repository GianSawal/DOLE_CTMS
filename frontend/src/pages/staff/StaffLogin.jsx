import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth, LOGOUT_REASON_KEY } from '../../context/AuthContext';
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
  const [remember, setRemember] = useState(false);
  // Shown once after being signed out for inactivity
  const [signedOutNotice] = useState(() => {
    try {
      const reason = sessionStorage.getItem(LOGOUT_REASON_KEY);
      sessionStorage.removeItem(LOGOUT_REASON_KEY);
      return reason === 'idle'
        ? { type: 'info', text: 'You were signed out after 1 hour of inactivity. Sign in again to continue.' }
        : null;
    } catch {
      return null;
    }
  });

  const checkCapsLock = (e) => {
    if (typeof e.getModifierState === 'function') setCapsLock(e.getModifierState('CapsLock'));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError('');
      const signedIn = await login(username.trim(), password, remember);
      // A TV Display account opens its office's TV board instead of the staff pages
      // A Registration Desk account opens its Registration page
      navigate(signedIn?.role === 'DISPLAY' && signedIn.display ? signedIn.display.url
        : signedIn?.role === 'REGISTRAR' ? '/staff/registration' : '/staff/queue');
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

      <Notice notice={error ? { type: 'error', text: error } : signedOutNotice} />

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

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.55rem', fontWeight: 500, cursor: 'pointer', margin: 0 }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            style={{ width: '18px', height: '18px', minHeight: 0, marginTop: '0.15rem', flexShrink: 0 }}
          />
          <span>
            Remember me
            <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--ui-muted)', fontWeight: 400 }}>
              Stay signed in even when idle. Don't check this on a shared computer.
            </span>
          </span>
        </label>

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
