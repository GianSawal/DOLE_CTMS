import React, { useState, useEffect, useMemo } from 'react';
import { staffApi } from '../../api/staff';
import { useAuth } from '../../context/AuthContext';
import Navbar from '../../components/Navbar';
import Modal from '../../components/Modal';
import PrintSlip from '../../components/PrintSlip';
import Pagination, { paginateArray } from '../../components/Pagination';

const ITEMS_PER_PAGE = 10;

const DIVISION_BADGES = {
  'TSSD 1': { color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  'TSSD1': { color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  'TSSD 2': { color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd' },
  'TSSD2': { color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd' },
  'IMSD': { color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  'MALSU': { color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
};

export default function StaffTransactions() {
  const { user } = useAuth();

  const [transactions, setTransactions] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState('');
  const [selectedTx, setSelectedTx] = useState(null);
  const [viewDetailsTx, setViewDetailsTx] = useState(null);

  const formatDateTime = (dateStr) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return {
      date: d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }),
      time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
  };

  // Filters
  const [officeFilter, setOfficeFilter] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Strict RBAC: Default and lock to assigned office for non-superusers
  useEffect(() => {
    if (user?.assigned_offices?.length === 1 && !user?.is_superuser) {
      setOfficeFilter(String(user.assigned_offices[0].id));
    }
  }, [user]);

  // Load divisions
  useEffect(() => {
    staffApi.getDivisions()
      .then(data => setDivisions(data || []))
      .catch(err => console.error('Failed to load divisions:', err));
  }, []);

  const fetchTransactions = async (query = searchQuery) => {
    try {
      setIsFetching(true);
      setError('');
      const data = await staffApi.getTransactions({
        office: officeFilter,
        division: divisionFilter,
        status: statusFilter,
        q: query,
        date_from: dateFrom,
        date_to: dateTo,
      });
      setTransactions(data || []);
    } catch (err) {
      setError(err.message || 'Error fetching transactions.');
    } finally {
      setIsFetching(false);
      setInitialLoading(false);
    }
  };

  // Automatically filter as the user types (with 300ms debounce for backend API sync)
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchTransactions(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, officeFilter, divisionFilter, statusFilter, dateFrom, dateTo]);

  // Instant client-side filtering while typing for 0ms response latency
  const filteredTransactions = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return transactions;
    return transactions.filter(tx => (
      (tx.queue_no && tx.queue_no.toLowerCase().includes(q)) ||
      (tx.transaction_no && tx.transaction_no.toLowerCase().includes(q)) ||
      (tx.client_name && tx.client_name.toLowerCase().includes(q)) ||
      (Array.isArray(tx.group_member_names) && tx.group_member_names.some(m => m && m.toLowerCase().includes(q))) ||
      (tx.assigned_personnel && tx.assigned_personnel.toLowerCase().includes(q)) ||
      (tx.division_name && tx.division_name.toLowerCase().includes(q)) ||
      (tx.service_name && tx.service_name.toLowerCase().includes(q)) ||
      (tx.counter_name && tx.counter_name.toLowerCase().includes(q)) ||
      (tx.claim_code && tx.claim_code.toLowerCase().includes(q))
    ));
  }, [transactions, searchQuery]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, officeFilter, divisionFilter, statusFilter, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE);
  const paginatedTransactions = paginateArray(filteredTransactions, currentPage, ITEMS_PER_PAGE);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchTransactions(searchQuery);
  };

  const handleResetFilters = () => {
    if (user?.assigned_offices?.length === 1 && !user?.is_superuser) {
      setOfficeFilter(String(user.assigned_offices[0].id));
    } else {
      setOfficeFilter('');
    }
    setDivisionFilter('');
    setStatusFilter('');
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
  };

  const handleUndoDone = async (txId) => {
    try {
      await staffApi.transactionAction(txId, 'undo-done');
      fetchTransactions(searchQuery);
    } catch (err) {
      alert(err.message || 'Cannot undo done.');
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'waiting':
        return <span className="badge badge-waiting">Waiting</span>;
      case 'serving':
        return <span className="badge badge-serving">Serving</span>;
      case 'pending':
        return <span className="badge badge-pending">Pending</span>;
      case 'done':
        return <span className="badge badge-done">Done</span>;
      case 'no_show':
        return <span className="badge badge-no_show">No-show</span>;
      case 'cancelled':
        return <span className="badge badge-cancelled">Cancelled</span>;
      default:
        return <span className="badge badge-waiting">{status}</span>;
    }
  };

  const getDivisionBadge = (divisionName) => {
    if (!divisionName) return null;
    const style = DIVISION_BADGES[divisionName.trim()] || {
      color: '#475569',
      bg: '#f1f5f9',
      border: '#cbd5e1'
    };
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: '0.75rem',
        fontWeight: 700,
        padding: '0.2rem 0.6rem',
        borderRadius: '9999px',
        color: style.color,
        backgroundColor: style.bg,
        border: `1px solid ${style.border}`,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}>
        {divisionName}
      </span>
    );
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar />

      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1440px', margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', color: 'var(--text-primary)', margin: 0 }}>
              Transaction History
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Search and filter client visits, view queue status, division assignments, and verify CSM survey completion.
            </p>
          </div>
          <button onClick={() => fetchTransactions(searchQuery)} className="btn btn-outline btn-sm">
            🔄 Refresh
          </button>
        </div>

        {/* Filters Card */}
        <div className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 180px' }}>
              <label style={{ fontSize: '0.8rem' }}>Office</label>
              {user?.assigned_offices?.length === 1 && !user?.is_superuser ? (
                <div style={{
                  minHeight: '44px',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 0.875rem',
                  backgroundColor: 'rgba(3, 5, 186, 0.05)',
                  border: '1px solid rgba(3, 5, 186, 0.2)',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 700,
                  color: 'var(--dole-blue)',
                  fontSize: '0.9rem',
                }}>
                  🔒 {user.assigned_offices[0].name}
                </div>
              ) : (
                <select
                  value={officeFilter}
                  onChange={(e) => setOfficeFilter(e.target.value)}
                  style={{ minHeight: '44px' }}
                >
                  <option value="">All Assigned Offices</option>
                  {user?.assigned_offices?.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              )}
            </div>

            <div style={{ flex: '1 1 150px' }}>
              <label style={{ fontSize: '0.8rem' }}>Division</label>
              <select
                value={divisionFilter}
                onChange={(e) => setDivisionFilter(e.target.value)}
                style={{ minHeight: '44px' }}
              >
                <option value="">All Divisions</option>
                {divisions.length > 0 ? (
                  divisions.map(d => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))
                ) : (
                  <>
                    <option value="TSSD 1">TSSD 1</option>
                    <option value="TSSD 2">TSSD 2</option>
                    <option value="IMSD">IMSD</option>
                    <option value="MALSU">MALSU</option>
                  </>
                )}
              </select>
            </div>

            <div style={{ flex: '1 1 130px' }}>
              <label style={{ fontSize: '0.8rem' }}>Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ minHeight: '44px' }}
              >
                <option value="">All Statuses</option>
                <option value="waiting">Waiting</option>
                <option value="serving">Serving</option>
                <option value="pending">Pending</option>
                <option value="done">Done</option>
                <option value="no_show">No-show</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div style={{ flex: '1 1 135px' }}>
              <label style={{ fontSize: '0.8rem' }}>Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{ minHeight: '44px' }}
              />
            </div>

            <div style={{ flex: '1 1 135px' }}>
              <label style={{ fontSize: '0.8rem' }}>Date To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={{ minHeight: '44px' }}
              />
            </div>

            <div style={{ flex: '2 1 240px' }}>
              <label style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Search (Tx / Queue / Client / Personnel)</span>
                {isFetching && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--dole-blue)', fontWeight: 600 }}>
                    Searching...
                  </span>
                )}
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Type to filter instantly..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    minHeight: '44px',
                    width: '100%',
                    paddingRight: searchQuery ? '2.25rem' : '0.875rem'
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                      padding: '4px',
                      borderRadius: '50%',
                    }}
                    title="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="btn btn-primary" style={{ minHeight: '44px' }}>
                Filter
              </button>
              {(divisionFilter || statusFilter || searchQuery || dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="btn btn-outline"
                  style={{ minHeight: '44px' }}
                  title="Clear all filters"
                >
                  Clear
                </button>
              )}
            </div>
          </form>
        </div>

        {error && (
          <div style={{
            backgroundColor: 'var(--dole-red-light)',
            border: '1px solid #fecaca',
            color: 'var(--dole-red)',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
          }}>
            {error}
          </div>
        )}

        {/* Table of Transactions */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
              <thead style={{ backgroundColor: '#f8fafc', borderBottom: 'var(--border-hairline)' }}>
                <tr>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 700 }}>Queue #</th>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 700 }}>Transaction No.</th>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 700 }}>Division</th>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 700 }}>Service</th>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 700 }}>Assigned Personnel</th>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 700 }}>Client Name</th>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 700 }}>Status</th>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 700 }}>CSM Surveyed?</th>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 700 }}>Checked In</th>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 700 }}>Started At</th>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 700 }}>Done At</th>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 700 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {initialLoading ? (
                  <tr>
                    <td colSpan="12" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      Loading transactions...
                    </td>
                  </tr>
                ) : filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan="12" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      {searchQuery ? `No transactions matching "${searchQuery}".` : 'No transactions found matching your criteria.'}
                    </td>
                  </tr>
                ) : (
                  paginatedTransactions.map(tx => (
                    <tr key={tx.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.875rem 1rem' }}>
                        <span className="mono" style={{ fontWeight: 800, fontSize: '1.05rem', color: tx.is_priority ? 'var(--dole-gold-dark)' : 'var(--text-primary)' }}>
                          {tx.queue_no}
                        </span>
                        {tx.is_priority && (
                          <span style={{ fontSize: '0.7rem', display: 'block', color: 'var(--dole-gold-dark)', fontWeight: 700 }}>Priority</span>
                        )}
                      </td>
                      <td style={{ padding: '0.875rem 1rem' }}>
                        <span className="mono" style={{ fontWeight: 600 }}>{tx.transaction_no}</span>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Code: {tx.claim_code}</div>
                      </td>
                      <td style={{ padding: '0.875rem 1rem' }}>
                        {getDivisionBadge(tx.division_name) || (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '0.875rem 1rem', maxWidth: '240px' }}>
                        {tx.service_name}
                      </td>
                      <td style={{ padding: '0.875rem 1rem' }}>
                        {tx.assigned_personnel ? (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            fontSize: '0.82rem',
                            fontWeight: 600,
                            color: '#1e293b',
                            backgroundColor: '#f1f5f9',
                            padding: '0.25rem 0.55rem',
                            borderRadius: '6px',
                            border: '1px solid #e2e8f0',
                            whiteSpace: 'nowrap',
                          }}>
                            👤 {tx.assigned_personnel}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                            — Unassigned —
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.875rem 1rem' }}>
                        <div>{tx.client_name || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Anonymous</span>}</div>
                        {Array.isArray(tx.group_member_names) && tx.group_member_names.length > 0 && (
                          <div style={{ marginTop: '0.25rem', fontSize: '0.73rem', color: '#475569', lineHeight: 1.35 }}>
                            <span style={{ fontWeight: 600, color: 'var(--dole-blue)' }}>👥 Members ({tx.group_member_names.length}):</span> {tx.group_member_names.join(', ')}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.875rem 1rem' }}>
                        {getStatusBadge(tx.status)}
                      </td>
                      <td style={{ padding: '0.875rem 1rem' }}>
                        {tx.is_surveyed ? (
                          <span className="badge badge-done">✓ Surveyed</span>
                        ) : tx.status === 'done' ? (
                          <span className="badge badge-waiting">Pending</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>N/A</span>
                        )}
                      </td>
                      {/* Checked In */}
                      <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {(() => {
                          const dt = formatDateTime(tx.checked_in_at);
                          if (!dt) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
                          return (
                            <div>
                              <div style={{ fontWeight: 600, color: '#1e293b' }}>{dt.date}</div>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{dt.time}</div>
                            </div>
                          );
                        })()}
                      </td>
                      {/* Started At */}
                      <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {(() => {
                          const dt = formatDateTime(tx.started_at || tx.called_at);
                          if (!dt) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
                          return (
                            <div>
                              <div style={{ fontWeight: 600, color: '#047857' }}>{dt.date}</div>
                              <div style={{ fontSize: '0.74rem', color: '#059669' }}>{dt.time}</div>
                            </div>
                          );
                        })()}
                      </td>
                      {/* Done At */}
                      <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {(() => {
                          const dt = formatDateTime(tx.done_at);
                          if (!dt) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
                          return (
                            <div>
                              <div style={{ fontWeight: 600, color: '#1e293b' }}>{dt.date}</div>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{dt.time}</div>
                              {tx.service_duration_display && (
                                <div style={{ marginTop: '0.2rem' }}>
                                  <span style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.2rem',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    padding: '0.1rem 0.4rem',
                                    borderRadius: '4px',
                                    backgroundColor: '#ecfdf5',
                                    color: '#065f46',
                                    border: '1px solid #a7f3d0'
                                  }}>
                                    ⏱️ {tx.service_duration_display}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td style={{ padding: '0.875rem 1rem' }}>
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => setViewDetailsTx(tx)}
                            className="btn btn-outline btn-sm"
                            style={{ minHeight: '30px', padding: '0.2rem 0.5rem', fontSize: '0.78rem' }}
                            title="View transaction lifecycle dates & details"
                          >
                            Details
                          </button>
                          <button
                            onClick={() => setSelectedTx(tx)}
                            className="btn btn-outline btn-sm"
                            style={{ minHeight: '30px', padding: '0.2rem 0.5rem', fontSize: '0.78rem' }}
                            title="Print or preview transaction slip"
                          >
                            Slip
                          </button>
                          {tx.status === 'done' && !tx.is_surveyed && (
                            <button
                              onClick={() => handleUndoDone(tx.id)}
                              className="btn btn-outline btn-sm"
                              style={{ minHeight: '30px', padding: '0.2rem 0.5rem', color: 'var(--dole-red)', fontSize: '0.78rem' }}
                            >
                              Undo Done
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={filteredTransactions.length}
            pageSize={ITEMS_PER_PAGE}
          />
        </div>
      </main>

      {/* Transaction Details Modal */}
      <Modal
        isOpen={!!viewDetailsTx}
        onClose={() => setViewDetailsTx(null)}
        title="Transaction Details"
      >
        {viewDetailsTx && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', fontFamily: 'var(--font-ui)' }}>
            {/* Header info */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1rem',
              borderRadius: '8px',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
            }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Queue Number</div>
                <div className="mono" style={{ fontSize: '2rem', fontWeight: 900, color: viewDetailsTx.is_priority ? 'var(--dole-gold-dark)' : 'var(--text-primary)' }}>
                  {viewDetailsTx.queue_no}
                  {viewDetailsTx.is_priority && <span style={{ fontSize: '0.75rem', marginLeft: '0.5rem', color: 'var(--dole-gold-dark)', fontWeight: 700 }}>★ Priority</span>}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Tx: <strong className="mono">{viewDetailsTx.transaction_no}</strong> | Survey Code: <strong className="mono">{viewDetailsTx.claim_code}</strong>
                </div>
              </div>
              <div>
                {getStatusBadge(viewDetailsTx.status)}
              </div>
            </div>

            {/* Date & Time Lifecycle Card */}
            <div style={{
              padding: '1.25rem',
              borderRadius: '8px',
              backgroundColor: '#ffffff',
              border: '1px solid #cbd5e1',
            }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 1rem 0', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>📅</span> Transaction Lifecycle Dates & Timestamps
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                {/* Checked In */}
                <div style={{ padding: '0.75rem', borderRadius: '6px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
                    📥 Checked In Date & Time
                  </div>
                  {viewDetailsTx.checked_in_at ? (
                    <div style={{ marginTop: '0.35rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0f172a' }}>
                        {new Date(viewDetailsTx.checked_in_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
                        {new Date(viewDetailsTx.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </div>
                    </div>
                  ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </div>

                {/* Started At */}
                <div style={{ padding: '0.75rem', borderRadius: '6px', backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0' }}>
                  <div style={{ fontSize: '0.72rem', color: '#065f46', fontWeight: 700, textTransform: 'uppercase' }}>
                    🚀 Started At (Start of Transaction)
                  </div>
                  {(viewDetailsTx.started_at || viewDetailsTx.called_at) ? (
                    <div style={{ marginTop: '0.35rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#065f46' }}>
                        {new Date(viewDetailsTx.started_at || viewDetailsTx.called_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#047857' }}>
                        {new Date(viewDetailsTx.started_at || viewDetailsTx.called_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: '0.35rem', color: '#94a3b8', fontSize: '0.82rem', fontStyle: 'italic' }}>
                      Waiting in queue (not started yet)
                    </div>
                  )}
                </div>

                {/* Done At */}
                <div style={{ padding: '0.75rem', borderRadius: '6px', backgroundColor: viewDetailsTx.done_at ? '#eff6ff' : '#f8fafc', border: viewDetailsTx.done_at ? '1px solid #bfdbfe' : '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.72rem', color: viewDetailsTx.done_at ? '#1e40af' : '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
                    🏁 Done At (Transaction Completed)
                  </div>
                  {viewDetailsTx.done_at ? (
                    <div style={{ marginTop: '0.35rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e3a8a' }}>
                        {new Date(viewDetailsTx.done_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#1d4ed8' }}>
                        {new Date(viewDetailsTx.done_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: '0.35rem', color: '#94a3b8', fontSize: '0.82rem', fontStyle: 'italic' }}>
                      Not completed yet
                    </div>
                  )}
                </div>
              </div>

              {/* Duration highlight if completed */}
              {viewDetailsTx.service_duration_display && (
                <div style={{
                  marginTop: '0.85rem',
                  padding: '0.6rem 0.85rem',
                  borderRadius: '6px',
                  backgroundColor: '#f1f5f9',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '0.83rem',
                }}>
                  <span style={{ color: '#475569', fontWeight: 600 }}>Total Service Turnaround Time:</span>
                  <span style={{ fontWeight: 800, color: 'var(--dole-blue)' }}>⏱️ {viewDetailsTx.service_duration_display}</span>
                </div>
              )}
            </div>

            {/* Service & Personnel Details Card */}
            <div style={{
              padding: '1rem',
              borderRadius: '8px',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              fontSize: '0.85rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.45rem',
            }}>
              <div><strong>Office:</strong> {viewDetailsTx.office_name}</div>
              <div><strong>Division:</strong> {viewDetailsTx.division_name || '—'}</div>
              <div><strong>Service:</strong> {viewDetailsTx.service_name}</div>
              <div><strong>Assigned Personnel:</strong> {viewDetailsTx.assigned_personnel || '— Unassigned —'}</div>
              <div><strong>Client Name:</strong> {viewDetailsTx.client_name || 'Anonymous'}</div>
              {Array.isArray(viewDetailsTx.group_member_names) && viewDetailsTx.group_member_names.length > 0 && (
                <div>
                  <strong>Group Members ({viewDetailsTx.group_member_names.length}):</strong>
                  <div style={{ marginTop: '0.2rem', padding: '0.4rem 0.6rem', backgroundColor: '#ffffff', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                    {viewDetailsTx.group_member_names.map((name, i) => (
                      <div key={i}>• {name}</div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <strong>CSM Surveyed:</strong> {viewDetailsTx.is_surveyed ? <span className="badge badge-done" style={{ marginLeft: '0.35rem' }}>✓ Yes</span> : <span style={{ color: 'var(--text-muted)', marginLeft: '0.35rem' }}>No / Pending</span>}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button onClick={() => setViewDetailsTx(null)} className="btn btn-outline btn-sm">
                Close
              </button>
              <button onClick={() => { setSelectedTx(viewDetailsTx); setViewDetailsTx(null); }} className="btn btn-primary btn-sm">
                🖨️ View / Print Slip
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Slip Print Modal */}
      <Modal
        isOpen={!!selectedTx}
        onClose={() => setSelectedTx(null)}
        title="Transaction Slip"
      >
        <PrintSlip transaction={selectedTx} onClose={() => setSelectedTx(null)} />
      </Modal>
    </div>
  );
}
