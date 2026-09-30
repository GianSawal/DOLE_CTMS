import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Navbar from '../../components/Navbar';
import Modal from '../../components/Modal';
import { staffApi } from '../../api/staff';

const CATEGORIES = [
  { key: 'all', label: 'All Logs', icon: '📋' },
  { key: 'queue', label: 'Queue & Dispatch', icon: '⏱️' },
  { key: 'user', label: 'User Accounts', icon: '👤' },
  { key: 'personnel', label: 'Personnel Directory', icon: '📇' },
  { key: 'auth', label: 'Auth & Access', icon: '🔒' },
  { key: 'config', label: 'Configuration', icon: '⚙️' },
];

export default function StaffAuditLogs() {
  const [logs, setLogs] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [categoryCounts, setCategoryCounts] = useState({});
  const [availableActions, setAvailableActions] = useState([]);
  const [offices, setOffices] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [officeFilter, setOfficeFilter] = useState('all');
  const [dateRange, setDateRange] = useState('all'); // 'all', 'today', '7days', '30days', 'custom'
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Details Modal
  const [selectedLog, setSelectedLog] = useState(null);
  const [copied, setCopied] = useState(false);

  // Fetch offices for office filter dropdown
  useEffect(() => {
    staffApi.getOffices().then(res => {
      if (Array.isArray(res)) setOffices(res);
    }).catch(() => {});
  }, []);

  // Compute date_from and date_to based on dateRange
  const { dateFrom, dateTo } = useMemo(() => {
    const now = new Date();
    const formatDate = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    if (dateRange === 'today') {
      const todayStr = formatDate(now);
      return { dateFrom: todayStr, dateTo: todayStr };
    } else if (dateRange === '7days') {
      const past = new Date(now);
      past.setDate(past.getDate() - 7);
      return { dateFrom: formatDate(past), dateTo: formatDate(now) };
    } else if (dateRange === '30days') {
      const past = new Date(now);
      past.setDate(past.getDate() - 30);
      return { dateFrom: formatDate(past), dateTo: formatDate(now) };
    } else if (dateRange === 'custom') {
      return { dateFrom: customFrom, dateTo: customTo };
    }
    return { dateFrom: '', dateTo: '' };
  }, [dateRange, customFrom, customTo]);

  // Fetch Audit Logs
  const fetchLogs = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = {
        page,
        page_size: pageSize,
      };
      if (search.trim()) params.search = search.trim();
      if (category && category !== 'all') params.category = category;
      if (actionFilter && actionFilter !== 'all') params.action = actionFilter;
      if (officeFilter && officeFilter !== 'all') params.office = officeFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;

      const data = await staffApi.getAuditLogs(params);
      setLogs(data.results || []);
      setTotalCount(data.total_count || 0);
      setTotalPages(data.total_pages || 1);
      setCurrentPage(data.current_page || 1);
      setCategoryCounts(data.category_counts || {});
      if (data.available_actions) setAvailableActions(data.available_actions);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, [search, category, actionFilter, officeFilter, dateFrom, dateTo, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
    fetchLogs(1);
  }, [fetchLogs]);

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > totalPages) return;
    setCurrentPage(newPage);
    fetchLogs(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleExportCsv = () => {
    if (!logs.length) return;
    const headers = ['ID', 'Timestamp', 'Actor', 'Role', 'Action', 'Category', 'Target', 'Office', 'Division', 'Description', 'IP Address'];
    const rows = logs.map(l => [
      l.id,
      `"${l.formatted_time || l.timestamp}"`,
      `"${l.actor_username || 'System'}"`,
      `"${l.actor_role || ''}"`,
      `"${l.action || ''}"`,
      `"${l.category_display || l.category || ''}"`,
      `"${(l.target_repr || '').replace(/"/g, '""')}"`,
      `"${(l.office_name || '').replace(/"/g, '""')}"`,
      `"${l.division_name || ''}"`,
      `"${(l.description || '').replace(/"/g, '""')}"`,
      `"${l.ip_address || ''}"`,
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `dole_ctms_audit_logs_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getActionBadgeStyle = (act = '') => {
    const upper = act.toUpperCase();
    if (upper.includes('DONE') || upper.includes('COMPLETE') || upper.includes('CREATE')) {
      return { bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' };
    }
    if (upper.includes('CALL') || upper.includes('LOGIN') || upper.includes('UPDATE')) {
      return { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' };
    }
    if (upper.includes('PENDING') || upper.includes('HOLD') || upper.includes('RECALL') || upper.includes('RESET') || upper.includes('ASSIGN')) {
      return { bg: '#fffbeb', color: '#b45309', border: '#fde68a' };
    }
    if (upper.includes('CANCEL') || upper.includes('DELETE') || upper.includes('NO_SHOW') || upper.includes('FAIL')) {
      return { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' };
    }
    return { bg: '#f8fafc', color: '#475569', border: '#e2e8f0' };
  };

  const getCategoryBadgeStyle = (cat = '') => {
    switch (cat.toLowerCase()) {
      case 'queue':
        return { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' };
      case 'user':
        return { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' };
      case 'personnel':
        return { bg: '#faf5ff', color: '#7e22ce', border: '#e9d5ff' };
      case 'auth':
        return { bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' };
      case 'config':
        return { bg: '#f5f3ff', color: '#6d28d9', border: '#ddd6fe' };
      default:
        return { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
    }
  };

  const handleCopyDetails = () => {
    if (!selectedLog) return;
    const text = JSON.stringify(selectedLog, null, 2);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>
      <Navbar />

      <main style={{ maxWidth: '1440px', margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>
        {/* Header Console Banner */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '1.25rem 1.5rem',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
          marginBottom: '1.5rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}>
          <div>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.72rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--dole-blue)',
              backgroundColor: 'rgba(3, 5, 186, 0.06)',
              padding: '0.2rem 0.6rem',
              borderRadius: '9999px',
              marginBottom: '0.35rem',
            }}>
              <span>🛡️ Security &amp; Compliance Audit</span>
            </div>
            <h1 style={{
              fontSize: '1.45rem',
              fontWeight: 800,
              color: '#0f172a',
              margin: '0 0 0.25rem',
              letterSpacing: '-0.02em',
            }}>
              System Audit Trail &amp; Access Logs
            </h1>
            <p style={{ fontSize: '0.875rem', color: '#64748b', margin: 0 }}>
              Chronological log of administrative changes, queue calls, user activities, and security events.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => fetchLogs(currentPage)}
              disabled={loading}
              className="btn btn-outline"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                minHeight: '40px',
                padding: '0 1rem',
                backgroundColor: '#ffffff',
                borderColor: '#cbd5e1',
                color: '#334155',
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}
              >
                <path d="M23 4v6h-6"></path>
                <path d="M1 20v-6h6"></path>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
              <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
            </button>

            <button
              onClick={handleExportCsv}
              disabled={!logs.length}
              className="btn btn-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                minHeight: '40px',
                padding: '0 1.15rem',
                backgroundColor: '#047857',
                borderColor: '#047857',
                color: '#ffffff',
                boxShadow: '0 1px 2px rgba(4, 120, 87, 0.2)',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Category Filter Pills Bar */}
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          marginBottom: '1rem',
        }}>
          {CATEGORIES.map(cat => {
            const isActive = category === cat.key;
            const count = categoryCounts[cat.key] ?? (cat.key === 'all' ? totalCount : 0);
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setCategory(cat.key)}
                style={{
                  padding: '0.5rem 0.95rem',
                  borderRadius: '8px',
                  border: isActive ? '1.5px solid var(--dole-blue)' : '1px solid #cbd5e1',
                  backgroundColor: isActive ? 'rgba(3, 5, 186, 0.08)' : '#ffffff',
                  color: isActive ? 'var(--dole-blue)' : '#475569',
                  fontWeight: isActive ? 700 : 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  transition: 'all 0.15s ease',
                  boxShadow: isActive ? '0 1px 2px rgba(3, 5, 186, 0.1)' : 'none',
                }}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  padding: '0.1rem 0.45rem',
                  borderRadius: '9999px',
                  backgroundColor: isActive ? 'var(--dole-blue)' : '#f1f5f9',
                  color: isActive ? '#ffffff' : '#64748b',
                  marginLeft: '0.2rem',
                }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Advanced Filters Card */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          padding: '1rem 1.25rem',
          marginBottom: '1.5rem',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '0.85rem',
            alignItems: 'flex-end',
          }}>
            {/* Search Box */}
            <div style={{ gridColumn: 'span 2 / span 2', minWidth: '280px' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Search Logs
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Search by actor, description, target or IP..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '40px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    padding: '0.45rem 2.2rem 0.45rem 2.2rem',
                    fontSize: '0.875rem',
                    color: '#1e293b',
                    outline: 'none',
                  }}
                />
                <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                  🔍
                </span>
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    style={{
                      position: 'absolute',
                      right: '0.75rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#94a3b8',
                      fontSize: '0.9rem',
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Action Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Action Type
              </label>
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '40px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  padding: '0.45rem 0.75rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: '#334155',
                  backgroundColor: '#ffffff',
                }}
              >
                <option value="all">All Actions</option>
                {availableActions.map(act => (
                  <option key={act} value={act}>{act}</option>
                ))}
              </select>
            </div>

            {/* Office Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                DOLE Office
              </label>
              <select
                value={officeFilter}
                onChange={(e) => setOfficeFilter(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '40px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  padding: '0.45rem 0.75rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: '#334155',
                  backgroundColor: '#ffffff',
                }}
              >
                <option value="all">All Offices</option>
                {offices.map(off => (
                  <option key={off.id} value={off.id}>{off.name} ({off.code})</option>
                ))}
              </select>
            </div>

            {/* Date Range Quick Selector */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Date Filter
              </label>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '40px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  padding: '0.45rem 0.75rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: '#334155',
                  backgroundColor: '#ffffff',
                }}
              >
                <option value="all">All Dates</option>
                <option value="today">Today</option>
                <option value="7days">Past 7 Days</option>
                <option value="30days">Past 30 Days</option>
                <option value="custom">Custom Date Range</option>
              </select>
            </div>
          </div>

          {/* Custom Date Range Row */}
          {dateRange === 'custom' && (
            <div style={{
              display: 'flex',
              gap: '1rem',
              alignItems: 'center',
              marginTop: '0.85rem',
              paddingTop: '0.85rem',
              borderTop: '1px dashed #e2e8f0',
              flexWrap: 'wrap',
            }}>
              <div>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b', marginRight: '0.5rem' }}>From:</span>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  style={{
                    padding: '0.35rem 0.65rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                  }}
                />
              </div>
              <div>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b', marginRight: '0.5rem' }}>To:</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  style={{
                    padding: '0.35rem 0.65rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Audit Logs Table Card */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          overflow: 'hidden',
        }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{
                  backgroundColor: '#f8fafc',
                  borderBottom: '1px solid #e2e8f0',
                  color: '#475569',
                  fontSize: '0.78rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontWeight: 700,
                }}>
                  <th style={{ padding: '0.85rem 1rem' }}>Timestamp</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Actor</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Action</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Category</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Target</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Office &amp; Division</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Description</th>
                  <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Details</th>
                </tr>
              </thead>
              <tbody style={{ fontSize: '0.875rem', color: '#1e293b' }}>
                {loading && logs.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ padding: '3.5rem 1rem', textAlign: 'center', color: '#94a3b8' }}>
                      <div style={{ display: 'inline-block', width: '28px', height: '28px', border: '3px solid #cbd5e1', borderTopColor: 'var(--dole-blue)', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '0.75rem' }} />
                      <div style={{ fontWeight: 600 }}>Loading audit records...</div>
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ padding: '3.5rem 1rem', textAlign: 'center', color: '#94a3b8' }}>
                      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔍</div>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: '#475569', marginBottom: '0.25rem' }}>No Audit Logs Found</div>
                      <div style={{ fontSize: '0.85rem' }}>No system events match your selected filters.</div>
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => {
                    const actBadge = getActionBadgeStyle(log.action);
                    const catBadge = getCategoryBadgeStyle(log.category);
                    return (
                      <tr
                        key={log.id}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          transition: 'background-color 0.15s ease',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        {/* Timestamp */}
                        <td style={{ padding: '0.9rem 1rem', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                          <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#1e293b' }}>
                            {log.formatted_time || log.timestamp}
                          </div>
                          {log.ip_address && (
                            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.15rem' }}>
                              IP: {log.ip_address}
                            </div>
                          )}
                        </td>

                        {/* Actor */}
                        <td style={{ padding: '0.9rem 1rem', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '50%',
                              backgroundColor: log.actor_role === 'Administrator' ? 'rgba(3, 5, 186, 0.12)' : '#e2e8f0',
                              color: log.actor_role === 'Administrator' ? 'var(--dole-blue)' : '#475569',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '0.7rem',
                              fontWeight: 800,
                            }}>
                              {(log.actor_username || 'SY').slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a' }}>
                                {log.actor_username || 'System'}
                              </div>
                              <div style={{
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                color: log.actor_role === 'Administrator' ? 'var(--dole-blue)' : '#64748b',
                              }}>
                                {log.actor_role || 'System'}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Action Badge */}
                        <td style={{ padding: '0.9rem 1rem', verticalAlign: 'top' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '0.2rem 0.55rem',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            backgroundColor: actBadge.bg,
                            color: actBadge.color,
                            border: `1px solid ${actBadge.border}`,
                            whiteSpace: 'nowrap',
                          }}>
                            {log.action}
                          </span>
                        </td>

                        {/* Category */}
                        <td style={{ padding: '0.9rem 1rem', verticalAlign: 'top' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '0.18rem 0.5rem',
                            borderRadius: '4px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            backgroundColor: catBadge.bg,
                            color: catBadge.color,
                            border: `1px solid ${catBadge.border}`,
                            whiteSpace: 'nowrap',
                          }}>
                            {log.category_display || log.category}
                          </span>
                        </td>

                        {/* Target */}
                        <td style={{ padding: '0.9rem 1rem', verticalAlign: 'top', maxWidth: '180px' }}>
                          <div style={{
                            fontWeight: 600,
                            fontSize: '0.82rem',
                            color: '#334155',
                            wordBreak: 'break-word',
                          }}>
                            {log.target_repr || '—'}
                          </div>
                        </td>

                        {/* Office & Division */}
                        <td style={{ padding: '0.9rem 1rem', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#1e293b' }}>
                            {log.office_name || '—'}
                          </div>
                          {log.division_name && (
                            <div style={{
                              display: 'inline-block',
                              marginTop: '0.15rem',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              color: '#0369a1',
                              backgroundColor: '#e0f2fe',
                              padding: '0.05rem 0.4rem',
                              borderRadius: '4px',
                            }}>
                              {log.division_name}
                            </div>
                          )}
                        </td>

                        {/* Description */}
                        <td style={{ padding: '0.9rem 1rem', verticalAlign: 'top', minWidth: '220px' }}>
                          <div style={{ fontSize: '0.82rem', color: '#334155', lineHeight: '1.4' }}>
                            {log.description || '—'}
                          </div>
                        </td>

                        {/* Details Modal Trigger */}
                        <td style={{ padding: '0.9rem 1rem', verticalAlign: 'top', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => setSelectedLog(log)}
                            style={{
                              padding: '0.25rem 0.65rem',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: '#ffffff',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              color: '#475569',
                              cursor: 'pointer',
                              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                            }}
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem 1.25rem',
            borderTop: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            flexWrap: 'wrap',
            gap: '0.85rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                Showing <strong>{logs.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}</strong> to{' '}
                <strong>{Math.min(currentPage * pageSize, totalCount)}</strong> of{' '}
                <strong>{totalCount}</strong> entries
              </span>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginLeft: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  style={{
                    padding: '0.2rem 0.5rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: '#334155',
                  }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <button
                type="button"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1 || loading}
                className="btn btn-outline btn-sm"
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  opacity: currentPage <= 1 ? 0.45 : 1,
                  cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
                  borderColor: '#cbd5e1',
                }}
              >
                ← Previous
              </button>

              <span style={{
                fontSize: '0.82rem',
                fontWeight: 700,
                color: '#334155',
                padding: '0 0.5rem',
              }}>
                Page {currentPage} of {totalPages}
              </span>

              <button
                type="button"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages || loading}
                className="btn btn-outline btn-sm"
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  opacity: currentPage >= totalPages ? 0.45 : 1,
                  cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
                  borderColor: '#cbd5e1',
                }}
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Audit Detail Modal */}
      <Modal
        isOpen={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        title="Audit Log Entry Details"
        maxWidth="680px"
      >
        {selectedLog && (
          <div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '0.85rem',
              marginBottom: '1.25rem',
              backgroundColor: '#f8fafc',
              padding: '1rem',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              fontSize: '0.85rem',
            }}>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 700, display: 'block' }}>Log ID</span>
                <span style={{ fontWeight: 800, color: '#0f172a' }}>#{selectedLog.id}</span>
              </div>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 700, display: 'block' }}>Timestamp</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{selectedLog.formatted_time || selectedLog.timestamp}</span>
              </div>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 700, display: 'block' }}>Actor</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{selectedLog.actor_username || 'System'} ({selectedLog.actor_role || 'Role'})</span>
              </div>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 700, display: 'block' }}>IP Address</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{selectedLog.ip_address || 'Internal/None'}</span>
              </div>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 700, display: 'block' }}>Action</span>
                <span style={{
                  display: 'inline-block',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                  fontWeight: 800,
                  fontSize: '0.78rem',
                  ...getActionBadgeStyle(selectedLog.action),
                }}>
                  {selectedLog.action}
                </span>
              </div>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 700, display: 'block' }}>Category</span>
                <span style={{
                  display: 'inline-block',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                  fontWeight: 800,
                  fontSize: '0.78rem',
                  ...getCategoryBadgeStyle(selectedLog.category),
                }}>
                  {selectedLog.category_display || selectedLog.category}
                </span>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <span style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 700, display: 'block' }}>Target Object</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{selectedLog.target_repr || 'None'}</span>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <span style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 700, display: 'block' }}>Office &amp; Division</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>
                  {selectedLog.office_name || 'N/A'} {selectedLog.division_name ? `• ${selectedLog.division_name}` : ''}
                </span>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <span style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 700, display: 'block' }}>Summary Description</span>
                <span style={{ color: '#334155', fontWeight: 600 }}>{selectedLog.description || 'No description recorded.'}</span>
              </div>
            </div>

            {/* Structured Details JSON */}
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '0.4rem',
              }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>
                  Audit Details &amp; Payload Metadata
                </span>
                <button
                  type="button"
                  onClick={handleCopyDetails}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: copied ? '#059669' : 'var(--dole-blue)',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {copied ? '✓ Copied!' : 'Copy JSON'}
                </button>
              </div>

              <pre style={{
                backgroundColor: '#0f172a',
                color: '#f8fafc',
                padding: '0.85rem 1rem',
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontFamily: 'monospace',
                overflowX: 'auto',
                maxHeight: '220px',
                margin: 0,
              }}>
                {JSON.stringify(selectedLog.details && Object.keys(selectedLog.details).length > 0 ? selectedLog.details : { message: 'No structured payload attached' }, null, 2)}
              </pre>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="btn btn-primary"
                style={{
                  minHeight: '38px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  padding: '0 1.25rem',
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
