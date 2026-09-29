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
  const [employees, setEmployees] = useState([]);
  const [offices, setOffices] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [officeFilter, setOfficeFilter] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');

  // Toast / notification
  const [toast, setToast] = useState(null);

  // Add / Edit Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' | 'edit'
  const [editingId, setEditingId] = useState(null);

  // Form Fields
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [position, setPosition] = useState('');
  const [officeId, setOfficeId] = useState('');
  const [selectedDivisionIds, setSelectedDivisionIds] = useState([]);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [passwordEdited, setPasswordEdited] = useState(false);

  // Reset Password Modal
  const [resetModalEmployee, setResetModalEmployee] = useState(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);

  // Delete Confirmation Modal
  const [deleteModalEmployee, setDeleteModalEmployee] = useState(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [empRes, offRes, divRes] = await Promise.allSettled([
        staffApi.getEmployees(),
        staffApi.getOffices(),
        staffApi.getDivisions(),
      ]);

      if (empRes.status === 'fulfilled') {
        setEmployees(Array.isArray(empRes.value) ? empRes.value : []);
      }
      if (offRes.status === 'fulfilled') {
        setOffices(Array.isArray(offRes.value) ? offRes.value : []);
      }
      if (divRes.status === 'fulfilled') {
        setDivisions(Array.isArray(divRes.value) ? divRes.value : []);
      }
    } catch (err) {
      showToast(err.message || 'Failed to load user management data', 'error');
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
      // also map normalized aliases
      if (name === 'TSSD 1') map['TSSD1'] = div.id;
      if (name === 'TSSD 2') map['TSSD2'] = div.id;
    });
    return map;
  }, [divisions]);

  // Open Create Modal
  const openCreateModal = () => {
    setModalMode('create');
    setEditingId(null);
    setFirstName('');
    setMiddleName('');
    setLastName('');
    setEmployeeId('');
    setPosition('');
    setOfficeId(offices[0]?.id || '');
    setSelectedDivisionIds([]);
    setTemporaryPassword('');
    setPasswordEdited(false);
    setShowModal(true);
  };

  // Open Edit Modal
  const openEditModal = (emp) => {
    setModalMode('edit');
    setEditingId(emp.id);
    setFirstName(emp.first_name || '');
    setMiddleName(emp.middle_name || '');
    setLastName(emp.last_name || '');
    setEmployeeId(emp.employee_id || '');
    setPosition(emp.position || '');
    setOfficeId(emp.office || '');

    // Resolve division IDs
    const currentDivIds = emp.division_ids || [];
    setSelectedDivisionIds(currentDivIds);
    setTemporaryPassword('');
    setPasswordEdited(false);
    setShowModal(true);
  };

  // Sync temporary password with employee ID when typing in create mode
  const handleEmployeeIdChange = (e) => {
    const val = e.target.value.toUpperCase().replace(/\s+/g, '');
    setEmployeeId(val);
    if (modalMode === 'create' && !passwordEdited) {
      setTemporaryPassword(val);
    }
  };

  // Toggle division selection
  const handleToggleDivision = (divKey, divAlias) => {
    // Resolve division id from divisionMap
    let targetId = divisionMap[divKey] || divisionMap[divAlias];
    if (!targetId) {
      // Fallback: match by name in divisions list
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
    if (!firstName.trim() || !lastName.trim()) {
      showToast('First Name and Last Name are required.', 'error');
      return;
    }
    if (!employeeId.trim()) {
      showToast('Employee ID is required.', 'error');
      return;
    }
    if (!officeId) {
      showToast('Please select an Office.', 'error');
      return;
    }
    if (selectedDivisionIds.length === 0) {
      if (!window.confirm('No division selected. The employee will not be able to access division queue lines. Continue?')) {
        return;
      }
    }

    setSubmitting(true);
    try {
      if (modalMode === 'create') {
        const payload = {
          first_name: firstName.trim(),
          middle_name: middleName.trim(),
          last_name: lastName.trim(),
          employee_id: employeeId.trim(),
          position: position.trim(),
          office: officeId,
          division_ids: selectedDivisionIds,
          temporary_password: temporaryPassword.trim() || employeeId.trim(),
        };
        await staffApi.createEmployee(payload);
        showToast(`Employee ${employeeId} (${firstName} ${lastName}) successfully registered! Temporary password: ${payload.temporary_password}`);
      } else {
        const payload = {
          first_name: firstName.trim(),
          middle_name: middleName.trim(),
          last_name: lastName.trim(),
          position: position.trim(),
          office: officeId,
          division_ids: selectedDivisionIds,
        };
        await staffApi.updateEmployee(editingId, payload);
        showToast(`Employee ${employeeId} profile updated successfully.`);
      }
      setShowModal(false);
      loadData();
    } catch (err) {
      showToast(err.message || 'Operation failed. Please verify the inputs.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Trigger Reset Password Modal
  const openResetPasswordModal = (emp) => {
    setResetModalEmployee(emp);
    setNewPasswordInput(emp.employee_id);
  };

  const handleConfirmResetPassword = async () => {
    if (!resetModalEmployee) return;
    setResetSubmitting(true);
    try {
      const pwd = newPasswordInput.trim() || resetModalEmployee.employee_id;
      const res = await staffApi.resetEmployeePassword(resetModalEmployee.id, pwd);
      showToast(res.message || `Password for ${resetModalEmployee.employee_id} has been reset.`);
      setResetModalEmployee(null);
    } catch (err) {
      showToast(err.message || 'Failed to reset password', 'error');
    } finally {
      setResetSubmitting(false);
    }
  };

  // Toggle Active Status
  const handleToggleActive = async (emp) => {
    try {
      const res = await staffApi.toggleEmployeeActive(emp.id);
      showToast(`User ${emp.employee_id} is now ${res.is_active ? 'Active' : 'Inactive'}.`);
      setEmployees((prev) =>
        prev.map((item) => (item.id === emp.id ? { ...item, is_active: res.is_active } : item))
      );
    } catch (err) {
      showToast(err.message || 'Failed to toggle account status', 'error');
    }
  };

  // Trigger Delete Confirmation
  const openDeleteModal = (emp) => {
    setDeleteModalEmployee(emp);
  };

  const handleConfirmDelete = async () => {
    if (!deleteModalEmployee) return;
    setDeleteSubmitting(true);
    try {
      await staffApi.deleteEmployee(deleteModalEmployee.id);
      showToast(`Employee ${deleteModalEmployee.employee_id} (${deleteModalEmployee.full_name}) deleted.`);
      setDeleteModalEmployee(null);
      setEmployees((prev) => prev.filter((item) => item.id !== deleteModalEmployee.id));
    } catch (err) {
      showToast(err.message || 'Failed to delete employee', 'error');
    } finally {
      setDeleteSubmitting(false);
    }
  };

  // Filtered employees list
  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (emp.employee_id && emp.employee_id.toLowerCase().includes(q)) ||
        (emp.first_name && emp.first_name.toLowerCase().includes(q)) ||
        (emp.last_name && emp.last_name.toLowerCase().includes(q)) ||
        (emp.position && emp.position.toLowerCase().includes(q)) ||
        (emp.office_name && emp.office_name.toLowerCase().includes(q));

      const matchesOffice = !officeFilter || String(emp.office) === String(officeFilter);

      const matchesDivision =
        !divisionFilter ||
        (emp.division_names && emp.division_names.some((d) => d.toLowerCase().includes(divisionFilter.toLowerCase())));

      return matchesSearch && matchesOffice && matchesDivision;
    });
  }, [employees, searchQuery, officeFilter, divisionFilter]);

  // Summary counts
  const totalEmployees = employees.length;
  const activeCount = employees.filter((e) => e.is_active).length;
  const officeCount = new Set(employees.map((e) => e.office)).size;

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

      <main style={{ flex: 1, padding: '1.75rem 2rem', maxWidth: '1440px', width: '100%', margin: '0 auto' }}>
        {/* Top Header Banner */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
            marginBottom: '1.5rem',
            backgroundColor: 'var(--bg-card)',
            padding: '1.25rem 1.5rem',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-sm)',
            border: '1px solid var(--border-color)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.6rem' }}>👥</span>
              <h1 style={{ fontSize: '1.45rem', color: 'var(--text-primary)', margin: 0 }}>
                User &amp; Employee Management
              </h1>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  backgroundColor: 'var(--dole-blue-light)',
                  color: 'var(--dole-blue)',
                  padding: '0.2rem 0.55rem',
                  borderRadius: 'var(--radius-full)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Admin Only
              </span>
            </div>
            <p style={{ margin: '0.3rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Create and manage staff accounts, assign field offices, and restrict queue line access by division.
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
            <span>➕</span> Add New Employee
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
              Total Employees
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
              {totalEmployees}
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
              Active Accounts
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
              Offices Assigned
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--dole-blue)', marginTop: '0.2rem' }}>
              {officeCount}
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
              Active Divisions
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--dole-gold-dark)', marginTop: '0.2rem' }}>
              {TARGET_DIVISIONS.length}
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
            gap: '0.85rem',
            alignItems: 'center',
            marginBottom: '1.25rem',
          }}
        >
          {/* Search Box */}
          <div style={{ flex: '1 1 260px', position: 'relative' }}>
            <span
              style={{
                position: 'absolute',
                left: '0.75rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                fontSize: '0.9rem',
              }}
            >
              🔍
            </span>
            <input
              type="text"
              placeholder="Search by ID, name, position..."
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

          {/* Office Filter */}
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

          {/* Division Filter */}
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

          {/* Refresh Button */}
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

        {/* Employees Table */}
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
              <p>Loading employee directory...</p>
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📂</div>
              <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>No employees found</p>
              <p style={{ fontSize: '0.88rem', marginTop: '0.25rem' }}>
                {searchQuery || officeFilter || divisionFilter
                  ? 'Try adjusting your search filters.'
                  : 'Get started by clicking "+ Add New Employee" above.'}
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-ground)', borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Employee ID</th>
                    <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Full Name</th>
                    <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Position</th>
                    <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Office</th>
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
                  {filteredEmployees.map((emp) => {
                    return (
                      <tr
                        key={emp.id}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          transition: 'background-color 0.15s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--dole-blue-subtle)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        {/* Employee ID */}
                        <td style={{ padding: '0.85rem 1rem' }}>
                          <span
                            className="mono"
                            style={{
                              backgroundColor: 'var(--bg-ground)',
                              padding: '0.25rem 0.55rem',
                              borderRadius: 'var(--radius-sm)',
                              fontWeight: 700,
                              color: 'var(--dole-blue)',
                              fontSize: '0.84rem',
                              border: '1px solid var(--border-color)',
                            }}
                          >
                            {emp.employee_id}
                          </span>
                        </td>

                        {/* Full Name */}
                        <td style={{ padding: '0.85rem 1rem' }}>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                            {emp.full_name || `${emp.first_name} ${emp.last_name}`}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            Username: <code className="mono">{emp.username || emp.employee_id}</code>
                          </div>
                        </td>

                        {/* Position */}
                        <td style={{ padding: '0.85rem 1rem', color: 'var(--text-secondary)' }}>
                          {emp.position || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>— None —</span>}
                        </td>

                        {/* Office */}
                        <td style={{ padding: '0.85rem 1rem' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{emp.office_name}</div>
                          {emp.office_code && (
                            <span
                              style={{
                                fontSize: '0.72rem',
                                color: 'var(--text-muted)',
                                backgroundColor: 'var(--bg-ground)',
                                padding: '0.1rem 0.4rem',
                                borderRadius: 'var(--radius-sm)',
                              }}
                            >
                              {emp.office_code}
                            </span>
                          )}
                        </td>

                        {/* Assigned Divisions */}
                        <td style={{ padding: '0.85rem 1rem' }}>
                          {emp.division_names && emp.division_names.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                              {emp.division_names.map((divName) => {
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
                            onClick={() => handleToggleActive(emp)}
                            title="Click to toggle active status"
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              padding: '0.2rem 0.55rem',
                              borderRadius: 'var(--radius-full)',
                              border: 'none',
                              cursor: 'pointer',
                              backgroundColor: emp.is_active ? 'var(--dole-green-light)' : 'var(--dole-red-light)',
                              color: emp.is_active ? 'var(--dole-green)' : 'var(--dole-red)',
                              minHeight: 'auto',
                            }}
                          >
                            {emp.is_active ? '● Active' : '○ Inactive'}
                          </button>
                        </td>

                        {/* Actions */}
                        <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                            {/* Edit */}
                            <button
                              type="button"
                              onClick={() => openEditModal(emp)}
                              className="btn btn-outline"
                              title="Edit employee details"
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

                            {/* Reset Password */}
                            <button
                              type="button"
                              onClick={() => openResetPasswordModal(emp)}
                              className="btn btn-outline"
                              title="Reset temporary password"
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

                            {/* Delete */}
                            <button
                              type="button"
                              onClick={() => openDeleteModal(emp)}
                              className="btn btn-outline"
                              title="Delete employee account"
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

      {/* ========================================================= */}
      {/* Modal: Add / Edit Employee                                 */}
      {/* ========================================================= */}
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
              maxWidth: '680px',
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
                  {modalMode === 'create' ? '➕ Register New Employee' : `✏️ Edit Employee (${employeeId})`}
                </h2>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  {modalMode === 'create'
                    ? 'Enter employee details. Assigned divisions dictate which client queues they can access.'
                    : 'Update employee information and division queue permissions.'}
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
              {/* Row 1: Name Fields (First, Middle, Last) */}
              <div>
                <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                  Full Name <span style={{ color: 'var(--dole-red)' }}>*</span>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem' }}>
                  <div>
                    <input
                      type="text"
                      required
                      placeholder="First Name *"
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
                  </div>
                  <div>
                    <input
                      type="text"
                      placeholder="Middle Name (Optional)"
                      value={middleName}
                      onChange={(e) => setMiddleName(e.target.value)}
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
                  <div>
                    <input
                      type="text"
                      required
                      placeholder="Last Name *"
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
              </div>

              {/* Row 2: Employee ID & Position */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
                <div>
                  <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                    Employee ID <span style={{ color: 'var(--dole-red)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    disabled={modalMode === 'edit'}
                    placeholder="e.g. EMP-2026-001"
                    value={employeeId}
                    onChange={handleEmployeeIdChange}
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
                    {modalMode === 'create' ? 'Unique identifier used for login username.' : 'Employee ID cannot be changed.'}
                  </span>
                </div>

                <div>
                  <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                    Position / Designation
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Labor and Employment Officer III"
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
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
                  DOLE Office <span style={{ color: 'var(--dole-red)' }}>*</span>
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
                      {off.name} ({off.code})
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  Regional Office No. 3, Field Offices (Pampanga, Clark, Tarlac, Bulacan, Nueva Ecija, Aurora, Bataan, Zambales)
                </span>
              </div>

              {/* Row 4: Division Field (Checkboxes for TSSD 1, TSSD 2, IMSD, MALSU) */}
              <div
                style={{
                  backgroundColor: 'var(--bg-ground)',
                  padding: '1.1rem 1.25rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    Division Queue Access (Checkboxes) <span style={{ color: 'var(--dole-red)' }}>*</span>
                  </label>
                  <span style={{ fontSize: '0.74rem', color: 'var(--dole-blue)', fontWeight: 600 }}>
                    Multi-select allowed
                  </span>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.85rem', lineHeight: 1.4 }}>
                  Select which division(s) this employee belongs to. <strong>The division(s) selected determine which Waiting in Line / Queue tickets the employee is allowed to view and call.</strong>
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.65rem' }}>
                  {TARGET_DIVISIONS.map((tDiv) => {
                    const mappedId = divisionMap[tDiv.key] || divisionMap[tDiv.alias];
                    const isChecked = mappedId ? selectedDivisionIds.includes(mappedId) : false;

                    return (
                      <label
                        key={tDiv.key}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.75rem',
                          padding: '0.75rem 0.85rem',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: isChecked ? tDiv.bg : '#fff',
                          border: isChecked ? `2px solid ${tDiv.color}` : '1px solid var(--border-color)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          boxShadow: isChecked ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleDivision(tDiv.key, tDiv.alias)}
                          style={{
                            width: '18px',
                            height: '18px',
                            cursor: 'pointer',
                            marginTop: '2px',
                            accentColor: tDiv.color,
                          }}
                        />
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '0.88rem', color: tDiv.color }}>
                            {tDiv.label}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                            {tDiv.fullName}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Row 5: Temporary Password Field (Create mode only) */}
              {modalMode === 'create' && (
                <div
                  style={{
                    backgroundColor: 'var(--dole-gold-light)',
                    padding: '1rem 1.15rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--dole-gold)',
                  }}
                >
                  <label
                    style={{
                      fontSize: '0.84rem',
                      fontWeight: 700,
                      color: 'var(--dole-gold-dark)',
                      display: 'block',
                      marginBottom: '0.4rem',
                    }}
                  >
                    🔑 Temporary Password <span style={{ color: 'var(--dole-red)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Temporary Password (defaults to Employee ID)"
                    value={temporaryPassword}
                    onChange={(e) => {
                      setTemporaryPassword(e.target.value);
                      setPasswordEdited(true);
                    }}
                    className="mono"
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.88rem',
                      fontWeight: 700,
                      backgroundColor: '#fff',
                      outline: 'none',
                    }}
                  />
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                    ℹ️ By default, the temporary password matches the <strong>Employee ID</strong>. The employee will use this password to log into the staff portal.
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn btn-outline"
                  style={{
                    padding: '0.6rem 1.1rem',
                    fontSize: '0.9rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-secondary)',
                    minHeight: 'auto',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary"
                  style={{
                    padding: '0.6rem 1.4rem',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--dole-blue)',
                    color: '#fff',
                    minHeight: 'auto',
                    opacity: submitting ? 0.7 : 1,
                  }}
                >
                  {submitting ? 'Saving...' : modalMode === 'create' ? '💾 Register Employee' : '💾 Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* Modal: Reset Password                                     */}
      {/* ========================================================= */}
      {resetModalEmployee && (
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
              maxWidth: '460px',
              width: '100%',
              padding: '1.5rem',
              boxShadow: '0 20px 45px rgba(0,0,0,0.22)',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '1.5rem' }}>🔑</span>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-primary)' }}>
                Reset Temporary Password
              </h3>
            </div>
            <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.4 }}>
              Set a new temporary password for <strong>{resetModalEmployee.full_name}</strong> ({resetModalEmployee.employee_id}).
            </p>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem' }}>
                New Temporary Password:
              </label>
              <input
                type="text"
                value={newPasswordInput}
                onChange={(e) => setNewPasswordInput(e.target.value)}
                className="mono"
                placeholder={resetModalEmployee.employee_id}
                style={{
                  width: '100%',
                  padding: '0.6rem 0.8rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => setNewPasswordInput(resetModalEmployee.employee_id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--dole-blue)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '0.3rem 0 0 0',
                  minHeight: 'auto',
                }}
              >
                ↺ Reset to Employee ID ({resetModalEmployee.employee_id})
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button
                type="button"
                onClick={() => setResetModalEmployee(null)}
                className="btn btn-outline"
                style={{
                  padding: '0.5rem 1rem',
                  fontSize: '0.86rem',
                  borderRadius: 'var(--radius-md)',
                  minHeight: 'auto',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resetSubmitting}
                onClick={handleConfirmResetPassword}
                className="btn btn-primary"
                style={{
                  padding: '0.5rem 1.15rem',
                  fontSize: '0.86rem',
                  fontWeight: 700,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--dole-gold-dark)',
                  color: '#fff',
                  minHeight: 'auto',
                  opacity: resetSubmitting ? 0.7 : 1,
                }}
              >
                {resetSubmitting ? 'Updating...' : 'Set Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* Modal: Delete Confirmation                                */}
      {/* ========================================================= */}
      {deleteModalEmployee && (
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '1.5rem' }}>⚠️</span>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--dole-red)' }}>
                Delete Employee Account?
              </h3>
            </div>
            <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: 1.4 }}>
              Are you sure you want to delete <strong>{deleteModalEmployee.full_name}</strong> ({deleteModalEmployee.employee_id})?
              This will permanently revoke their access to the CTMS staff portal and queue management.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button
                type="button"
                onClick={() => setDeleteModalEmployee(null)}
                className="btn btn-outline"
                style={{
                  padding: '0.5rem 1rem',
                  fontSize: '0.86rem',
                  borderRadius: 'var(--radius-md)',
                  minHeight: 'auto',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteSubmitting}
                onClick={handleConfirmDelete}
                className="btn"
                style={{
                  padding: '0.5rem 1.15rem',
                  fontSize: '0.86rem',
                  fontWeight: 700,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--dole-red)',
                  color: '#fff',
                  minHeight: 'auto',
                  opacity: deleteSubmitting ? 0.7 : 1,
                }}
              >
                {deleteSubmitting ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
