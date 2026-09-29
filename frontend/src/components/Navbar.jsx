import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/staff/login');
  };

  const navLinkStyle = ({ isActive }) => ({
    padding: '0.45rem 0.85rem',
    borderRadius: 'var(--radius-md)',
    textDecoration: 'none',
    fontSize: '0.86rem',
    fontWeight: 600,
    color: isActive ? 'var(--dole-blue)' : 'var(--text-secondary)',
    backgroundColor: isActive ? 'var(--dole-blue-light)' : 'transparent',
    borderBottom: isActive ? '2px solid var(--dole-blue)' : '2px solid transparent',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s ease',
  });

  return (
    <>
      <div className="dole-tricolor-bar" />
      <nav className="staff-navbar">
        {/* Left: Brand */}
        <div className="staff-navbar-left">
          <NavLink to="/staff/queue" className="staff-navbar-brand" style={{ textDecoration: 'none' }}>
            <img
              src="/dolelogo.png"
              alt="DOLE Logo"
              className="dole-logo-img staff-logo"
            />
            <div>
              <div className="staff-logo-sub">DOLE CTMS</div>
              <strong className="staff-logo-title">Staff Portal</strong>
            </div>
          </NavLink>
        </div>

        {/* Center: Navigation Links centered on computer view */}
        <div className="staff-navbar-center">
          <NavLink to="/staff/queue" style={navLinkStyle}>
            📋 Queue
          </NavLink>
          <NavLink to="/staff/transactions" style={navLinkStyle}>
            📊 Transactions
          </NavLink>
          <NavLink to="/staff/reports" style={navLinkStyle}>
            📈 Reports &amp; Rate
          </NavLink>
          <NavLink to="/staff/qr" style={navLinkStyle}>
            🖨️ Check-in QR
          </NavLink>
          {user?.is_superuser && (
            <>
              <NavLink to="/staff/users" style={navLinkStyle} id="nav-user-management">
                👥 User Management
              </NavLink>
              <NavLink to="/staff/personnel" style={navLinkStyle} id="nav-personnel">
                👤 Personnel
              </NavLink>
            </>
          )}
        </div>

        {/* Right: User Profile & Sign Out on Top Right */}
        <div className="staff-navbar-right">
          <div className="staff-user-info">
            <div className="staff-user-name">{user?.username}</div>
            <div className="staff-user-office">
              {user?.is_superuser
                ? 'DOLE Admin'
                : (user?.assigned_offices?.[0]?.code || 'Staff')}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="btn btn-outline btn-sm staff-signout-btn"
            title="Sign out of staff portal"
          >
            Sign Out
          </button>
        </div>
      </nav>
    </>
  );
}
