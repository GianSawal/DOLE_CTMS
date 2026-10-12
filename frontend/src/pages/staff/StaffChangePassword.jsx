import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Circle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { staffApi } from '../../api/staff';
import AuthLayout from '../../components/AuthLayout';
import { Notice } from '../../components/ui';

function Rule({ ok, children }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: ok ? '#067647' : 'var(--ui-muted)', fontSize: '0.82rem' }}>
      {ok ? <Check size={14} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}
      {children}
    </li>
  );
}

export default function StaffChangePassword() {
  const { user, updateUser, logout } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(null);

  const isMinLength = newPassword.length >= 6;
  const isMatch = Boolean(newPassword) && newPassword === confirmPassword;
  const isDifferent = currentPassword ? newPassword !== currentPassword : true;
  const isValid = isMinLength && isMatch && isDifferent;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid) {
      setNotice({ type: 'error', text: 'Please meet all password requirements first.' });
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const res = await staffApi.changePassword(newPassword, confirmPassword, currentPassword);
      setNotice({ type: 'success', text: res.message || 'Password changed. Redirecting…' });
      updateUser({ must_change_password: false });
      setTimeout(() => navigate('/staff/queue', { replace: true }), 1200);
    } catch (err) {
      setNotice({ type: 'error', text: err.message || 'Failed to update password. Please check your current password.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = () => {
    logout();
    navigate('/staff/login');
  };

  return (
    <AuthLayout>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title">Set a new password</h1>
        <p className="page-subtitle">
          {user?.full_name || user?.username}, your account is using a temporary password. Choose your own before continuing.
        </p>
      </div>

      <Notice notice={notice} />

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
        <div>
          <label htmlFor="cp-current">Temporary password</label>
          <input id="cp-current" type="password" autoComplete="current-password" required
            value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </div>
        <div>
          <label htmlFor="cp-new">New password</label>
          <input id="cp-new" type="password" autoComplete="new-password" required
            value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </div>
        <div>
          <label htmlFor="cp-confirm">Confirm new password</label>
          <input id="cp-confirm" type="password" autoComplete="new-password" required
            value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </div>

        <ul style={{ listStyle: 'none', margin: 0, padding: '0.75rem 0.9rem', display: 'grid', gap: '0.35rem', background: 'var(--ui-subtle)', border: '1px solid var(--ui-border)', borderRadius: 'var(--ui-radius-sm)' }}>
          <Rule ok={isMinLength}>At least 6 characters</Rule>
          <Rule ok={isMatch}>Both new passwords match</Rule>
          <Rule ok={isDifferent && Boolean(newPassword)}>Different from the temporary password</Rule>
        </ul>

        <button type="submit" className="btn btn-primary btn-lg w-full" disabled={loading || !isValid}>
          {loading ? 'Saving…' : 'Save password and continue'}
        </button>
      </form>

      <p style={{ marginTop: '1.25rem', textAlign: 'center' }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={handleSignOut}>Sign out</button>
      </p>
    </AuthLayout>
  );
}
