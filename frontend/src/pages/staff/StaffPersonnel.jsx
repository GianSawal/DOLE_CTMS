import React, { useState, useEffect, useMemo } from 'react';
import Navbar from '../../components/Navbar';
import { staffApi } from '../../api/staff';

export const DOLE_POSITIONS = [
  'Information System Analyst II',
  'Information Technology Officer I',
  'Information Technology Officer II',
  'Administrative Officer IV',
  'Administrative Officer II',
  'Senior Labor and Employment Officer',
  'Labor and Employment Officer III',
  'Labor and Employment Officer II',
  'Labor and Employment Officer I',
  'Administrative Aide VI',
  'Planning Officer II',
  'Department Legislative Liaison Specialist',
  'Project Evaluation Officer II',
  'Administrative Assistant II',
  'Chief Administrative Officer',
  'Accountant II',
  'Supervising Administrative Officer',
  'Attorney III',
  'Attorney IV',
  'Planning Officer V',
  'Administrative Assistant IV',
  'Job Order',
  'GIP',
  'Supervising Labor Employment Officer',
  'Statistician',
];

export const TARGET_DIVISIONS = [
  { key: 'TSSD 1', alias: 'TSSD1', label: 'TSSD1', fullName: 'Technical Support Services Division 1', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  { key: 'TSSD 2', alias: 'TSSD2', label: 'TSSD2', fullName: 'Technical Support Services Division 2', color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd' },
  { key: 'IMSD', alias: 'IMSD', label: 'IMSD', fullName: 'Internal Management Services Division', color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  { key: 'MALSU', alias: 'MALSU', label: 'MALSU', fullName: 'Mediation Arbitration and Legal Services Unit', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
];

export const formatOfficeName = (off) => {
  if (!off) return '';
  const name = typeof off === 'string' ? off : (off.name || '');
  const code = typeof off === 'object' ? (off.code || '') : '';
  if (code === 'RO3' || name === 'DOLE Regional Office III') {
    return 'Regional Office No. 3';
  }
  return name;
};

export default function StaffPersonnel() {
  const [personnelList, setPersonnelList] = useState([]);
  const [offices, setOffices] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [officeFilter, setOfficeFilter] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');

  // Toast / notification
  const [toast, setToast] = useState(null);

  // Success alert modal after adding personnel
  const [createdPersonnelInfo, setCreatedPersonnelInfo] = useState(null);

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

  // Delete Confirmation Modal
  const [deleteModalPersonnel, setDeleteModalPersonnel] = useState(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [perRes, offRes, divRes] = await Promise.allSettled([
        staffApi.getPersonnel(),
        staffApi.getOffices(),
        staffApi.getDivisions(),
      ]);

      if (perRes.status === 'fulfilled') {
        setPersonnelList(Array.isArray(perRes.value) ? perRes.value : []);
      }
      if (offRes.status === 'fulfilled') {
        setOffices(Array.isArray(offRes.value) ? offRes.value : []);
      }
      if (divRes.status === 'fulfilled') {
        setDivisions(Array.isArray(divRes.value) ? divRes.value : []);
      }
    } catch (err) {
      showToast(err.message || 'Failed to load personnel data', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Map divisions from backend
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
    setFirstName('');
    setMiddleName('');
    setLastName('');
    setEmployeeId('');
    setPosition('');
    setOfficeId(offices[0]?.id || '');
    setSelectedDivisionIds([]);
    setShowModal(true);
  };

  // Open Edit Modal
  const openEditModal = (p) => {
    setModalMode('edit');
    setEditingId(p.id);
    setFirstName(p.first_name || '');
    setMiddleName(p.middle_name || '');
    setLastName(p.last_name || '');
    setEmployeeId(p.employee_id || '');
    setPosition(p.position || '');
    setOfficeId(p.office || p.office_id || '');

    const currentDivIds = p.division_ids || [];
    setSelectedDivisionIds(currentDivIds);
    setShowModal(true);
  };

  // Format employee ID
  const handleEmployeeIdChange = (e) => {
    const val = e.target.value.toUpperCase().replace(/\s+/g, '');
    setEmployeeId(val);
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
    if (!firstName.trim() || !lastName.trim()) {
      showToast('First Name and Last Name are required.', 'error');
      return;
    }
    if (!employeeId.trim()) {
      showToast('Employee ID is required.', 'error');
      return;
    }
    if (!position) {
      showToast('Please select a Position.', 'error');
      return;
    }
    if (!officeId) {
      showToast('Please select an Office.', 'error');
      return;
    }
    if (selectedDivisionIds.length === 0) {
      showToast('Please select at least one Division. The division determines which services this personnel can be assigned to.', 'error');
      return;
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
        };
        await staffApi.createPersonnel(payload);
        showToast(`Personnel ${firstName.trim()} ${lastName.trim()} (${employeeId.trim()}) added successfully!`);
      } else {
        const payload = {
          first_name: firstName.trim(),
          middle_name: middleName.trim(),
          last_name: lastName.trim(),
          position: position.trim(),
          office: officeId,
          division_ids: selectedDivisionIds,
        };
        await staffApi.updatePersonnel(editingId, payload);
        showToast(`Personnel ${employeeId} updated successfully.`);
      }
      setShowModal(false);
      loadData();
    } catch (err) {
      showToast(err.message || 'Operation failed. Please check inputs and try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle Active Status
  const handleToggleActive = async (p) => {
    try {
      const res = await staffApi.togglePersonnelActive(p.id);
      showToast(`Personnel ${p.employee_id} is now ${res.is_active ? 'Active' : 'Inactive'}.`);
      setPersonnelList((prev) =>
        prev.map((item) => (item.id === p.id ? { ...item, is_active: res.is_active } : item))
      );
    } catch (err) {
      showToast(err.message || 'Failed to toggle personnel status', 'error');
    }
  };

  // Delete Personnel
  const handleConfirmDelete = async () => {
    if (!deleteModalPersonnel) return;
    setDeleteSubmitting(true);
    try {
      await staffApi.deletePersonnel(deleteModalPersonnel.id);
      showToast(`Personnel ${deleteModalPersonnel.employee_id} deleted.`);
      setDeleteModalPersonnel(null);
      setPersonnelList((prev) => prev.filter((item) => item.id !== deleteModalPersonnel.id));
    } catch (err) {
      showToast(err.message || 'Failed to delete personnel', 'error');
    } finally {
      setDeleteSubmitting(false);
    }
  };

  // Filtered personnel list with instant real-time search
  const filteredPersonnel = useMemo(() => {
    return personnelList.filter((p) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (p.employee_id && p.employee_id.toLowerCase().includes(q)) ||
        (p.first_name && p.first_name.toLowerCase().includes(q)) ||
        (p.last_name && p.last_name.toLowerCase().includes(q)) ||
        (p.position && p.position.toLowerCase().includes(q)) ||
        (p.office_name && p.office_name.toLowerCase().includes(q));

      const matchesOffice = !officeFilter || String(p.office) === String(officeFilter);

      const matchesDivision =
        !divisionFilter ||
        (p.division_names && p.division_names.some((d) => d.toLowerCase().includes(divisionFilter.toLowerCase())));

      return matchesSearch && matchesOffice && matchesDivision;
    });
  }, [personnelList, searchQuery, officeFilter, divisionFilter]);

  const totalPersonnel = personnelList.length;
  const activeCount = personnelList.filter((p) => p.is_active).length;
  const officeCount = new Set(personnelList.map((p) => p.office)).size;

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
              <span style={{ fontSize: '1.6rem' }}>👤</span>
              <h1 style={{ fontSize: '1.45rem', color: 'var(--text-primary)', margin: 0 }}>
                DOLE Personnel Management
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
              Add and manage personnel information, positions, field offices, and enforce division-based service assignment restrictions.
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
            <span>➕</span> Add Personnel Information
          </button>
        </div>

        {/* Division Restriction Policy Banner */}
        <div
          style={{
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 'var(--radius-md)',
            padding: '0.85rem 1.15rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            color: '#1e40af',
            fontSize: '0.86rem',
            lineHeight: 1.45,
          }}
        >
          <span style={{ fontSize: '1.3rem' }}>🔒</span>
          <div>
            <strong>Division-to-Service Assignment Policy:</strong> The selected division strictly governs which frontline services a personnel can access and be assigned to.
            For example, personnel assigned to <strong>TSSD1</strong> can only access and be assigned to services under <strong>TSSD1</strong>, and cannot be designated to services under TSSD2, IMSD, or MALSU.
          </div>
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
              Total Personnel
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
              {totalPersonnel}
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
              Active Personnel
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
              Field Offices Assigned
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
              Divisions Configured
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
              placeholder="Search personnel by name, Employee ID, position..."
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

          <div style={{ minWidth: '220px' }}>
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
              <option value="">All Field Offices</option>
              {offices.map((off) => (
                <option key={off.id} value={off.id}>
                  {formatOfficeName(off)} ({off.code})
                </option>
              ))}
            </select>
          </div>

          <div style={{ minWidth: '160px' }}>
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
              <option value="TSSD 1">TSSD1</option>
              <option value="TSSD 2">TSSD2</option>
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

        {/* Personnel Table */}
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
              <p>Loading DOLE personnel records...</p>
            </div>
          ) : filteredPersonnel.length === 0 ? (
            <div style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📂</div>
              <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>No personnel records found</p>
              <p style={{ fontSize: '0.88rem', marginTop: '0.25rem' }}>
                {searchQuery || officeFilter || divisionFilter
                  ? 'Try adjusting your search filters.'
                  : 'Get started by clicking "+ Add Personnel Information" above.'}
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
                        (Determines Allowed Services)
                      </span>
                    </th>
                    <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Status</th>
                    <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: 'var(--text-secondary)', textAlign: 'right' }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPersonnel.map((p) => {
                    return (
                      <tr
                        key={p.id}
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
                            {p.employee_id}
                          </span>
                        </td>

                        {/* Full Name */}
                        <td style={{ padding: '0.85rem 1rem' }}>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                            {p.full_name || `${p.first_name} ${p.last_name}`}
                          </div>
                          {p.middle_name && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Middle: {p.middle_name}
                            </div>
                          )}
                        </td>

                        {/* Position */}
                        <td style={{ padding: '0.85rem 1rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                          {p.position || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>— None —</span>}
                        </td>

                        {/* Office */}
                        <td style={{ padding: '0.85rem 1rem' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{formatOfficeName(p.office_name)}</div>
                          {p.office_code && (
                            <span
                              style={{
                                fontSize: '0.72rem',
                                color: 'var(--text-muted)',
                                backgroundColor: 'var(--bg-ground)',
                                padding: '0.1rem 0.4rem',
                                borderRadius: 'var(--radius-sm)',
                              }}
                            >
                              {p.office_code}
                            </span>
                          )}
                        </td>

                        {/* Assigned Divisions */}
                        <td style={{ padding: '0.85rem 1rem' }}>
                          {p.division_names && p.division_names.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                              {p.division_names.map((divName) => {
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
                            onClick={() => handleToggleActive(p)}
                            title="Click to toggle active status"
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              padding: '0.2rem 0.55rem',
                              borderRadius: 'var(--radius-full)',
                              border: 'none',
                              cursor: 'pointer',
                              backgroundColor: p.is_active ? 'var(--dole-green-light)' : 'var(--dole-red-light)',
                              color: p.is_active ? 'var(--dole-green)' : 'var(--dole-red)',
                              minHeight: 'auto',
                            }}
                          >
                            {p.is_active ? '● Active' : '○ Inactive'}
                          </button>
                        </td>

                        {/* Actions */}
                        <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              onClick={() => openEditModal(p)}
                              className="btn btn-outline"
                              title="Edit personnel information"
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
                              onClick={() => setDeleteModalPersonnel(p)}
                              className="btn btn-outline"
                              title="Delete personnel record"
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
      {/* Modal: Add / Edit Personnel                                 */}
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
                  {modalMode === 'create' ? '➕ Add Personnel Information' : `✏️ Edit Personnel Information (${employeeId})`}
                </h2>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  {modalMode === 'create'
                    ? 'Fill in the personnel information below. The assigned division determines the services this personnel can access.'
                    : 'Update personnel details, position, office, and division assignment.'}
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
                  Personnel Full Name <span style={{ color: 'var(--dole-red)' }}>*</span>
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
                    {modalMode === 'create' ? 'Official Employee ID / Username.' : 'Employee ID cannot be modified.'}
                  </span>
                </div>

                <div>
                  <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                    Position <span style={{ color: 'var(--dole-red)' }}>*</span>
                  </label>
                  <select
                    required
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.62rem 0.8rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.88rem',
                      outline: 'none',
                      backgroundColor: '#fff',
                    }}
                  >
                    <option value="" disabled>-- Select Position --</option>
                    {DOLE_POSITIONS.map((pos) => (
                      <option key={pos} value={pos}>
                        {pos}
                      </option>
                    ))}
                    {position && !DOLE_POSITIONS.includes(position) && (
                      <option value={position}>{position} (Current)</option>
                    )}
                  </select>
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
                      {formatOfficeName(off)} ({off.code})
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  Regional Office No. 3, Pampanga Field Office, Clark Satellite Office, Tarlac Field Office, Bulacan Field Office, Nueva Ecija Field Office, Aurora Field Office, or Bataan Field Office
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
                    Division (Determines Allowed Services) <span style={{ color: 'var(--dole-red)' }}>*</span>
                  </label>
                  <span style={{ fontSize: '0.74rem', color: 'var(--dole-blue)', fontWeight: 600 }}>
                    Select Division(s)
                  </span>
                </div>
                <div
                  style={{
                    backgroundColor: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.65rem 0.85rem',
                    marginBottom: '0.85rem',
                    fontSize: '0.8rem',
                    color: '#1e40af',
                    lineHeight: 1.45,
                  }}
                >
                  <strong>⚠️ Division Service Assignment Rule:</strong>
                  <div>
                    The selected division strictly determines which services this personnel can access and be assigned to.
                    For example, personnel assigned to <strong>TSSD1</strong> can only access and be assigned to services under the <strong>TSSD1</strong> division, and cannot access or be assigned to services belonging to other divisions.
                  </div>
                </div>

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



              {/* Modal Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn btn-outline"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary"
                  style={{
                    backgroundColor: 'var(--dole-blue)',
                    color: '#fff',
                    fontWeight: 700,
                    padding: '0.65rem 1.4rem',
                  }}
                >
                  {submitting ? 'Saving...' : modalMode === 'create' ? 'Save Personnel' : 'Update Personnel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* Modal: Delete Confirmation                                */}
      {/* ========================================================= */}
      {deleteModalPersonnel && (
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
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠️</div>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--dole-red)', margin: '0 0 0.5rem 0' }}>
              Delete Personnel Record?
            </h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              Are you sure you want to delete personnel{' '}
              <strong>{deleteModalPersonnel.full_name || deleteModalPersonnel.employee_id}</strong> ({deleteModalPersonnel.employee_id})?
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setDeleteModalPersonnel(null)}
                className="btn btn-outline"
                disabled={deleteSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteSubmitting}
                className="btn"
                style={{
                  backgroundColor: 'var(--dole-red)',
                  color: '#fff',
                  fontWeight: 700,
                  padding: '0.6rem 1.25rem',
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
