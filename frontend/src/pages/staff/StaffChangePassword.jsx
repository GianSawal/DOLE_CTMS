import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { staffApi } from '../../api/staff';

export default function StaffChangePassword() {
  const { user, updateUser, logout } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Password rules validation
  const isMinLength = newPassword.length >= 6;
  const isMatch = newPassword && confirmPassword && newPassword === confirmPassword;
  const isDifferent = currentPassword ? newPassword !== currentPassword : true;
  const isValid = isMinLength && isMatch && isDifferent;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!newPassword) {
      setError('Please enter your new password.');
      return;
    }

    if (!isMinLength) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match. Please verify.');
      return;
    }

    if (currentPassword && newPassword === currentPassword) {
      setError('Your new password cannot be the same as your temporary password.');
      return;
    }

    setLoading(true);
    try {
      const res = await staffApi.changePassword(newPassword, confirmPassword, currentPassword);
      setSuccess(res.message || 'Password changed successfully! Redirecting...');
      updateUser({ must_change_password: false });

      setTimeout(() => {
        navigate('/staff/queue', { replace: true });
      }, 1200);
    } catch (err) {
      setError(err.message || 'Failed to update password. Please check your current password.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = () => {
    logout();
    navigate('/staff/login');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--bg-ground)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="dole-tricolor-bar" />

      {/* Top Simple Brand Header */}
      <header
        style={{
          padding: '1rem 2rem',
          backgroundColor: '#fff',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img src="/dolelogo.png" alt="DOLE Logo" style={{ height: '38px', objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--dole-blue)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Department of Labor and Employment
            </div>
            <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>
              CTMS Staff Portal
            </strong>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          style={{
            background: 'transparent',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.4rem 0.85rem',
            fontSize: '0.84rem',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            minHeight: 'auto',
          }}
        >
          Sign Out
        </button>
      </header>

      {/* Main Content Area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem 1.5rem',
        }}
      >
        <div
          style={{
            maxWidth: '520px',
            width: '100%',
            backgroundColor: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-lg)',
            overflow: 'hidden',
          }}
        >
          {/* Card Accent Top */}
          <div style={{ height: '5px', backgroundColor: 'var(--dole-blue)' }} />

          <div style={{ padding: '2rem' }}>
            {/* Header Icon & Title */}
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  margin: '0 auto 1rem',
                  borderRadius: '50%',
                  backgroundColor: 'var(--dole-blue-light)',
                  color: 'var(--dole-blue)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.8rem',
                }}
              >
                🔐
              </div>
              <h1 style={{ fontSize: '1.35rem', color: 'var(--text-primary)', margin: '0 0 0.4rem 0', fontWeight: 800 }}>
                First-Time Login Password Change
              </h1>
              <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>
                For security reasons, your account was created with a temporary password and must be changed before accessing the queue management system.
              </p>
            </div>

            {/* User Greeting Pill */}
            <div
              style={{
                backgroundColor: 'var(--bg-ground)',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                marginBottom: '1.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.5rem',
              }}
            >
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Account Holder</span>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                  {user?.first_name} {user?.last_name}
                </strong>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Employee ID</span>
                <span className="mono" style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--dole-blue)' }}>
                  {user?.username}
                </span>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div
                style={{
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: 'var(--dole-red)',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.86rem',
                  marginBottom: '1.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div
                style={{
                  backgroundColor: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  color: 'var(--dole-green)',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.86rem',
                  marginBottom: '1.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <span>✅</span>
                <span>{success}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
              {/* Field 1: Current / Temporary Password */}
              <div>
                <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                  Current Temporary Password <span style={{ color: 'var(--dole-red)' }}>*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showCurrent ? 'text' : 'password'}
                    required
                    placeholder="Enter current temporary password (defaults to Employee ID)"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="mono"
                    style={{
                      width: '100%',
                      padding: '0.65rem 2.4rem 0.65rem 0.85rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.9rem',
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent(!showCurrent)}
                    style={{
                      position: 'absolute',
                      right: '0.75rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                      padding: 0,
                      minHeight: 'auto',
                    }}
                  >
                    {showCurrent ? '👁️' : '🙈'}
                  </button>
                </div>
              </div>

              {/* Field 2: New Password */}
              <div>
                <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                  New Password <span style={{ color: 'var(--dole-red)' }}>*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showNew ? 'text' : 'password'}
                    required
                    placeholder="Enter at least 6 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="mono"
                    style={{
                      width: '100%',
                      padding: '0.65rem 2.4rem 0.65rem 0.85rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.9rem',
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    style={{
                      position: 'absolute',
                      right: '0.75rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                      padding: 0,
                      minHeight: 'auto',
                    }}
                  >
                    {showNew ? '👁️' : '🙈'}
                  </button>
                </div>
              </div>

              {/* Field 3: Confirm New Password */}
              <div>
                <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                  Confirm New Password <span style={{ color: 'var(--dole-red)' }}>*</span>
                </label>
                <input
                  type={showNew ? 'text' : 'password'}
                  required
                  placeholder="Re-enter your new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mono"
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.9rem',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Password Checklist Requirements */}
              <div
                style={{
                  backgroundColor: 'var(--bg-ground)',
                  padding: '0.75rem 0.95rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.78rem',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.3rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: isMinLength ? 'var(--dole-green)' : 'var(--text-muted)' }}>
                  <span>{isMinLength ? '✓' : '○'}</span>
                  <span>Minimum 6 characters in length</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: isMatch ? 'var(--dole-green)' : 'var(--text-muted)' }}>
                  <span>{isMatch ? '✓' : '○'}</span>
                  <span>Passwords match</span>
                </div>
                {currentPassword && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: isDifferent ? 'var(--dole-green)' : 'var(--dole-red)' }}>
                    <span>{isDifferent ? '✓' : '✗'}</span>
                    <span>Different from current temporary password</span>
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading || (newPassword && !isValid)}
                className="btn btn-primary"
                style={{
                  width: '100%',
                  padding: '0.8rem',
                  fontSize: '0.96rem',
                  fontWeight: 800,
                  backgroundColor: 'var(--dole-blue)',
                  color: '#fff',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-md)',
                  opacity: loading || (newPassword && !isValid) ? 0.65 : 1,
                  cursor: loading || (newPassword && !isValid) ? 'not-allowed' : 'pointer',
                  marginTop: '0.5rem',
                }}
              >
                {loading ? 'Updating Password...' : '🔒 Update Password & Continue'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
