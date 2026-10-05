import React, { useState, useEffect, useMemo } from 'react';
import Navbar from '../../components/Navbar';
import { staffApi } from '../../api/staff';
import Pagination, { paginateArray } from '../../components/Pagination';

const ITEMS_PER_PAGE = 10;

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
  const [currentPage, setCurrentPage] = useState(1);

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
  const [selectedOfficeIds, setSelectedOfficeIds] = useState([]);
  const [allOfficesSelected, setAllOfficesSelected] = useState(false);
  const [selectedDivisionIds, setSelectedDivisionIds] = useState([]);
  const [allDivisionsSelected, setAllDivisionsSelected] = useState(false);
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

  // Handle role change (staff <-> admin)
  const handleRoleChange = (newRole) => {
    setRole(newRole);
    if (newRole === 'admin') {
      // By default when choosing an ADMIN role, grant access to all offices & all divisions
      setAllOfficesSelected(true);
      setSelectedOfficeIds(offices.map((o) => o.id));
      setAllDivisionsSelected(true);
      const allDivIds = divisions.map((d) => d.id);
      setSelectedDivisionIds(
        allDivIds.length > 0
          ? allDivIds
          : TARGET_DIVISIONS.map((td) => divisionMap[td.key] || divisionMap[td.alias]).filter(Boolean)
      );
    } else {
      setAllOfficesSelected(false);
      setAllDivisionsSelected(false);
      if (selectedOfficeIds.length > 0) {
        setOfficeId(selectedOfficeIds[0]);
      } else if (offices.length > 0) {
        setOfficeId(offices[0].id);
      }
    }
  };

  // Toggle individual office selection
  const handleToggleOffice = (id) => {
    setSelectedOfficeIds((prev) => {
      let updated;
      if (prev.includes(id)) {
        updated = prev.filter((oId) => oId !== id);
      } else {
        updated = [...prev, id];
      }
      setAllOfficesSelected(updated.length === offices.length && offices.length > 0);
      return updated;
    });
  };

  // Toggle All Offices
  const handleToggleAllOffices = () => {
    if (allOfficesSelected) {
      setAllOfficesSelected(false);
      setSelectedOfficeIds([]);
    } else {
      setAllOfficesSelected(true);
      setSelectedOfficeIds(offices.map((o) => o.id));
    }
  };

  // Toggle All Divisions
  const handleToggleAllDivisions = () => {
    if (allDivisionsSelected) {
      setAllDivisionsSelected(false);
      setSelectedDivisionIds([]);
    } else {
      setAllDivisionsSelected(true);
      const allDivIds = divisions.map((d) => d.id);
      setSelectedDivisionIds(
        allDivIds.length > 0
          ? allDivIds
          : TARGET_DIVISIONS.map((td) => divisionMap[td.key] || divisionMap[td.alias]).filter(Boolean)
      );
    }
  };

  // Open Create Modal
  const openCreateModal = () => {
    setModalMode('create');
    setEditingId(null);
    setUsername('');
    setFirstName('');
    setLastName('');
    setRole('staff');
    setOfficeId(offices[0]?.id || '');
    setSelectedOfficeIds(offices[0] ? [offices[0].id] : []);
    setAllOfficesSelected(false);
    setSelectedDivisionIds([]);
    setAllDivisionsSelected(false);
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
    const isAdmin = Boolean(u.is_superuser);
    setRole(isAdmin ? 'admin' : 'staff');

    // Office assignments
    const userOffIds = Array.isArray(u.office_ids) && u.office_ids.length > 0
      ? u.office_ids
      : (u.office ? [u.office] : []);

    if (isAdmin) {
      const isAllOffices = Boolean(
        u.all_offices_access ||
        u.office_name === 'All Offices' ||
        (userOffIds.length >= offices.length && offices.length > 0)
      );
      setAllOfficesSelected(isAllOffices);
      setSelectedOfficeIds(isAllOffices ? offices.map((o) => o.id) : userOffIds);
    } else {
      setAllOfficesSelected(false);
      setSelectedOfficeIds(userOffIds);
      setOfficeId(u.office || offices[0]?.id || '');
    }

    // Division assignments
    const currentDivIds = Array.isArray(u.division_ids) ? u.division_ids : [];
    if (isAdmin) {
      const isAllDivs = Boolean(
        u.all_divisions_access ||
        (currentDivIds.length >= divisions.length && divisions.length > 0)
      );
      setAllDivisionsSelected(isAllDivs);
      setSelectedDivisionIds(isAllDivs ? divisions.map((d) => d.id) : currentDivIds);
    } else {
      setAllDivisionsSelected(false);
      setSelectedDivisionIds(currentDivIds);
    }

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
      let updated;
      if (prev.includes(targetId)) {
        updated = prev.filter((id) => id !== targetId);
      } else {
        updated = [...prev, targetId];
      }
      setAllDivisionsSelected(updated.length === TARGET_DIVISIONS.length && TARGET_DIVISIONS.length > 0);
      return updated;
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

    const isAdmin = role === 'admin';
    if (isAdmin) {
      if (!allOfficesSelected && selectedOfficeIds.length === 0) {
        showToast('Please select at least one Office for this Administrator account.', 'error');
        return;
      }
    } else {
      if (!officeId) {
        showToast('Please select an Office.', 'error');
        return;
      }
      if (selectedDivisionIds.length === 0) {
        showToast('Please select at least one Division queue line.', 'error');
        return;
      }
    }

    setSubmitting(true);
    try {
      const effectiveOfficeIds = isAdmin
        ? (allOfficesSelected ? offices.map((o) => o.id) : selectedOfficeIds)
        : [officeId];
      const effectivePrimaryOffice = effectiveOfficeIds[0] || officeId || offices[0]?.id || null;
      const effectiveDivisionIds = isAdmin
        ? (allDivisionsSelected ? divisions.map((d) => d.id) : selectedDivisionIds)
        : selectedDivisionIds;

      const payload = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        role: role,
        office: effectivePrimaryOffice,
        office_ids: effectiveOfficeIds,
        all_offices: isAdmin && allOfficesSelected,
        division_ids: effectiveDivisionIds,
        all_divisions: isAdmin && allDivisionsSelected,
      };

      if (modalMode === 'create') {
        payload.username = username.trim();
        payload.password = password.trim();
        await staffApi.createEmployee(payload);

        let officeDisplay = 'Assigned Office';
        if (isAdmin) {
          if (allOfficesSelected || effectiveOfficeIds.length >= offices.length) {
            officeDisplay = 'All Offices (Full DOLE System Access)';
          } else {
            officeDisplay = `${effectiveOfficeIds.length} Assigned Office(s)`;
          }
        } else {
          officeDisplay = offices.find((o) => String(o.id) === String(officeId))?.name || 'Assigned Office';
        }

        setCreatedAccountInfo({
          name: `${firstName.trim()} ${lastName.trim()}`.trim() || username.trim(),
          username: username.trim(),
          password: password.trim(),
          role: isAdmin ? 'Administrator' : 'Staff',
          office: officeDisplay,
        });

        showToast(`User account '${username.trim()}' created successfully!`);
      } else {
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
        (u.full_name && u.full_name.toLowerCase().includes(q)) ||
        (u.first_name && u.first_name.toLowerCase().includes(q)) ||
        (u.last_name && u.last_name.toLowerCase().includes(q)) ||
        (u.office_name && u.office_name.toLowerCase().includes(q));

      const matchesOffice =
        !officeFilter ||
        (u.is_superuser && (u.all_offices_access || u.office_name === 'All Offices')) ||
        String(u.office) === String(officeFilter) ||
        (Array.isArray(u.office_ids) && u.office_ids.map(String).includes(String(officeFilter)));

      const matchesDivision =
        !divisionFilter ||
        (u.is_superuser && (u.all_divisions_access || !u.division_ids || u.division_ids.length >= TARGET_DIVISIONS.length)) ||
        (Array.isArray(u.division_names) && u.division_names.some((d) => d.toLowerCase() === divisionFilter.toLowerCase())) ||
        (Array.isArray(u.division_ids) && u.division_ids.map(String).includes(String(divisionFilter)));

      return matchesSearch && matchesOffice && matchesDivision;
    });
  }, [users, searchQuery, officeFilter, divisionFilter]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, officeFilter, divisionFilter]);

  const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
  const paginatedUsers = paginateArray(filteredUsers, currentPage, ITEMS_PER_PAGE);

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
            <div
              style={{
                width: '52px',
                height: '52px',
                borderRadius: '50%',
                backgroundColor: '#ecfdf5',
                color: '#059669',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 0.75rem auto',
                border: '1px solid #a7f3d0',
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
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
      <main style={{ flex: 1, padding: '1.75rem 2rem', maxWidth: '1440px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {/* Page Header */}
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '1.5rem 1.75rem',
            marginBottom: '1.5rem',
            boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.05)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '3px',
              background: 'linear-gradient(90deg, #0305ba 0%, #1e40af 50%, #ffc603 50%, #ffc603 55%, #ff0103 55%, #dc2626 100%)',
            }}
          />
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '1.25rem',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--dole-blue)',
                    backgroundColor: 'rgba(3, 5, 186, 0.06)',
                    padding: '0.2rem 0.55rem',
                    borderRadius: '9999px',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                  </svg>
                  <span>Access Control &amp; Security Directory</span>
                </span>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '0.2rem 0.55rem',
                    borderRadius: '9999px',
                    backgroundColor: 'var(--dole-red-light)',
                    color: 'var(--dole-red)',
                    border: '1px solid #fecaca',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Admin Only
                </span>
              </div>
              <h1 style={{ fontSize: '1.5rem', color: '#0f172a', margin: 0, fontWeight: 800, letterSpacing: '-0.02em' }}>
                User Accounts Management
              </h1>
              <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.4, maxWidth: '750px' }}>
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
                padding: '0.65rem 1.4rem',
                fontSize: '0.9rem',
                fontWeight: 700,
                background: 'linear-gradient(135deg, #0305ba 0%, #1e40af 100%)',
                color: '#fff',
                borderRadius: '8px',
                boxShadow: '0 4px 10px rgba(3, 5, 186, 0.25)',
                minHeight: '44px',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>Create User Account</span>
            </button>
          </div>
        </div>

        {/* Stats Summary Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          {/* Total Accounts */}
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              padding: '1.25rem',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-color)',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Total User Accounts
                </div>
                <div className="mono" style={{ fontSize: '2rem', fontWeight: 800, color: '#0f172a', marginTop: '0.2rem', lineHeight: 1.1 }}>
                  {totalUsers}
                </div>
              </div>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '8px',
                  backgroundColor: '#eff6ff',
                  color: 'var(--dole-blue)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
              </div>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid #f1f5f9' }}>
              System directory registry
            </div>
          </div>

          {/* Active Logins */}
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              padding: '1.25rem',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-color)',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Active Logins
                </div>
                <div className="mono" style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--dole-green)', marginTop: '0.2rem', lineHeight: 1.1 }}>
                  {activeCount}
                </div>
              </div>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '8px',
                  backgroundColor: '#ecfdf5',
                  color: 'var(--dole-green)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                  <polyline points="9 12 11 14 15 10"></polyline>
                </svg>
              </div>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid #f1f5f9' }}>
              Authorized to sign in
            </div>
          </div>

          {/* Administrators */}
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              padding: '1.25rem',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-color)',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Administrators
                </div>
                <div className="mono" style={{ fontSize: '2rem', fontWeight: 800, color: '#7c3aed', marginTop: '0.2rem', lineHeight: 1.1 }}>
                  {adminCount}
                </div>
              </div>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '8px',
                  backgroundColor: '#f5f3ff',
                  color: '#7c3aed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                </svg>
              </div>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid #f1f5f9' }}>
              Full administrative authority
            </div>
          </div>

          {/* Staff Accounts */}
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              padding: '1.25rem',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-color)',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Staff Accounts
                </div>
                <div className="mono" style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--dole-blue)', marginTop: '0.2rem', lineHeight: 1.1 }}>
                  {staffCount}
                </div>
              </div>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--dole-blue-light)',
                  color: 'var(--dole-blue)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </div>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid #f1f5f9' }}>
              Counter &amp; frontline operators
            </div>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div
          style={{
            backgroundColor: 'var(--bg-card)',
            padding: '1rem 1.25rem',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.05)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <div style={{ flex: '1 1 260px', position: 'relative' }}>
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </span>
            <input
              type="text"
              placeholder="Search by username, account owner, or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '0.55rem 0.85rem 0.55rem 2.25rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.88rem',
                backgroundColor: '#ffffff',
                outline: 'none',
                minHeight: '40px',
              }}
            />
          </div>

          <div style={{ minWidth: '190px' }}>
            <select
              value={officeFilter}
              onChange={(e) => setOfficeFilter(e.target.value)}
              className="staff-custom-select"
              style={{
                width: '100%',
                padding: '0.45rem 2.2rem 0.45rem 0.8rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.88rem',
                minHeight: '40px',
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

          <div style={{ minWidth: '160px' }}>
            <select
              value={divisionFilter}
              onChange={(e) => setDivisionFilter(e.target.value)}
              className="staff-custom-select"
              style={{
                width: '100%',
                padding: '0.45rem 2.2rem 0.45rem 0.8rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.88rem',
                minHeight: '40px',
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
            className="btn btn-outline"
            style={{
              padding: '0.45rem 0.95rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#334155',
              fontSize: '0.86rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              minHeight: '40px',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6"></path>
              <path d="M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            <span>Refresh</span>
          </button>
        </div>

        {/* Users Table */}
        <div
          style={{
            backgroundColor: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.05)',
            overflow: 'hidden',
          }}
        >
          {loading ? (
            <div style={{ padding: '4rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                border: '3px solid #e2e8f0',
                borderTopColor: 'var(--dole-blue)',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 1rem auto',
              }} />
              <p style={{ fontWeight: 600, color: '#334155' }}>Loading user accounts...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div style={{ padding: '4rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  backgroundColor: '#f1f5f9',
                  color: '#94a3b8',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1rem auto',
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                </svg>
              </div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', margin: '0 0 0.25rem 0' }}>
                No user accounts found
              </h3>
              <p style={{ fontSize: '0.88rem', color: '#64748b', maxWidth: '420px', margin: '0 auto 1.25rem auto' }}>
                {searchQuery || officeFilter || divisionFilter
                  ? 'No accounts match the active search filters.'
                  : 'Get started by creating your first DOLE staff user account.'}
              </p>
              {searchQuery || officeFilter || divisionFilter ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setOfficeFilter('');
                    setDivisionFilter('');
                  }}
                  className="btn btn-outline btn-sm"
                  style={{ borderRadius: '6px' }}
                >
                  Clear Filters
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="btn btn-primary btn-sm"
                  style={{ borderRadius: '6px' }}
                >
                  Create User Account
                </button>
              )}
            </div>
          ) : (
            <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '0.85rem 1.15rem', fontWeight: 700, color: '#475569', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Login Username</th>
                    <th style={{ padding: '0.85rem 1.15rem', fontWeight: 700, color: '#475569', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Account Name</th>
                    <th style={{ padding: '0.85rem 1.15rem', fontWeight: 700, color: '#475569', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Role</th>
                    <th style={{ padding: '0.85rem 1.15rem', fontWeight: 700, color: '#475569', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Assigned Office</th>
                    <th style={{ padding: '0.85rem 1.15rem', fontWeight: 700, color: '#475569', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Assigned Division(s)
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', fontWeight: 500, textTransform: 'none', letterSpacing: 'normal' }}>
                        Dictates queue counter access
                      </span>
                    </th>
                    <th style={{ padding: '0.85rem 1.15rem', fontWeight: 700, color: '#475569', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                    <th style={{ padding: '0.85rem 1.15rem', fontWeight: 700, color: '#475569', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedUsers.map((u) => {
                    return (
                      <tr
                        key={u.id}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          transition: 'background-color 0.15s ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(3, 5, 186, 0.02)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        {/* Username */}
                        <td style={{ padding: '0.9rem 1.15rem' }}>
                          <span
                            className="mono"
                            style={{
                              backgroundColor: '#f1f5f9',
                              padding: '0.3rem 0.6rem',
                              borderRadius: '6px',
                              fontWeight: 800,
                              color: 'var(--dole-blue)',
                              fontSize: '0.86rem',
                              border: '1px solid #e2e8f0',
                              letterSpacing: '-0.01em',
                            }}
                          >
                            {u.username}
                          </span>
                        </td>

                        {/* Full Name */}
                        <td style={{ padding: '0.9rem 1.15rem' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.9rem' }}>
                            {u.full_name || (u.first_name ? `${u.first_name} ${u.last_name || ''}`.trim() : u.username)}
                          </div>
                        </td>

                        {/* Role */}
                        <td style={{ padding: '0.9rem 1.15rem' }}>
                          {u.is_superuser ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                padding: '0.25rem 0.65rem',
                                borderRadius: '9999px',
                                backgroundColor: '#f5f3ff',
                                color: '#7c3aed',
                                border: '1px solid #ddd6fe',
                              }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                              </svg>
                              <span>Administrator</span>
                            </span>
                          ) : (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                padding: '0.25rem 0.65rem',
                                borderRadius: '9999px',
                                backgroundColor: '#eff6ff',
                                color: '#1d4ed8',
                                border: '1px solid #bfdbfe',
                              }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                              </svg>
                              <span>Staff User</span>
                            </span>
                          )}
                        </td>

                        {/* Office */}
                        <td style={{ padding: '0.9rem 1.15rem' }}>
                          {u.is_superuser && (u.all_offices_access || u.office_name === 'All Offices' || (Array.isArray(u.office_ids) && offices.length > 0 && u.office_ids.length >= offices.length)) ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                padding: '0.25rem 0.65rem',
                                borderRadius: '9999px',
                                backgroundColor: '#eff6ff',
                                color: '#1d4ed8',
                                border: '1px solid #bfdbfe',
                              }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M3 21h18"></path>
                                <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path>
                              </svg>
                              <span>All Offices Access</span>
                            </span>
                          ) : u.office_names && u.office_names.length > 1 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', maxWidth: '280px' }}>
                              {u.office_names.map((offName) => (
                                <span
                                  key={offName}
                                  style={{
                                    fontSize: '0.73rem',
                                    fontWeight: 600,
                                    padding: '0.15rem 0.5rem',
                                    borderRadius: '4px',
                                    backgroundColor: '#f1f5f9',
                                    color: '#334155',
                                    border: '1px solid #e2e8f0',
                                  }}
                                >
                                  {offName}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div style={{ fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#94a3b8' }}>
                                <path d="M3 21h18"></path>
                                <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path>
                              </svg>
                              <span>{u.office_name}</span>
                            </div>
                          )}
                        </td>

                        {/* Assigned Divisions */}
                        <td style={{ padding: '0.9rem 1.15rem' }}>
                          {u.is_superuser && (u.all_divisions_access || !u.division_ids || u.division_ids.length >= TARGET_DIVISIONS.length) ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                padding: '0.25rem 0.65rem',
                                borderRadius: '9999px',
                                backgroundColor: '#ecfdf5',
                                color: '#047857',
                                border: '1px solid #a7f3d0',
                              }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                              </svg>
                              <span>All Divisions Access</span>
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
                                      padding: '0.2rem 0.55rem',
                                      borderRadius: '6px',
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
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.3rem',
                                fontSize: '0.74rem',
                                color: '#991b1b',
                                backgroundColor: '#fef2f2',
                                padding: '0.2rem 0.55rem',
                                borderRadius: '6px',
                                border: '1px solid #fecaca',
                                fontWeight: 600,
                              }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                <line x1="12" y1="9" x2="12" y2="13"></line>
                                <line x1="12" y1="17" x2="12.01" y2="17"></line>
                              </svg>
                              <span>No Division Assigned</span>
                            </span>
                          )}
                        </td>

                        {/* Status */}
                        <td style={{ padding: '0.9rem 1.15rem' }}>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(u)}
                            title="Click to toggle active status"
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              padding: '0.25rem 0.65rem',
                              borderRadius: '9999px',
                              border: u.is_active ? '1px solid #a7f3d0' : '1px solid #fecaca',
                              cursor: 'pointer',
                              backgroundColor: u.is_active ? '#ecfdf5' : '#fef2f2',
                              color: u.is_active ? '#047857' : '#991b1b',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              minHeight: 'auto',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <span
                              style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                backgroundColor: u.is_active ? '#10b981' : '#ef4444',
                              }}
                            />
                            <span>{u.is_active ? 'Active' : 'Inactive'}</span>
                          </button>
                        </td>

                        {/* Actions */}
                        <td style={{ padding: '0.9rem 1.15rem', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              onClick={() => openEditModal(u)}
                              className="btn btn-outline"
                              title="Edit user account"
                              style={{
                                minHeight: '32px',
                                padding: '0.3rem 0.65rem',
                                fontSize: '0.785rem',
                                borderRadius: '6px',
                                color: 'var(--dole-blue)',
                                borderColor: '#cbd5e1',
                                backgroundColor: '#ffffff',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                fontWeight: 600,
                              }}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                              </svg>
                              <span>Edit</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => openResetPasswordModal(u)}
                              className="btn btn-outline"
                              title="Reset account password"
                              style={{
                                minHeight: '32px',
                                padding: '0.3rem 0.65rem',
                                fontSize: '0.785rem',
                                borderRadius: '6px',
                                color: '#b45309',
                                borderColor: '#cbd5e1',
                                backgroundColor: '#ffffff',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                fontWeight: 600,
                              }}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="7.5" cy="15.5" r="4.5"></circle>
                                <path d="M10.5 12.5L20 3"></path>
                                <path d="M18 5l2 2"></path>
                                <path d="M15 8l2 2"></path>
                              </svg>
                              <span>Reset Pass</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => openDeleteModal(u)}
                              className="btn btn-outline"
                              title="Delete user account"
                              style={{
                                minHeight: '32px',
                                padding: '0.3rem 0.55rem',
                                fontSize: '0.785rem',
                                borderRadius: '6px',
                                color: '#dc2626',
                                borderColor: '#cbd5e1',
                                backgroundColor: '#ffffff',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              totalItems={filteredUsers.length}
              pageSize={ITEMS_PER_PAGE}
            />
            </>
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
              maxWidth: '660px',
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
                backgroundColor: '#f8fafc',
                borderTopLeftRadius: 'var(--radius-lg)',
                borderTopRightRadius: 'var(--radius-lg)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '8px',
                    backgroundColor: modalMode === 'create' ? '#eff6ff' : '#f5f3ff',
                    color: modalMode === 'create' ? 'var(--dole-blue)' : '#7c3aed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {modalMode === 'create' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                  )}
                </div>
                <div>
                  <h2 style={{ fontSize: '1.15rem', color: '#0f172a', margin: 0, fontWeight: 800 }}>
                    {modalMode === 'create' ? 'Create User Account' : `Edit Account (${username})`}
                  </h2>
                  <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {modalMode === 'create'
                      ? 'Configure login credentials, role, office access, and division queue permissions.'
                      : 'Update account details, role, and office/division queue permissions.'}
                  </p>
                </div>
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
                    onChange={(e) => handleRoleChange(e.target.value)}
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

              {/* Row 3: Office Field (Dropdown for Staff, Checkboxes with All Offices for Admin) */}
              <div>
                {role === 'admin' ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)', margin: 0 }}>
                          DOLE Office Access Permissions <span style={{ color: 'var(--dole-red)' }}>*</span>
                        </label>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          Choose which DOLE offices this Administrator can manage and access.
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleToggleAllOffices}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          cursor: 'pointer',
                          backgroundColor: allOfficesSelected ? '#1d4ed8' : '#ffffff',
                          color: allOfficesSelected ? '#ffffff' : '#1d4ed8',
                          padding: '0.3rem 0.75rem',
                          borderRadius: '6px',
                          border: '1.5px solid #1d4ed8',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          userSelect: 'none',
                          transition: 'all 0.15s ease',
                          minHeight: 'auto',
                          boxShadow: allOfficesSelected ? '0 2px 6px rgba(29, 78, 216, 0.25)' : 'none',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={allOfficesSelected}
                          onChange={() => {}} // Handled by button click
                          style={{ width: '15px', height: '15px', accentColor: '#1d4ed8', cursor: 'pointer' }}
                        />
                        <span>All Offices Access ({offices.length})</span>
                      </button>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                        gap: '0.65rem',
                        maxHeight: '220px',
                        overflowY: 'auto',
                        padding: '0.2rem',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: '#fafafa',
                      }}
                    >
                      {offices.map((off) => {
                        const isChecked = allOfficesSelected || selectedOfficeIds.includes(off.id);
                        return (
                          <div
                            key={off.id}
                            onClick={() => handleToggleOffice(off.id)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '0.65rem',
                              padding: '0.65rem 0.85rem',
                              borderRadius: 'var(--radius-sm)',
                              border: isChecked ? '2px solid #1d4ed8' : '1px solid #e2e8f0',
                              backgroundColor: isChecked ? '#eff6ff' : '#ffffff',
                              cursor: 'pointer',
                              userSelect: 'none',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {}}
                                style={{ width: '16px', height: '16px', accentColor: '#1d4ed8', cursor: 'pointer', flexShrink: 0 }}
                              />
                              <span
                                style={{
                                  fontSize: '0.84rem',
                                  fontWeight: isChecked ? 700 : 500,
                                  color: isChecked ? '#1e40af' : 'var(--text-primary)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                                title={off.name}
                              >
                                {off.name}
                              </span>
                            </div>
                            {off.code && (
                              <span
                                style={{
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  padding: '0.15rem 0.45rem',
                                  borderRadius: '4px',
                                  backgroundColor: isChecked ? '#dbeafe' : '#f1f5f9',
                                  color: isChecked ? '#1d4ed8' : '#64748b',
                                  flexShrink: 0,
                                }}
                              >
                                {off.code}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
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
                )}
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
                      color: '#64748b',
                      padding: '0.25rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Row 5: Division Queue Access Checklist */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)', margin: 0 }}>
                      Assigned Division(s) & Queue Counter Lines
                    </label>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      Dictates which division queue services this account can manage and serve.
                    </div>
                  </div>

                  {role === 'admin' && (
                    <button
                      type="button"
                      onClick={handleToggleAllDivisions}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        cursor: 'pointer',
                        backgroundColor: allDivisionsSelected ? '#047857' : '#ffffff',
                        color: allDivisionsSelected ? '#ffffff' : '#047857',
                        padding: '0.3rem 0.75rem',
                        borderRadius: '6px',
                        border: '1.5px solid #047857',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        userSelect: 'none',
                        transition: 'all 0.15s ease',
                        minHeight: 'auto',
                        boxShadow: allDivisionsSelected ? '0 2px 6px rgba(4, 120, 87, 0.25)' : 'none',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={allDivisionsSelected}
                        onChange={() => {}} // Handled by button click
                        style={{ width: '15px', height: '15px', accentColor: '#047857', cursor: 'pointer' }}
                      />
                      <span>All Divisions Access ({TARGET_DIVISIONS.length})</span>
                    </button>
                  )}
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
                    const isChecked = Boolean(
                      allDivisionsSelected || (targetId && selectedDivisionIds.includes(targetId))
                    );

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
                    borderRadius: '8px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                  </svg>
                  <span>
                    {submitting
                      ? 'Saving...'
                      : modalMode === 'create'
                      ? 'Create Account'
                      : 'Save Changes'}
                  </span>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '8px',
                  backgroundColor: '#fffbeb',
                  color: '#b45309',
                  border: '1px solid #fde68a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="7.5" cy="15.5" r="4.5"></circle>
                  <path d="M10.5 12.5L20 3"></path>
                  <path d="M18 5l2 2"></path>
                  <path d="M15 8l2 2"></path>
                </svg>
              </div>
              <div>
                <h3 style={{ fontSize: '1.15rem', color: '#0f172a', margin: 0, fontWeight: 800 }}>
                  Reset Password
                </h3>
                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Administrative credential override</span>
              </div>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '8px',
                  backgroundColor: '#fef2f2',
                  color: '#dc2626',
                  border: '1px solid #fecaca',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </div>
              <div>
                <h3 style={{ fontSize: '1.15rem', color: '#dc2626', margin: 0, fontWeight: 800 }}>
                  Delete User Account
                </h3>
                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Permanent account revocation</span>
              </div>
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
