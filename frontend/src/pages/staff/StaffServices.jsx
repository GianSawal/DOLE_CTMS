import React, { useState, useEffect, useMemo } from 'react';
import Navbar from '../../components/Navbar';
import { staffApi } from '../../api/staff';
import Pagination, { paginateArray } from '../../components/Pagination';

const ITEMS_PER_PAGE = 10;

export const DIVISION_COLORS = {
  'TSSD 1': { color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe', label: 'TSSD 1' },
  'TSSD1': { color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe', label: 'TSSD 1' },
  'TSSD 2': { color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd', label: 'TSSD 2' },
  'TSSD2': { color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd', label: 'TSSD 2' },
  'IMSD': { color: '#047857', bg: '#ecfdf5', border: '#a7f3d0', label: 'IMSD' },
  'MALSU': { color: '#b45309', bg: '#fffbeb', border: '#fde68a', label: 'MALSU' },
  'ALL': { color: '#6d28d9', bg: '#f5f3ff', border: '#ddd6fe', label: 'ALL DIVISIONS' },
};

export default function StaffServices() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('ALL_FILTER');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'assigned' | 'unassigned'
  const [currentPage, setCurrentPage] = useState(1);

  // Toast notification
  const [toast, setToast] = useState(null);

  // Assignment Modal
  const [selectedService, setSelectedService] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loadingPersonnel, setLoadingPersonnel] = useState(false);
  const [eligiblePersonnel, setEligiblePersonnel] = useState([]);
  const [selectedPersonnelIds, setSelectedPersonnelIds] = useState(new Set());
  const [personnelSearch, setPersonnelSearch] = useState('');
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [assignmentError, setAssignmentError] = useState('');

  // Fetch Services & Summary
  const fetchServicesData = async () => {
    try {
      setLoading(true);
      const [servicesData, summaryData] = await Promise.all([
        staffApi.getServices(),
        staffApi.getServicesSummary().catch(() => null),
      ]);
      setServices(servicesData || []);
      if (summaryData) setSummary(summaryData);
    } catch (err) {
      console.error('Failed to fetch services:', err);
      showToast('error', 'Failed to load services. Please refresh.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServicesData();
  }, []);

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast(null);
    }, 4500);
  };

  // Open Assignment Modal for a service
  const handleOpenAssignModal = async (service) => {
    setSelectedService(service);
    setAssignmentError('');
    setPersonnelSearch('');
    setModalOpen(true);
    setLoadingPersonnel(true);

    try {
      const res = await staffApi.getServiceEligiblePersonnel(service.id);
      const personnelList = res.personnel || [];
      setEligiblePersonnel(personnelList);

      // Initialize selected set from currently assigned personnel
      const initialIds = new Set(
        service.assigned_personnel_ids ||
        personnelList.filter(p => p.is_assigned).map(p => p.id)
      );
      setSelectedPersonnelIds(initialIds);
    } catch (err) {
      console.error('Failed to load eligible personnel:', err);
      setAssignmentError(err?.data?.detail || 'Failed to load eligible personnel for this service.');
      setEligiblePersonnel([]);
      setSelectedPersonnelIds(new Set());
    } finally {
      setLoadingPersonnel(false);
    }
  };

  const handleCloseModal = () => {
    if (savingAssignment) return;
    setModalOpen(false);
    setSelectedService(null);
    setEligiblePersonnel([]);
    setSelectedPersonnelIds(new Set());
    setAssignmentError('');
  };

  const togglePersonnelSelection = (id) => {
    setSelectedPersonnelIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllEligible = () => {
    const allFilteredIds = filteredPersonnel.map(p => p.id);
    setSelectedPersonnelIds(prev => {
      const next = new Set(prev);
      allFilteredIds.forEach(id => next.add(id));
      return next;
    });
  };

  const handleDeselectAllEligible = () => {
    const allFilteredIds = new Set(filteredPersonnel.map(p => p.id));
    setSelectedPersonnelIds(prev => {
      const next = new Set(prev);
      allFilteredIds.forEach(id => next.delete(id));
      return next;
    });
  };

  const handleSaveAssignments = async () => {
    if (!selectedService) return;
    setSavingAssignment(true);
    setAssignmentError('');

    try {
      const idsArray = Array.from(selectedPersonnelIds);
      const res = await staffApi.assignServicePersonnel(selectedService.id, idsArray);

      showToast('success', res.message || `Personnel successfully assigned to ${selectedService.name}!`);

      // Update services list locally
      if (res.service) {
        setServices(prev => prev.map(s => s.id === res.service.id ? res.service : s));
      } else {
        fetchServicesData();
      }

      handleCloseModal();
    } catch (err) {
      console.error('Assignment error:', err);
      const msg = err?.data?.detail || err?.message || 'Failed to save personnel assignments.';
      setAssignmentError(msg);
    } finally {
      setSavingAssignment(false);
    }
  };

  // Filtered Services
  const filteredServices = useMemo(() => {
    return services.filter(svc => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = svc.name.toLowerCase().includes(q);
        const matchesDivision = (svc.division_name || '').toLowerCase().includes(q);
        const matchesPersonnel = (svc.assigned_personnel || []).some(p =>
          p.full_name.toLowerCase().includes(q) ||
          p.employee_id.toLowerCase().includes(q) ||
          (p.position || '').toLowerCase().includes(q)
        );
        if (!matchesName && !matchesDivision && !matchesPersonnel) return false;
      }

      // Division filter
      if (divisionFilter !== 'ALL_FILTER') {
        const divName = (svc.division_name || '').toUpperCase().replace(/\s+/g, '');
        const targetDiv = divisionFilter.toUpperCase().replace(/\s+/g, '');
        if (divName !== targetDiv) return false;
      }

      // Status / Assigned filter
      if (statusFilter === 'assigned') {
        if ((svc.assigned_count || 0) === 0) return false;
      } else if (statusFilter === 'unassigned') {
        if ((svc.assigned_count || 0) > 0) return false;
      }

      return true;
    });
  }, [services, searchQuery, divisionFilter, statusFilter]);

  // Paginated Services
  const totalPages = Math.ceil(filteredServices.length / ITEMS_PER_PAGE);
  const currentServices = useMemo(() => {
    return paginateArray(filteredServices, currentPage, ITEMS_PER_PAGE);
  }, [filteredServices, currentPage]);

  // Filtered Personnel inside the modal
  const filteredPersonnel = useMemo(() => {
    if (!personnelSearch.trim()) return eligiblePersonnel;
    const q = personnelSearch.toLowerCase();
    return eligiblePersonnel.filter(p =>
      p.full_name.toLowerCase().includes(q) ||
      p.employee_id.toLowerCase().includes(q) ||
      (p.position || '').toLowerCase().includes(q) ||
      (p.office_name || '').toLowerCase().includes(q)
    );
  }, [eligiblePersonnel, personnelSearch]);

  // Overall Statistics
  const totalServices = services.length;
  const activeCount = services.filter(s => s.is_active).length;
  const assignedCount = services.filter(s => (s.assigned_count || 0) > 0).length;
  const unassignedCount = totalServices - assignedCount;

  // Available division tabs
  const availableDivisions = useMemo(() => {
    const set = new Set();
    services.forEach(s => {
      if (s.division_name) set.add(s.division_name);
    });
    return Array.from(set).sort();
  }, [services]);

  const getDivisionStyle = (divName) => {
    if (!divName) return { color: '#64748b', bg: '#f1f5f9', border: '#cbd5e1', label: 'NO DIVISION' };
    const key = divName.toUpperCase().replace(/\s+/g, ' ');
    return DIVISION_COLORS[key] || DIVISION_COLORS[divName] || {
      color: '#334155',
      bg: '#f8fafc',
      border: '#cbd5e1',
      label: divName,
    };
  };

  return (
    <>
      <Navbar />

      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: '1.25rem',
            right: '1.25rem',
            zIndex: 9999,
            backgroundColor: toast.type === 'success' ? '#10b981' : '#ef4444',
            color: '#ffffff',
            padding: '0.85rem 1.4rem',
            borderRadius: '10px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.65rem',
            fontSize: '0.9rem',
            fontWeight: 600,
            animation: 'fadeIn 0.2s ease',
          }}
        >
          {toast.type === 'success' ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          )}
          <span>{toast.message}</span>
        </div>
      )}

      <main style={{ padding: '2rem 1.5rem', maxWidth: '1440px', margin: '0 auto', minHeight: 'calc(100vh - 80px)' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(3, 5, 186, 0.08)',
                  color: 'var(--dole-blue)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                </svg>
              </div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
                Services &amp; Personnel Assignment
              </h1>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.35rem' }}>
              Complete catalog of services offered by the system with division-restricted multi-personnel assignment.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={fetchServicesData}
              disabled={loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.55rem 1rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#334155',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1rem',
            marginBottom: '1.75rem',
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
              Total Services
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
              {totalServices}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.15rem' }}>
              From csm_service table
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
              Active Services
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--dole-green)', marginTop: '0.2rem' }}>
              {activeCount}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.15rem' }}>
              Available for kiosk &amp; queueing
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
              Personnel Assigned
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--dole-blue)', marginTop: '0.2rem' }}>
              {assignedCount}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.15rem' }}>
              Services with handling officers
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
              Unassigned Services
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: unassignedCount > 0 ? '#d97706' : '#10b981', marginTop: '0.2rem' }}>
              {unassignedCount}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.15rem' }}>
              {unassignedCount > 0 ? 'Needs personnel assigned' : 'All services assigned'}
            </div>
          </div>
        </div>

        {/* Division Filter Pills */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '1rem',
            overflowX: 'auto',
            paddingBottom: '0.25rem',
          }}
        >
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginRight: '0.25rem' }}>
            Division:
          </span>

          <button
            type="button"
            onClick={() => { setDivisionFilter('ALL_FILTER'); setCurrentPage(1); }}
            style={{
              padding: '0.4rem 0.85rem',
              borderRadius: '20px',
              border: divisionFilter === 'ALL_FILTER' ? '1.5px solid var(--dole-blue)' : '1px solid #cbd5e1',
              backgroundColor: divisionFilter === 'ALL_FILTER' ? 'var(--dole-blue)' : '#ffffff',
              color: divisionFilter === 'ALL_FILTER' ? '#ffffff' : '#475569',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            All Divisions ({totalServices})
          </button>

          {availableDivisions.map(div => {
            const count = services.filter(s => s.division_name === div).length;
            const isSelected = divisionFilter === div;
            const styleToken = getDivisionStyle(div);

            return (
              <button
                key={div}
                type="button"
                onClick={() => { setDivisionFilter(div); setCurrentPage(1); }}
                style={{
                  padding: '0.4rem 0.85rem',
                  borderRadius: '20px',
                  border: isSelected ? `1.5px solid ${styleToken.color}` : `1px solid ${styleToken.border}`,
                  backgroundColor: isSelected ? styleToken.color : styleToken.bg,
                  color: isSelected ? '#ffffff' : styleToken.color,
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
              >
                {div} ({count})
              </button>
            );
          })}
        </div>

        {/* Search & Filter Controls */}
        <div
          style={{
            backgroundColor: 'var(--bg-card)',
            padding: '1rem 1.25rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-sm)',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          {/* Search Box */}
          <div style={{ position: 'relative', flex: '1 1 320px', maxWidth: '480px' }}>
            <span
              style={{
                position: 'absolute',
                left: '0.85rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </span>
            <input
              type="text"
              placeholder="Search service name, division, or assigned personnel..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                width: '100%',
                padding: '0.55rem 0.85rem 0.55rem 2.4rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.88rem',
                outline: 'none',
                backgroundColor: '#ffffff',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '0.75rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Right Status Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#64748b' }}>
              Status:
            </label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                padding: '0.5rem 0.85rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem',
                backgroundColor: '#ffffff',
                fontWeight: 600,
                color: '#334155',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="all">All Statuses</option>
              <option value="assigned">Assigned Personnel Only</option>
              <option value="unassigned">Unassigned Only (Needs Personnel)</option>
            </select>
          </div>
        </div>

        {/* Services Table Card */}
        <div
          style={{
            backgroundColor: 'var(--bg-card)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-sm)',
            overflow: 'hidden',
          }}
        >
          {loading ? (
            <div style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  border: '3px solid rgba(3, 5, 186, 0.2)',
                  borderTopColor: 'var(--dole-blue)',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                  margin: '0 auto 1rem auto',
                }}
              />
              <p style={{ fontWeight: 600 }}>Loading DOLE services from database...</p>
            </div>
          ) : currentServices.length === 0 ? (
            <div style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" style={{ margin: '0 auto 1rem auto' }}>
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
              </svg>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                No Services Found
              </h3>
              <p style={{ fontSize: '0.85rem' }}>
                {searchQuery || divisionFilter !== 'ALL_FILTER' || statusFilter !== 'all'
                  ? 'No services match your active search and filter criteria.'
                  : 'No services are available in the csm_service table.'}
              </p>
              {(searchQuery || divisionFilter !== 'ALL_FILTER' || statusFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setDivisionFilter('ALL_FILTER');
                    setStatusFilter('all');
                  }}
                  style={{
                    marginTop: '1rem',
                    padding: '0.45rem 0.95rem',
                    borderRadius: '8px',
                    border: '1px solid var(--dole-blue)',
                    backgroundColor: 'rgba(3, 5, 186, 0.05)',
                    color: 'var(--dole-blue)',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                    <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700, width: '60px' }}>ID</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700 }}>Service Name</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700, width: '140px' }}>Authorized Division</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700, width: '100px' }}>Status</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700 }}>Assigned Personnel</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700, textAlign: 'right', width: '180px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {currentServices.map((service, idx) => {
                    const divStyle = getDivisionStyle(service.division_name);
                    const assignedList = service.assigned_personnel || [];
                    const assignedTotal = service.assigned_count || assignedList.length;

                    return (
                      <tr
                        key={service.id}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          transition: 'background-color 0.1s ease',
                          backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa',
                        }}
                      >
                        {/* ID / Sort order */}
                        <td style={{ padding: '1rem 1.25rem', fontWeight: 600, color: '#94a3b8' }}>
                          #{service.id}
                        </td>

                        {/* Service Name */}
                        <td style={{ padding: '1rem 1.25rem' }}>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.92rem' }}>
                            {service.name}
                          </div>
                          {service.sort_order > 0 && (
                            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.15rem' }}>
                              DOLE CSF Order: #{service.sort_order}
                            </div>
                          )}
                        </td>

                        {/* Authorized Division */}
                        <td style={{ padding: '1rem 1.25rem' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.3rem 0.65rem',
                              borderRadius: '6px',
                              backgroundColor: divStyle.bg,
                              color: divStyle.color,
                              border: `1px solid ${divStyle.border}`,
                              fontWeight: 700,
                              fontSize: '0.75rem',
                              letterSpacing: '0.02em',
                            }}
                          >
                            {service.division_name || 'ALL DIVISIONS'}
                          </span>
                        </td>

                        {/* Active Status */}
                        <td style={{ padding: '1rem 1.25rem' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              padding: '0.25rem 0.55rem',
                              borderRadius: '20px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              backgroundColor: service.is_active ? '#ecfdf5' : '#f1f5f9',
                              color: service.is_active ? '#059669' : '#64748b',
                            }}
                          >
                            <span
                              style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                backgroundColor: service.is_active ? '#10b981' : '#94a3b8',
                              }}
                            />
                            {service.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>

                        {/* Assigned Personnel */}
                        <td style={{ padding: '1rem 1.25rem' }}>
                          {assignedTotal > 0 ? (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.3rem',
                                    backgroundColor: 'rgba(3, 5, 186, 0.08)',
                                    color: 'var(--dole-blue)',
                                    padding: '0.2rem 0.55rem',
                                    borderRadius: '12px',
                                    fontSize: '0.75rem',
                                    fontWeight: 700,
                                  }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                    <circle cx="9" cy="7" r="4"></circle>
                                  </svg>
                                  {assignedTotal} Assigned
                                </span>

                                {assignedList.slice(0, 3).map(p => (
                                  <span
                                    key={p.id}
                                    title={`${p.full_name} (${p.position || 'Personnel'})`}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.3rem',
                                      backgroundColor: '#f1f5f9',
                                      color: '#334155',
                                      padding: '0.2rem 0.5rem',
                                      borderRadius: '6px',
                                      fontSize: '0.74rem',
                                      fontWeight: 600,
                                      border: '1px solid #e2e8f0',
                                    }}
                                  >
                                    <span
                                      style={{
                                        width: '16px',
                                        height: '16px',
                                        borderRadius: '50%',
                                        backgroundColor: '#cbd5e1',
                                        color: '#1e293b',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '0.6rem',
                                        fontWeight: 800,
                                      }}
                                    >
                                      {p.first_name ? p.first_name[0] : 'P'}
                                    </span>
                                    {p.full_name}
                                  </span>
                                ))}

                                {assignedList.length > 3 && (
                                  <span
                                    style={{
                                      fontSize: '0.74rem',
                                      color: 'var(--text-muted)',
                                      fontWeight: 600,
                                      padding: '0.2rem 0.35rem',
                                    }}
                                  >
                                    +{assignedList.length - 3} more
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                color: '#d97706',
                                backgroundColor: '#fffbeb',
                                padding: '0.2rem 0.6rem',
                                borderRadius: '6px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                border: '1px solid #fde68a',
                              }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="8" x2="12" y2="12"></line>
                                <line x1="12" y1="16" x2="12.01" y2="16"></line>
                              </svg>
                              Needs Personnel
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td style={{ padding: '1rem 1.25rem', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => handleOpenAssignModal(service)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.45rem',
                              padding: '0.45rem 0.85rem',
                              borderRadius: '8px',
                              backgroundColor: 'var(--dole-blue)',
                              color: '#ffffff',
                              border: 'none',
                              fontSize: '0.82rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              boxShadow: '0 1px 3px rgba(3, 5, 186, 0.2)',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                              <circle cx="9" cy="7" r="4"></circle>
                              <line x1="20" y1="8" x2="20" y2="14"></line>
                              <line x1="23" y1="11" x2="17" y2="11"></line>
                            </svg>
                            <span>Assign Personnel</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={filteredServices.length}
            pageSize={ITEMS_PER_PAGE}
          />
        </div>
      </main>

      {/* =================================================================== */}
      {/* Personnel Assignment Modal (Division-Enforced) */}
      {/* =================================================================== */}
      {modalOpen && selectedService && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !savingAssignment) {
              handleCloseModal();
            }
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '720px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              overflow: 'hidden',
              animation: 'scaleIn 0.15s ease',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '1.25rem 1.5rem',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                backgroundColor: '#ffffff',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.35rem' }}>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      color: 'var(--dole-blue)',
                      backgroundColor: 'rgba(3, 5, 186, 0.08)',
                      padding: '0.2rem 0.55rem',
                      borderRadius: '6px',
                    }}
                  >
                    Service #{selectedService.id}
                  </span>

                  {selectedService.division_name && (
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '0.2rem 0.55rem',
                        borderRadius: '6px',
                        backgroundColor: getDivisionStyle(selectedService.division_name).bg,
                        color: getDivisionStyle(selectedService.division_name).color,
                        border: `1px solid ${getDivisionStyle(selectedService.division_name).border}`,
                      }}
                    >
                      {selectedService.division_name}
                    </span>
                  )}
                </div>

                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                  Assign Personnel: {selectedService.name}
                </h2>
              </div>

              <button
                type="button"
                onClick={handleCloseModal}
                disabled={savingAssignment}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  cursor: savingAssignment ? 'not-allowed' : 'pointer',
                  padding: '0.25rem',
                  fontSize: '1.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            {/* Division Restriction Notice Banner */}
            <div
              style={{
                backgroundColor: '#eff6ff',
                borderBottom: '1px solid #bfdbfe',
                padding: '0.85rem 1.5rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
              }}
            >
              <div
                style={{
                  color: '#1d4ed8',
                  marginTop: '0.1rem',
                  flexShrink: 0,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
              </div>
              <div style={{ fontSize: '0.83rem', color: '#1e40af', lineHeight: 1.45 }}>
                <strong style={{ display: 'block', fontWeight: 700, color: '#1e3a8a', marginBottom: '0.15rem' }}>
                  Division-Based Restriction Enforced
                </strong>
                Only personnel assigned to{' '}
                <span style={{ fontWeight: 800, textDecoration: 'underline' }}>
                  {selectedService.division_name || 'All Divisions'}
                </span>{' '}
                are eligible for selection. Personnel from other divisions cannot be assigned to this service.
              </div>
            </div>

            {/* Error Banner */}
            {assignmentError && (
              <div
                style={{
                  backgroundColor: '#fef2f2',
                  borderBottom: '1px solid #fecaca',
                  padding: '0.85rem 1.5rem',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.65rem',
                  color: '#b91c1c',
                  fontSize: '0.84rem',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: '1px' }}>
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <div>{assignmentError}</div>
              </div>
            )}

            {/* Search & Bulk Selection Bar */}
            <div
              style={{
                padding: '0.85rem 1.5rem',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                flexWrap: 'wrap',
                backgroundColor: '#fafafa',
              }}
            >
              {/* Filter search */}
              <div style={{ position: 'relative', flex: '1 1 240px' }}>
                <input
                  type="text"
                  placeholder="Filter eligible personnel by name or position..."
                  value={personnelSearch}
                  onChange={(e) => setPersonnelSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.45rem 0.75rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.84rem',
                    backgroundColor: '#ffffff',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Selection Counter & Quick Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: selectedPersonnelIds.size > 0 ? 'var(--dole-blue)' : '#64748b',
                    marginRight: '0.25rem',
                  }}
                >
                  Selected: {selectedPersonnelIds.size} of {eligiblePersonnel.length}
                </span>

                <button
                  type="button"
                  onClick={handleSelectAllEligible}
                  disabled={loadingPersonnel || filteredPersonnel.length === 0}
                  style={{
                    padding: '0.35rem 0.65rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#334155',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Select All
                </button>

                <button
                  type="button"
                  onClick={handleDeselectAllEligible}
                  disabled={loadingPersonnel || selectedPersonnelIds.size === 0}
                  style={{
                    padding: '0.35rem 0.65rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#334155',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Modal Body: Personnel List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem', maxHeight: '420px' }}>
              {loadingPersonnel ? (
                <div style={{ padding: '3rem 1rem', textAlign: 'center', color: '#64748b' }}>
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      border: '3px solid rgba(3, 5, 186, 0.2)',
                      borderTopColor: 'var(--dole-blue)',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                      margin: '0 auto 0.75rem auto',
                    }}
                  />
                  <p style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                    Filtering authorized personnel for {selectedService.division_name || 'division'}...
                  </p>
                </div>
              ) : filteredPersonnel.length === 0 ? (
                <div style={{ padding: '3rem 1rem', textAlign: 'center', color: '#64748b' }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8" style={{ margin: '0 auto 0.75rem auto' }}>
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <line x1="18" y1="8" x2="23" y2="13"></line>
                    <line x1="23" y1="8" x2="18" y2="13"></line>
                  </svg>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                    No Eligible Personnel Found
                  </h4>
                  <p style={{ fontSize: '0.82rem', maxWidth: '380px', margin: '0 auto' }}>
                    {personnelSearch
                      ? 'No personnel matching your search term.'
                      : `No active personnel are currently assigned to division "${selectedService.division_name || 'None'}". Please assign personnel to this division in the Personnel tab first.`}
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {filteredPersonnel.map(person => {
                    const isChecked = selectedPersonnelIds.has(person.id);

                    return (
                      <div
                        key={person.id}
                        onClick={() => togglePersonnelSelection(person.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.85rem',
                          padding: '0.75rem 1rem',
                          borderRadius: '10px',
                          border: isChecked ? '1.5px solid var(--dole-blue)' : '1px solid #e2e8f0',
                          backgroundColor: isChecked ? 'rgba(3, 5, 186, 0.03)' : '#ffffff',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // Controlled by outer div onClick
                          style={{
                            width: '18px',
                            height: '18px',
                            cursor: 'pointer',
                            accentColor: 'var(--dole-blue)',
                          }}
                        />

                        {/* Avatar */}
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            backgroundColor: isChecked ? 'var(--dole-blue)' : '#e2e8f0',
                            color: isChecked ? '#ffffff' : '#334155',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 800,
                            fontSize: '0.8rem',
                            flexShrink: 0,
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {person.first_name ? person.first_name[0] : 'P'}
                          {person.last_name ? person.last_name[0] : ''}
                        </div>

                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                              {person.full_name}
                            </span>
                            <span
                              style={{
                                fontSize: '0.72rem',
                                color: '#64748b',
                                backgroundColor: '#f1f5f9',
                                padding: '0.1rem 0.4rem',
                                borderRadius: '4px',
                                fontWeight: 600,
                              }}
                            >
                              {person.employee_id}
                            </span>
                          </div>

                          <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.15rem' }}>
                            {person.position || 'DOLE Officer'} &bull; {person.office_name || 'Regional Office'}
                          </div>
                        </div>

                        {/* Division Badge & Currently Assigned Flag */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexShrink: 0 }}>
                          {(person.division_names || []).map(d => (
                            <span
                              key={d}
                              style={{
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                padding: '0.15rem 0.45rem',
                                borderRadius: '4px',
                                backgroundColor: getDivisionStyle(d).bg,
                                color: getDivisionStyle(d).color,
                                border: `1px solid ${getDivisionStyle(d).border}`,
                              }}
                            >
                              {d}
                            </span>
                          ))}

                          {person.is_assigned && (
                            <span
                              style={{
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                padding: '0.15rem 0.45rem',
                                borderRadius: '4px',
                                backgroundColor: '#ecfdf5',
                                color: '#059669',
                                border: '1px solid #a7f3d0',
                              }}
                            >
                              Assigned
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '1rem 1.5rem',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: '#ffffff',
              }}
            >
              <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
                {selectedPersonnelIds.size === 0 ? (
                  <span style={{ color: '#d97706' }}>No personnel selected (will clear assignments)</span>
                ) : (
                  <span>
                    <strong>{selectedPersonnelIds.size}</strong> officer{selectedPersonnelIds.size > 1 ? 's' : ''} will be assigned to this service
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={savingAssignment}
                  style={{
                    padding: '0.55rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#475569',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: savingAssignment ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleSaveAssignments}
                  disabled={savingAssignment}
                  style={{
                    padding: '0.55rem 1.25rem',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: 'var(--dole-blue)',
                    color: '#ffffff',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: savingAssignment ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    boxShadow: '0 2px 4px rgba(3, 5, 186, 0.2)',
                  }}
                >
                  {savingAssignment ? (
                    <>
                      <div
                        style={{
                          width: '14px',
                          height: '14px',
                          border: '2px solid rgba(255,255,255,0.4)',
                          borderTopColor: '#ffffff',
                          borderRadius: '50%',
                          animation: 'spin 0.8s linear infinite',
                        }}
                      />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                      <span>Save Assignments</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
