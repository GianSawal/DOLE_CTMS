import React, { useState, useEffect, useMemo } from 'react';
import Navbar from '../../components/Navbar';
import { staffApi } from '../../api/staff';

const TARGET_DIVISIONS = [
  { key: 'TSSD 1', alias: 'TSSD1', label: 'TSSD 1', fullName: 'Technical Support Services Division 1', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  { key: 'TSSD 2', alias: 'TSSD2', label: 'TSSD 2', fullName: 'Technical Support Services Division 2', color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd' },
  { key: 'IMSD', alias: 'IMSD', label: 'IMSD', fullName: 'Internal Management Services Division', color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  { key: 'MALSU', alias: 'MALSU', label: 'MALSU', fullName: 'Mediation Arbitration and Legal Services Unit', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
];

export default function StaffUsers() {
  const [users, setUsers] = useState([]);
  const [offices, setOffices] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [officeFilter, setOfficeFilter] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');

  // Toast / notification
  const [toast, setToast] = useState(null);

  // Success alert modal after creating an account
  const [createdAccountInfo, setCreatedAccountInfo] = useState(null);

  // Add / Edit Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' | 'edit'
  const [editingId, setEditingId] = useState(null);

  // Form Fields
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState('staff'); // 'staff' | 'admin'
  const [officeId, setOfficeId] = useState('');
  const [selectedDivisionIds, setSelectedDivisionIds] = useState([]);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Reset Password Modal
  const [resetModalUser, setResetModalUser] = useState(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);

  // Delete Confirmation Modal
  const [deleteModalUser, setDeleteModalUser] = useState(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [uRes, offRes, divRes] = await Promise.allSettled([
        staffApi.getEmployees(),
        staffApi.getOffices(),
        staffApi.getDivisions(),
      ]);

      if (uRes.status === 'fulfilled') {
        setUsers(Array.isArray(uRes.value) ? uRes.value : []);
      }
      if (offRes.status === 'fulfilled') {
        setOffices(Array.isArray(offRes.value) ? offRes.value : []);
      }
      if (divRes.status === 'fulfilled') {
        setDivisions(Array.isArray(divRes.value) ? divRes.value : []);
      }
    } catch (err) {
      showToast(err.message || 'Failed to load user accounts data', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Map divisions from backend to target checklist
  const divisionMap = useMemo(() => {
    const map = {};
    divisions.forEach((div) => {
      const name = div.name.trim();
      map[name] = div.id;
      if (name === 'TSSD 1') map['TSSD1'] = div.id;
      if (name === 'TSSD 2') map['TSSD2'] = div.id;
    });
    return map;
  }, [divisions]);

  // Open Create Modal
  const openCreateModal = () => {
    setModalMode('create');
    setEditingId(null);
    setUsername('');
    setFirstName('');
    setLastName('');
    setRole('staff');
    setOfficeId(offices[0]?.id || '');
    setSelectedDivisionIds([]);
    setPassword('');
    setShowPassword(false);
    setShowModal(true);
  };

  // Open Edit Modal
  const openEditModal = (u) => {
    setModalMode('edit');
    setEditingId(u.id);
    setUsername(u.username || '');
    setFirstName(u.first_name || '');
    setLastName(u.last_name || '');
    setRole(u.is_superuser ? 'admin' : 'staff');
    setOfficeId(u.office || '');

    const currentDivIds = u.division_ids || [];
    setSelectedDivisionIds(currentDivIds);
    setPassword('');
    setShowPassword(false);
    setShowModal(true);
  };

  // Toggle division selection
  const handleToggleDivision = (divKey, divAlias) => {
    let targetId = divisionMap[divKey] || divisionMap[divAlias];
    if (!targetId) {
      const found = divisions.find(
        (d) => d.name.toLowerCase() === divKey.toLowerCase() || d.name.toLowerCase() === divAlias.toLowerCase()
      );
      if (found) targetId = found.id;
    }

    if (!targetId) return;

    setSelectedDivisionIds((prev) => {
      if (prev.includes(targetId)) {
        return prev.filter((id) => id !== targetId);
      } else {
        return [...prev, targetId];
      }
    });
  };

  // Submit Add / Edit Form
  const handleSubmitForm = async (e) => {
    e.preventDefault();
    if (!username.trim()) {
      showToast('Username is required.', 'error');
      return;
    }
    if (modalMode === 'create' && !password.trim()) {
      showToast('Password is required for creating a new user account.', 'error');
      return;
    }
    if (!officeId) {
      showToast('Please select an Office.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      if (modalMode === 'create') {
        const payload = {
          username: username.trim(),
          password: password.trim(),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          role: role,
          office: officeId,
          division_ids: selectedDivisionIds,
        };
        await staffApi.createEmployee(payload);

        setCreatedAccountInfo({
          name: `${firstName.trim()} ${lastName.trim()}`.trim() || username.trim(),
          username: username.trim(),
          password: password.trim(),
          role: role === 'admin' ? 'Administrator' : 'Staff',
          office: offices.find((o) => String(o.id) === String(officeId))?.name || 'Assigned Office',
        });

        showToast(`User account '${username.trim()}' created successfully!`);
      } else {
        const payload = {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          role: role,
          office: officeId,
          division_ids: selectedDivisionIds,
        };
        if (password.trim()) {
          payload.password = password.trim();
        }
        await staffApi.updateEmployee(editingId, payload);
        showToast(`User account '${username}' updated successfully.`);
      }
      setShowModal(false);
      loadData();
    } catch (err) {
      showToast(err.message || 'Operation failed. Please check inputs and try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Reset Password Modal
  const openResetPasswordModal = (u) => {
    setResetModalUser(u);
    setNewPasswordInput('');
  };

  const handleConfirmResetPassword = async () => {
    if (!resetModalUser) return;
    if (!newPasswordInput.trim()) {
      showToast('Please enter a new password.', 'error');
      return;
    }
    setResetSubmitting(true);
    try {
      const res = await staffApi.resetEmployeePassword(resetModalUser.id, newPasswordInput.trim());
      showToast(res.message || `Password for ${resetModalUser.username} has been reset.`);
      setResetModalUser(null);
    } catch (err) {
      showToast(err.message || 'Failed to reset password', 'error');
    } finally {
      setResetSubmitting(false);
    }
  };

  // Toggle Active Status
  const handleToggleActive = async (u) => {
    try {
      const res = await staffApi.toggleEmployeeActive(u.id);
      showToast(`Account ${u.username} is now ${res.is_active ? 'Active' : 'Inactive'}.`);
      setUsers((prev) =>
        prev.map((item) => (item.id === u.id ? { ...item, is_active: res.is_active } : item))
      );
    } catch (err) {
      showToast(err.message || 'Failed to toggle account status', 'error');
    }
  };

  // Delete Confirmation Modal
  const openDeleteModal = (u) => {
    setDeleteModalUser(u);
  };

  const handleConfirmDelete = async () => {
    if (!deleteModalUser) return;
    setDeleteSubmitting(true);
    try {
      await staffApi.deleteEmployee(deleteModalUser.id);
      showToast(`Account ${deleteModalUser.username} deleted.`);
      setDeleteModalUser(null);
      setUsers((prev) => prev.filter((item) => item.id !== deleteModalUser.id));
    } catch (err) {
      showToast(err.message || 'Failed to delete account', 'error');
    } finally {
      setDeleteSubmitting(false);
    }
  };

  // Filtered users list
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (u.username && u.username.toLowerCase().includes(q)) ||
        (u.first_name && u.first_name.toLowerCase().includes(q)) ||
        (u.last_name && u.last_name.toLowerCase().includes(q)) ||
        (u.office_name && u.office_name.toLowerCase().includes(q));

      const matchesOffice = !officeFilter || String(u.office) === String(officeFilter);

      const matchesDivision =
        !divisionFilter ||
        (u.division_names && u.division_names.some((d) => d.toLowerCase().includes(divisionFilter.toLowerCase())));

      return matchesSearch && matchesOffice && matchesDivision;
    });
  }, [users, searchQuery, officeFilter, divisionFilter]);

  // Summary counts
  const totalUsers = users.length;
  const activeCount = users.filter((u) => u.is_active).length;
  const adminCount = users.filter((u) => u.is_superuser).length;
  const staffCount = users.filter((u) => !u.is_superuser).length;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-ground)', display: 'flex', flexDirection: 'column' }}>
      <Navbar />

      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 9999,
            backgroundColor: toast.type === 'error' ? 'var(--dole-red)' : 'var(--dole-green)',
            color: '#fff',
            padding: '0.85rem 1.4rem',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            fontWeight: 600,
            fontSize: '0.92rem',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <span>{toast.type === 'error' ? '⚠️' : '✅'}</span>
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              fontSize: '1.1rem',
              cursor: 'pointer',
              marginLeft: '0.5rem',
              minHeight: 'auto',
              padding: 0,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Account Creation Success Dialog */}
      {createdAccountInfo && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(17, 24, 39, 0.65)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            padding: '1rem',
          }}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: 'var(--radius-lg)',
              maxWidth: '480px',
              width: '100%',
              padding: '1.75rem',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
              border: '2px solid var(--dole-green)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🎉</div>
            <h3 style={{ fontSize: '1.3rem', color: 'var(--dole-green)', margin: '0 0 0.5rem 0', fontWeight: 800 }}>
              User Account Created!
            </h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              The login account for <strong>{createdAccountInfo.name}</strong> was created. They can now log in using these credentials:
            </p>

            <div
              style={{
                backgroundColor: 'var(--bg-ground)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '1rem 1.25rem',
                textAlign: 'left',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Username:</span>
                <span className="mono" style={{ fontWeight: 800, color: 'var(--dole-blue)', fontSize: '0.95rem' }}>
                  {createdAccountInfo.username}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Password:</span>
                <span className="mono" style={{ fontWeight: 800, color: 'var(--dole-red)', fontSize: '0.95rem' }}>
                  {createdAccountInfo.password}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Role:</span>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                  {createdAccountInfo.role}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Office:</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                  {createdAccountInfo.office}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setCreatedAccountInfo(null)}
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.75rem', fontWeight: 700 }}
            >
              Done & Return to User List
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
        {/* Page Header */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.75rem' }}>👥</span>
              <h1 style={{ fontSize: '1.6rem', color: 'var(--text-primary)', margin: 0, fontWeight: 800 }}>
                User Accounts Management
              </h1>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  padding: '0.2rem 0.6rem',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: 'var(--dole-red-light)',
                  color: 'var(--dole-red)',
                  border: '1px solid #fecaca',
                  textTransform: 'uppercase',
                }}
              >
                Admin Only
              </span>
            </div>
            <p style={{ margin: '0.35rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Manage login accounts, credentials, and office access for DOLE staff. Personnel who assist clients are managed in the <strong>Personnel</strong> tab.
            </p>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="btn btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1.25rem',
              fontSize: '0.92rem',
              fontWeight: 700,
              backgroundColor: 'var(--dole-blue)',
              color: '#fff',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <span>➕</span> Create User Account
          </button>
        </div>

        {/* Stats Summary Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              padding: '1.1rem 1.25rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Total User Accounts
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
              {totalUsers}
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              padding: '1.1rem 1.25rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Active Logins
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--dole-green)', marginTop: '0.2rem' }}>
              {activeCount}
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              padding: '1.1rem 1.25rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Administrators
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#7c3aed', marginTop: '0.2rem' }}>
              {adminCount}
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              padding: '1.1rem 1.25rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Staff Accounts
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--dole-blue)', marginTop: '0.2rem' }}>
              {staffCount}
            </div>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div
          style={{
            backgroundColor: 'var(--bg-card)',
            padding: '1rem 1.25rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <div style={{ flex: '1 1 240px', position: 'relative' }}>
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              🔍
            </span>
            <input
              type="text"
              placeholder="Search by username or account name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem 0.55rem 2.2rem',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                fontSize: '0.88rem',
                backgroundColor: 'var(--bg-ground)',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ minWidth: '180px' }}>
            <select
              value={officeFilter}
              onChange={(e) => setOfficeFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                fontSize: '0.88rem',
                backgroundColor: 'var(--bg-ground)',
                outline: 'none',
              }}
            >
              <option value="">All Offices</option>
              {offices.map((off) => (
                <option key={off.id} value={off.id}>
                  {off.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ minWidth: '150px' }}>
            <select
              value={divisionFilter}
              onChange={(e) => setDivisionFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                fontSize: '0.88rem',
                backgroundColor: 'var(--bg-ground)',
                outline: 'none',
              }}
            >
              <option value="">All Divisions</option>
              <option value="TSSD 1">TSSD 1</option>
              <option value="TSSD 2">TSSD 2</option>
              <option value="IMSD">IMSD</option>
              <option value="MALSU">MALSU</option>
            </select>
          </div>

          <button
            type="button"
            onClick={loadData}
            title="Refresh table"
            style={{
              padding: '0.55rem 0.95rem',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-secondary)',
              fontSize: '0.88rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              minHeight: 'auto',
            }}
          >
            🔄 Refresh
          </button>
        </div>

        {/* Users Table */}
        <div
          style={{
            backgroundColor: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-sm)',
            overflow: 'hidden',
          }}
        >
          {loading ? (
            <div style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>⏳</div>
              <p>Loading user accounts...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📂</div>
              <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>No user accounts found</p>
              <p style={{ fontSize: '0.88rem', marginTop: '0.25rem' }}>
                {searchQuery || officeFilter || divisionFilter
                  ? 'Try adjusting your search filters.'
                  : 'Get started by clicking "+ Create User Account" above.'}
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-ground)', borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Login Username</th>
                    <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Account Name</th>
                    <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Role</th>
                    <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Assigned Office</th>
                    <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                      Assigned Division(s)
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', fontWeight: 400 }}>
                        (Dictates Queue Access)
                      </span>
                    </th>
                    <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Status</th>
                    <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: 'var(--text-secondary)', textAlign: 'right' }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => {
                    return (
                      <tr
                        key={u.id}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          transition: 'background-color 0.15s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--dole-blue-subtle)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        {/* Username */}
                        <td style={{ padding: '0.85rem 1rem' }}>
                          <span
                            className="mono"
                            style={{
                              backgroundColor: 'var(--bg-ground)',
                              padding: '0.25rem 0.55rem',
                              borderRadius: 'var(--radius-sm)',
                              fontWeight: 700,
                              color: 'var(--dole-blue)',
                              fontSize: '0.86rem',
                              border: '1px solid var(--border-color)',
                            }}
                          >
                            {u.username}
                          </span>
                        </td>

                        {/* Full Name */}
                        <td style={{ padding: '0.85rem 1rem' }}>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                            {u.full_name || (u.first_name ? `${u.first_name} ${u.last_name || ''}`.trim() : u.username)}
                          </div>
                        </td>

                        {/* Role */}
                        <td style={{ padding: '0.85rem 1rem' }}>
                          {u.is_superuser ? (
                            <span
                              style={{
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                padding: '0.2rem 0.55rem',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: '#f5f3ff',
                                color: '#7c3aed',
                                border: '1px solid #ddd6fe',
                              }}
                            >
                              👑 Administrator
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                padding: '0.2rem 0.55rem',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: '#eff6ff',
                                color: '#1d4ed8',
                                border: '1px solid #bfdbfe',
                              }}
                            >
                              👤 Staff User
                            </span>
                          )}
                        </td>

                        {/* Office */}
                        <td style={{ padding: '0.85rem 1rem' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{u.office_name}</div>
                        </td>

                        {/* Assigned Divisions */}
                        <td style={{ padding: '0.85rem 1rem' }}>
                          {u.is_superuser ? (
                            <span
                              style={{
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                padding: '0.2rem 0.5rem',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: '#ecfdf5',
                                color: '#047857',
                                border: '1px solid #a7f3d0',
                              }}
                            >
                              🌟 All Divisions Access
                            </span>
                          ) : u.division_names && u.division_names.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                              {u.division_names.map((divName) => {
                                const targetDiv = TARGET_DIVISIONS.find(
                                  (t) => t.key.toLowerCase() === divName.toLowerCase() || t.alias.toLowerCase() === divName.toLowerCase()
                                );
                                const color = targetDiv?.color || '#374151';
                                const bg = targetDiv?.bg || '#f3f4f6';
                                const border = targetDiv?.border || '#e5e7eb';
                                return (
                                  <span
                                    key={divName}
                                    style={{
                                      fontSize: '0.75rem',
                                      fontWeight: 700,
                                      padding: '0.2rem 0.5rem',
                                      borderRadius: 'var(--radius-sm)',
                                      color: color,
                                      backgroundColor: bg,
                                      border: `1px solid ${border}`,
                                    }}
                                  >
                                    {divName}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <span
                              style={{
                                fontSize: '0.75rem',
                                color: '#991b1b',
                                backgroundColor: '#fef2f2',
                                padding: '0.2rem 0.5rem',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid #fecaca',
                                fontWeight: 600,
                              }}
                            >
                              ⚠️ No Division Assigned
                            </span>
                          )}
                        </td>

                        {/* Status */}
                        <td style={{ padding: '0.85rem 1rem' }}>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(u)}
                            title="Click to toggle active status"
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              padding: '0.2rem 0.55rem',
                              borderRadius: 'var(--radius-full)',
                              border: 'none',
                              cursor: 'pointer',
                              backgroundColor: u.is_active ? 'var(--dole-green-light)' : 'var(--dole-red-light)',
                              color: u.is_active ? 'var(--dole-green)' : 'var(--dole-red)',
                              minHeight: 'auto',
                            }}
                          >
                            {u.is_active ? '● Active' : '○ Inactive'}
                          </button>
                        </td>

                        {/* Actions */}
                        <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              onClick={() => openEditModal(u)}
                              className="btn btn-outline"
                              title="Edit user account"
                              style={{
                                minHeight: 'auto',
                                padding: '0.35rem 0.65rem',
                                fontSize: '0.8rem',
                                borderRadius: 'var(--radius-sm)',
                                color: 'var(--dole-blue)',
                                border: '1px solid var(--border-color)',
                              }}
                            >
                              ✏️ Edit
                            </button>

                            <button
                              type="button"
                              onClick={() => openResetPasswordModal(u)}
                              className="btn btn-outline"
                              title="Reset account password"
                              style={{
                                minHeight: 'auto',
                                padding: '0.35rem 0.65rem',
                                fontSize: '0.8rem',
                                borderRadius: 'var(--radius-sm)',
                                color: 'var(--dole-gold-dark)',
                                border: '1px solid var(--border-color)',
                              }}
                            >
                              🔑 Reset Pass
                            </button>

                            <button
                              type="button"
                              onClick={() => openDeleteModal(u)}
                              className="btn btn-outline"
                              title="Delete user account"
                              style={{
                                minHeight: 'auto',
                                padding: '0.35rem 0.65rem',
                                fontSize: '0.8rem',
                                borderRadius: 'var(--radius-sm)',
                                color: 'var(--dole-red)',
                                border: '1px solid var(--border-color)',
                              }}
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Modal: Add / Edit User Account */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(17, 24, 39, 0.6)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              maxWidth: '600px',
              width: '100%',
              maxHeight: '92vh',
              overflowY: 'auto',
              boxShadow: '0 20px 45px rgba(0,0,0,0.22)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '1.25rem 1.5rem',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: 'var(--bg-ground)',
                borderTopLeftRadius: 'var(--radius-lg)',
                borderTopRightRadius: 'var(--radius-lg)',
              }}
            >
              <div>
                <h2 style={{ fontSize: '1.2rem', color: 'var(--text-primary)', margin: 0 }}>
                  {modalMode === 'create' ? '➕ Create User Account' : `✏️ Edit Account (${username})`}
                </h2>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  {modalMode === 'create'
                    ? 'Configure login credentials, role, office, and division queue access.'
                    : 'Update account details, role, and division queue permissions.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.25rem',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: '0.25rem',
                  minHeight: 'auto',
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmitForm} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Row 1: Username & Role */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
                <div>
                  <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                    Login Username <span style={{ color: 'var(--dole-red)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    disabled={modalMode === 'edit'}
                    placeholder="e.g. staff_pampanga"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.replace(/\s+/g, ''))}
                    className="mono"
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.88rem',
                      fontWeight: 700,
                      backgroundColor: modalMode === 'edit' ? 'var(--bg-ground)' : '#fff',
                      outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    {modalMode === 'create' ? 'Unique login ID used to sign in.' : 'Username cannot be modified.'}
                  </span>
                </div>

                <div>
                  <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                    Account Role <span style={{ color: 'var(--dole-red)' }}>*</span>
                  </label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.88rem',
                      outline: 'none',
                      backgroundColor: '#fff',
                    }}
                  >
                    <option value="staff">👤 Staff User (Queue & Counter Access)</option>
                    <option value="admin">👑 Administrator (Full System Access)</option>
                  </select>
                </div>
              </div>

              {/* Row 2: Account Owner Name */}
              <div>
                <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                  Account Owner / Full Name (Optional)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <input
                    type="text"
                    placeholder="First Name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.88rem',
                      outline: 'none',
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Last Name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.88rem',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              {/* Row 3: Office Field */}
              <div>
                <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                  DOLE Office Assignment <span style={{ color: 'var(--dole-red)' }}>*</span>
                </label>
                <select
                  required
                  value={officeId}
                  onChange={(e) => setOfficeId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.9rem',
                    backgroundColor: '#fff',
                    outline: 'none',
                  }}
                >
                  <option value="" disabled>-- Select DOLE Office --</option>
                  {offices.map((off) => (
                    <option key={off.id} value={off.id}>
                      {off.name} {off.code ? `(${off.code})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Row 4: Password Field (Required for create, optional for edit) */}
              <div>
                <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                  {modalMode === 'create' ? 'Initial Login Password *' : 'Change Password (Leave blank to keep current)'}
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required={modalMode === 'create'}
                    placeholder={modalMode === 'create' ? 'Enter login password...' : 'Enter new password to change...'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mono"
                    style={{
                      width: '100%',
                      padding: '0.65rem 2.5rem 0.65rem 0.8rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.88rem',
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      fontSize: '1rem',
                      padding: '0.2rem',
                    }}
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              {/* Row 5: Division Queue Access Checklist */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)', margin: 0 }}>
                    Assigned Division(s) & Queue Counter Lines
                  </label>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    Dictates which division queue services this staff can serve
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: '0.65rem',
                  }}
                >
                  {TARGET_DIVISIONS.map((tDiv) => {
                    const targetId = divisionMap[tDiv.key] || divisionMap[tDiv.alias];
                    const isChecked = Boolean(targetId && selectedDivisionIds.includes(targetId));

                    return (
                      <div
                        key={tDiv.key}
                        onClick={() => handleToggleDivision(tDiv.key, tDiv.alias)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.65rem',
                          padding: '0.65rem 0.85rem',
                          borderRadius: 'var(--radius-md)',
                          border: isChecked ? `2px solid ${tDiv.color}` : '1px solid var(--border-color)',
                          backgroundColor: isChecked ? tDiv.bg : 'var(--bg-ground)',
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // Handled by card click
                          style={{
                            width: '16px',
                            height: '16px',
                            accentColor: tDiv.color,
                            cursor: 'pointer',
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, color: isChecked ? tDiv.color : 'var(--text-primary)', fontSize: '0.84rem' }}>
                            {tDiv.label}
                          </div>
                          <div
                            style={{
                              fontSize: '0.72rem',
                              color: 'var(--text-muted)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={tDiv.fullName}
                          >
                            {tDiv.fullName}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action Buttons */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.75rem',
                  marginTop: '0.5rem',
                  paddingTop: '1rem',
                  borderTop: '1px solid var(--border-color)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn btn-outline"
                  disabled={submitting}
                  style={{ padding: '0.65rem 1.25rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                  style={{
                    padding: '0.65rem 1.5rem',
                    backgroundColor: 'var(--dole-blue)',
                    color: '#fff',
                    fontWeight: 700,
                  }}
                >
                  {submitting
                    ? 'Saving...'
                    : modalMode === 'create'
                    ? '💾 Create Account'
                    : '💾 Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reset Password */}
      {resetModalUser && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(17, 24, 39, 0.6)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              maxWidth: '440px',
              width: '100%',
              padding: '1.5rem',
              boxShadow: '0 20px 45px rgba(0,0,0,0.22)',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.85rem' }}>
              <span style={{ fontSize: '1.4rem' }}>🔑</span>
              <h3 style={{ fontSize: '1.15rem', color: 'var(--text-primary)', margin: 0, fontWeight: 800 }}>
                Reset Password
              </h3>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
              Set a new password for account <strong>{resetModalUser.username}</strong> ({resetModalUser.full_name}):
            </p>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem' }}>
                New Password
              </label>
              <input
                type="text"
                value={newPasswordInput}
                onChange={(e) => setNewPasswordInput(e.target.value)}
                placeholder="Enter new password..."
                className="mono"
                style={{
                  width: '100%',
                  padding: '0.65rem 0.8rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
              <button
                type="button"
                onClick={() => setResetModalUser(null)}
                className="btn btn-outline"
                disabled={resetSubmitting}
                style={{ padding: '0.55rem 1rem' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmResetPassword}
                className="btn btn-primary"
                disabled={resetSubmitting || !newPasswordInput.trim()}
                style={{
                  padding: '0.55rem 1.25rem',
                  backgroundColor: 'var(--dole-gold-dark)',
                  color: '#fff',
                  fontWeight: 700,
                }}
              >
                {resetSubmitting ? 'Resetting...' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Delete Confirmation */}
      {deleteModalUser && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(17, 24, 39, 0.6)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              maxWidth: '440px',
              width: '100%',
              padding: '1.5rem',
              boxShadow: '0 20px 45px rgba(0,0,0,0.22)',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.85rem' }}>
              <span style={{ fontSize: '1.4rem' }}>🗑️</span>
              <h3 style={{ fontSize: '1.15rem', color: 'var(--dole-red)', margin: 0, fontWeight: 800 }}>
                Delete User Account
              </h3>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
              Are you sure you want to delete user account <strong>{deleteModalUser.username}</strong> ({deleteModalUser.full_name})? This will permanently remove their login access.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
              <button
                type="button"
                onClick={() => setDeleteModalUser(null)}
                className="btn btn-outline"
                disabled={deleteSubmitting}
                style={{ padding: '0.55rem 1rem' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="btn btn-primary"
                disabled={deleteSubmitting}
                style={{
                  padding: '0.55rem 1.25rem',
                  backgroundColor: 'var(--dole-red)',
                  color: '#fff',
                  fontWeight: 700,
                }}
              >
                {deleteSubmitting ? 'Deleting...' : 'Yes, Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
