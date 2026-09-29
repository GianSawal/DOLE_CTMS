import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';

// Public pages
import CheckIn from './pages/public/CheckIn';
import Ticket from './pages/public/Ticket';
import DisplayBoard from './pages/public/DisplayBoard';

// Staff pages
import StaffLogin from './pages/staff/StaffLogin';
import StaffQueue from './pages/staff/StaffQueue';
import StaffTransactions from './pages/staff/StaffTransactions';
import StaffReports from './pages/staff/StaffReports';
import StaffQr from './pages/staff/StaffQr';
import StaffUsers from './pages/staff/StaffUsers';
import StaffChangePassword from './pages/staff/StaffChangePassword';

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

  if (user?.must_change_password) {
    return <Navigate to="/staff/change-password" replace />;
  }

  return children;
}

function AdminRoute({ children }) {
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

  if (user?.must_change_password) {
    return <Navigate to="/staff/change-password" replace />;
  }

  if (!user?.is_superuser) {
    return <Navigate to="/staff/queue" replace />;
  }

  return children;
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
            path="/staff/queue"
            element={
              <ProtectedRoute>
                <StaffQueue />
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
            path="/staff/reports"
            element={
              <ProtectedRoute>
                <StaffReports />
              </ProtectedRoute>
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
            path="/staff/personnel"
            element={
              <AdminRoute>
                <StaffUsers />
              </AdminRoute>
            }
          />
          <Route
            path="/staff/users"
            element={
              <AdminRoute>
                <StaffUsers />
              </AdminRoute>
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
