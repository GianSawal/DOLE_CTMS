import { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ListOrdered, UsersRound, LayoutGrid, History, QrCode,
  UserCog, Layers, ChartColumn, ScrollText, LogOut, Menu, X, Building2, ChevronRight, ClipboardPen, ShieldCheck, DatabaseBackup,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import NotificationBell from './NotificationBell';
import '../staff.css';

const NAV = [
  {
    section: 'Operations',
    items: [
      { to: '/staff/queue', label: 'Queue Sample', icon: ListOrdered },
      { to: '/staff/my-clients', label: 'My Clients', icon: UsersRound },
      { to: '/staff/windows', label: 'Windows', icon: LayoutGrid },
      { to: '/staff/transactions', label: 'Transactions', icon: History },
      { to: '/staff/qr', label: 'Check-in QR', icon: QrCode },
    ],
  },
  {
    section: 'Administration',
    items: [
      { to: '/staff/users', label: 'User Management', icon: UserCog, permission: 'manage_users' },
      { to: '/staff/services', label: 'Services', icon: Layers, permission: 'manage_services' },
      { to: '/staff/reports', label: 'Reports', icon: ChartColumn, permission: 'view_reports' },
      { to: '/staff/audit-logs', label: 'Audit Log', icon: ScrollText, permission: 'view_audit_logs' },
      { to: '/staff/backups', label: 'Backups', icon: DatabaseBackup, permission: 'manage_backups' },
    ],
  },
];

// A Registration Desk account sees only its Registration page
const REGISTRATION_NAV = [
  { section: 'Operations', items: [{ to: '/staff/registration', label: 'Registration', icon: ClipboardPen }] },
];

function initials(user) {
  const name = (user?.full_name || user?.username || '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || 'ST';
}

function roleLabel(user) {
  if (user?.is_superuser) return 'System Admin';
  if (user?.role === 'REGISTRAR') return 'Registration Desk';
  if (user?.is_regional_admin) return 'Administrator';
  return user?.position || 'Personnel';
}

/** Signed-in staff shell: left navigation, top bar, and page content. */
export default function StaffLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // Close the slide-out menu after navigating on small screens
  useEffect(() => { setOpen(false); }, [location.pathname]);

  const can = (permission) => !permission || user?.is_superuser || user?.permissions?.[permission];
  const isDesk = user?.role === 'REGISTRAR';
  const nav = isDesk ? REGISTRATION_NAV : NAV;
  const sections = nav
    .map(s => ({ ...s, items: s.items.filter(i => can(i.permission)) }))
    .filter(s => s.items.length > 0);

  const current = nav.flatMap(s => s.items.map(i => ({ ...i, section: s.section })))
    .find(i => location.pathname.startsWith(i.to))
    // Opened from the sidebar footer, not the menu
    || (location.pathname.startsWith('/staff/security') ? { label: 'Account security', section: 'Account' } : undefined);
  const office = user?.primary_office || user?.assigned_offices?.[0];

  const handleLogout = () => {
    logout();
    navigate('/staff/login');
  };

  return (
    <div className="app-shell">
      <aside className={`app-sidebar${open ? ' is-open' : ''}`} aria-label="Main navigation">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <NavLink to={isDesk ? '/staff/registration' : '/staff/queue'} className="app-sidebar-brand">
            <img src="/dolelogo.png" alt="DOLE seal" />
            <span>
              <span className="app-sidebar-brand-title" style={{ display: 'block' }}>DOLE CTMS</span>
              <span className="app-sidebar-brand-sub" style={{ display: 'block' }}>Client Transaction Monitoring</span>
            </span>
          </NavLink>
          <button className="app-sidebar-close" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="app-nav">
          {sections.map(s => (
            <div key={s.section}>
              <div className="app-nav-section">{s.section}</div>
              {s.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="app-sidebar-footer">
          <div className="app-user">
            <div className="app-avatar" aria-hidden="true">{initials(user)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="app-user-name">{user?.full_name || user?.username}</div>
              <div className="app-user-meta">{roleLabel(user)}{office?.code ? ` · ${office.code}` : ''}</div>
            </div>
          </div>
          {user?.role !== 'REGISTRAR' && (
            <NavLink to="/staff/security" className="app-security-link"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'rgba(255,255,255,0.75)', textDecoration: 'none', margin: '0 0 0.5rem' }}>
              <ShieldCheck size={14} aria-hidden="true" /> Account security
            </NavLink>
          )}
          <button className="app-signout" onClick={handleLogout}>
            <LogOut size={15} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>

      <div className={`app-backdrop${open ? ' is-open' : ''}`} onClick={() => setOpen(false)} />

      <div className="app-main">
        <header className="app-topbar">
          <button className="app-menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div className="app-breadcrumb">
            {current ? (
              <>
                <span>{current.section}</span>
                <ChevronRight size={14} aria-hidden="true" />
                <strong>{current.label}</strong>
              </>
            ) : <strong>DOLE CTMS</strong>}
          </div>
          <div className="app-topbar-right">
            {office && (
              <span className="app-office-chip" title={office.name}>
                <Building2 aria-hidden="true" />
                {office.name}{user?.office_type === 'REGIONAL' ? ' · Regional' : ''}
              </span>
            )}
            <NotificationBell />
          </div>
        </header>
        <div className="app-content">{children}</div>
      </div>
    </div>
  );
}
