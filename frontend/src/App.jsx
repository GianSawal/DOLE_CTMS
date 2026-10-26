import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import StaffLayout from './components/StaffLayout';

// Public pages
import CheckIn from './pages/public/CheckIn';
import Ticket from './pages/public/Ticket';
import DisplayBoard from './pages/public/DisplayBoard';

// Staff pages
import StaffLogin from './pages/staff/StaffLogin';
import StaffQueue from './pages/staff/StaffQueue';
import StaffWindows from './pages/staff/StaffWindows';
import StaffMyClients from './pages/staff/StaffMyClients';
import StaffTransactions from './pages/staff/StaffTransactions';
import StaffServices from './pages/staff/StaffServices';
import StaffReports from './pages/staff/StaffReports';
import StaffQr from './pages/staff/StaffQr';
import StaffUsers from './pages/staff/StaffUsers';
import StaffAuditLogs from './pages/staff/StaffAuditLogs';
import StaffChangePassword from './pages/staff/StaffChangePassword';
import StaffRegistration from './pages/staff/StaffRegistration';
import StaffSecurity from './pages/staff/StaffSecurity';

// Where a signed-in TV Display account belongs: its office's TV board (never the staff pages)
function tvDisplayRedirect(user) {
  if (user?.role !== 'DISPLAY') return null;
  return <Navigate to={user.display?.url || '/staff/login'} replace />;
}

// A Registration Desk account only has the Registration page
function registrationRedirect(user) {
  if (user?.role !== 'REGISTRAR') return null;
  return <Navigate to="/staff/registration" replace />;
}

function RegistrationRoute({ children }) {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Verifying credentials...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/staff/login" replace />;
  }

  const tv = tvDisplayRedirect(user);
  if (tv) return tv;

  if (user?.must_change_password) {
    return <Navigate to="/staff/change-password" replace />;
  }

  return <StaffLayout>{children}</StaffLayout>;
}

function ProtectedRoute({ children }) {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Verifying credentials...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/staff/login" replace />;
  }

  const tv = tvDisplayRedirect(user);
  if (tv) return tv;

  if (user?.must_change_password) {
    return <Navigate to="/staff/change-password" replace />;
  }

  const desk = registrationRedirect(user);
  if (desk) return desk;

  return <StaffLayout>{children}</StaffLayout>;
}

function PermissionRoute({ permission, children }) {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Verifying credentials...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/staff/login" replace />;
  }

  const tv = tvDisplayRedirect(user);
  if (tv) return tv;

  if (user?.must_change_password) {
    return <Navigate to="/staff/change-password" replace />;
  }

  const desk = registrationRedirect(user);
  if (desk) return desk;

  // Mirrors the API's role checks; the server rejects these requests regardless.
  if (!user?.is_superuser && !user?.permissions?.[permission]) {
    return <Navigate to="/staff/queue" replace />;
  }

  return <StaffLayout>{children}</StaffLayout>;
}

function ChangePasswordRoute({ children }) {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Verifying credentials...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/staff/login" replace />;
  }

  const tv = tvDisplayRedirect(user);
  if (tv) return tv;

  if (!user?.must_change_password) {
    return <Navigate to="/staff/queue" replace />;
  }

  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/checkin/office/:officeId" element={<CheckIn />} />
          <Route path="/t/:ticketToken" element={<Ticket />} />
          <Route path="/display/office/:officeId" element={<DisplayBoard />} />

          {/* Staff Auth & Protected Routes */}
          <Route path="/staff/login" element={<StaffLogin />} />
          <Route
            path="/staff/registration"
            element={
              <RegistrationRoute>
                <StaffRegistration />
              </RegistrationRoute>
            }
          />
          <Route
            path="/staff/queue"
            element={
              <ProtectedRoute>
                <StaffQueue />
              </ProtectedRoute>
            }
          />
          <Route
            path="/staff/security"
            element={
              <ProtectedRoute>
                <StaffSecurity />
              </ProtectedRoute>
            }
          />
          <Route
            path="/staff/my-clients"
            element={
              <ProtectedRoute>
                <StaffMyClients />
              </ProtectedRoute>
            }
          />
          <Route
            path="/staff/windows"
            element={
              <ProtectedRoute>
                <StaffWindows />
              </ProtectedRoute>
            }
          />
          <Route
            path="/staff/transactions"
            element={
              <ProtectedRoute>
                <StaffTransactions />
              </ProtectedRoute>
            }
          />
          <Route
            path="/staff/services"
            element={
              <PermissionRoute permission="manage_services">
                <StaffServices />
              </PermissionRoute>
            }
          />
          <Route
            path="/staff/reports"
            element={
              <PermissionRoute permission="view_reports">
                <StaffReports />
              </PermissionRoute>
            }
          />
          <Route
            path="/staff/qr"
            element={
              <ProtectedRoute>
                <StaffQr />
              </ProtectedRoute>
            }
          />
          <Route
            path="/staff/users"
            element={
              <PermissionRoute permission="manage_users">
                <StaffUsers />
              </PermissionRoute>
            }
          />
          <Route
            path="/staff/audit-logs"
            element={
              <PermissionRoute permission="view_audit_logs">
                <StaffAuditLogs />
              </PermissionRoute>
            }
          />
          <Route
            path="/staff/change-password"
            element={
              <ChangePasswordRoute>
                <StaffChangePassword />
              </ChangePasswordRoute>
            }
          />

          {/* Default Root Route */}
          <Route path="/" element={<Navigate to="/staff/queue" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
