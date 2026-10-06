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
    borderRadius: '8px',
    textDecoration: 'none',
    fontSize: '0.85rem',
    fontWeight: isActive ? 700 : 600,
    color: isActive ? 'var(--dole-blue)' : '#475569',
    backgroundColor: isActive ? 'rgba(3, 5, 186, 0.08)' : 'transparent',
    border: isActive ? '1px solid rgba(3, 5, 186, 0.2)' : '1px solid transparent',
    boxShadow: isActive ? '0 1px 2px rgba(3, 5, 186, 0.08)' : 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.45rem',
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
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="8" y1="6" x2="21" y2="6"></line>
              <line x1="8" y1="12" x2="21" y2="12"></line>
              <line x1="8" y1="18" x2="21" y2="18"></line>
              <line x1="3" y1="6" x2="3.01" y2="6"></line>
              <line x1="3" y1="12" x2="3.01" y2="12"></line>
              <line x1="3" y1="18" x2="3.01" y2="18"></line>
            </svg>
            <span>Queue</span>
          </NavLink>

          <NavLink to="/staff/transactions" style={navLinkStyle}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="3" y1="9" x2="21" y2="9"></line>
              <line x1="9" y1="21" x2="9" y2="9"></line>
            </svg>
            <span>Transactions</span>
          </NavLink>

          <NavLink to="/staff/services" style={navLinkStyle} id="nav-services">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>
            <span>Services</span>
          </NavLink>

          <NavLink to="/staff/reports" style={navLinkStyle}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="18" y1="20" x2="18" y2="10"></line>
              <line x1="12" y1="20" x2="12" y2="4"></line>
              <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
            <span>Reports &amp; Rate</span>
          </NavLink>

          <NavLink to="/staff/qr" style={navLinkStyle}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="3" y="3" width="7" height="7"></rect>
              <rect x="14" y="3" width="7" height="7"></rect>
              <rect x="14" y="14" width="7" height="7"></rect>
              <rect x="3" y="14" width="7" height="7"></rect>
            </svg>
            <span>Check-in QR</span>
          </NavLink>

          {user?.is_superuser && (
            <>
              <NavLink to="/staff/users" style={navLinkStyle} id="nav-user-management">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                <span>User Management</span>
              </NavLink>

              <NavLink to="/staff/personnel" style={navLinkStyle} id="nav-personnel">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                <span>Personnel</span>
              </NavLink>

              <NavLink to="/staff/audit-logs" style={navLinkStyle} id="nav-audit-logs">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                <span>Audit Log</span>
              </NavLink>
            </>
          )}
        </div>

        {/* Right: User Profile & Sign Out on Top Right */}
        <div className="staff-navbar-right">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: 'var(--dole-blue)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '0.75rem',
              letterSpacing: '-0.02em',
              boxShadow: '0 1px 3px rgba(3, 5, 186, 0.25)',
            }}>
              {user?.username ? user.username.slice(0, 2).toUpperCase() : 'ST'}
            </div>
            <div className="staff-user-info">
              <div className="staff-user-name">{user?.username}</div>
              <div className="staff-user-office">
                {user?.is_superuser
                  ? 'DOLE Admin'
                  : (user?.assigned_offices?.[0]?.code || 'Staff')}
              </div>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="btn btn-outline btn-sm staff-signout-btn"
            title="Sign out of staff portal"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            <span>Sign Out</span>
          </button>
        </div>
      </nav>
    </>
  );
}
