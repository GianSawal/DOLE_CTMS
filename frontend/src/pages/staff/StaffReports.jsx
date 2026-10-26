import React, { useState, useEffect } from 'react';
import { staffApi } from '../../api/staff';
import { useAuth } from '../../context/AuthContext';
import { RefreshCw, Lock } from 'lucide-react';
import { PageHeader } from '../../components/ui';

export default function StaffReports() {
  const { user } = useAuth();

  const [officeFilter, setOfficeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Accounts that oversee a single office are locked to it
  useEffect(() => {
    if (user?.oversight_offices?.length === 1) {
      setOfficeFilter(String(user.oversight_offices[0].id));
    }
  }, [user]);

  const fetchReports = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await staffApi.getReportsSummary({
        office: officeFilter,
        date_from: dateFrom,
        date_to: dateTo,
      });
      setSummary(data);
    } catch (err) {
      setError(err.message || 'Error fetching report summary.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [officeFilter, dateFrom, dateTo]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>

      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
        <PageHeader title="Queue & Survey Performance Reports" subtitle="Monitor transaction throughput, wait times, and CSM survey compliance.">
          <button onClick={fetchReports} className="btn btn-outline btn-sm" disabled={loading}>
            <RefreshCw size={14} aria-hidden="true" /> {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </PageHeader>

        {/* Filters */}
        <div className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 250px' }}>
              <label style={{ fontSize: '0.8rem' }}>Filter by Office</label>
              {user?.oversight_offices?.length === 1 ? (
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
                  <Lock size={14} aria-hidden="true" style={{ marginRight: '0.35rem' }} />{user.oversight_offices[0].name}
                </div>
              ) : (
                <select
                  value={officeFilter}
                  onChange={(e) => setOfficeFilter(e.target.value)}
                  style={{ minHeight: '44px' }}
                >
                  <option value="">All Offices</option>
                  {user?.oversight_offices?.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              )}
            </div>

            <div style={{ flex: '1 1 160px' }}>
              <label style={{ fontSize: '0.8rem' }}>From Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{ minHeight: '44px' }}
              />
            </div>

            <div style={{ flex: '1 1 160px' }}>
              <label style={{ fontSize: '0.8rem' }}>To Date</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={{ minHeight: '44px' }}
              />
            </div>
          </div>
        </div>

        {error && (
          <div style={{
            backgroundColor: 'var(--dole-red-light)',
            border: '1px solid #fecaca',
            color: 'var(--dole-red)',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1rem',
            marginBottom: '1.5rem',
          }}>
            {error}
          </div>
        )}

        {/* Highlight Card: Survey Response Rate */}
        <div className="card" style={{
          marginBottom: '1.5rem',
          background: 'linear-gradient(135deg, #0305ba 0%, #1e1b4b 100%)',
          color: '#ffffff',
          padding: '2rem',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1.5rem' }}>
            <div>
              <span style={{
                backgroundColor: 'rgba(255,255,255,0.15)',
                padding: '0.25rem 0.75rem',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}>
                Key Integration Metric
              </span>
              <h2 style={{ fontSize: '1.75rem', margin: '0.5rem 0 0.25rem', color: '#ffffff' }}>
                CSM Survey Response Rate
              </h2>
              <p style={{ opacity: 0.8, fontSize: '0.95rem', margin: 0 }}>
                Percentage of completed (Done) transactions that submitted client satisfaction feedback.
              </p>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div className="mono" style={{ fontSize: '3.5rem', fontWeight: 900, color: 'var(--dole-gold)', lineHeight: 1 }}>
                {summary ? `${summary.survey_rate_percent}%` : '--%'}
              </div>
              <div style={{ opacity: 0.8, fontSize: '0.85rem', marginTop: '0.35rem' }}>
                {summary?.surveyed_count || 0} surveyed out of {summary?.total_done || 0} completed visits
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{
            marginTop: '1.5rem',
            height: '10px',
            backgroundColor: 'rgba(255,255,255,0.2)',
            borderRadius: '9999px',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, summary?.survey_rate_percent || 0)}%`,
              backgroundColor: 'var(--dole-gold)',
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>

        {/* Metrics Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1.25rem',
          marginBottom: '1.5rem',
        }}>
          <div className="card">
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
              Total Checked In
            </div>
            <div className="mono" style={{ fontSize: '2.25rem', fontWeight: 800, marginTop: '0.25rem' }}>
              {summary?.total_checked_in ?? '--'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              All visits created
            </div>
          </div>

          <div className="card" style={{ borderLeft: '4px solid var(--dole-green)' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
              Successfully Served
            </div>
            <div className="mono" style={{ fontSize: '2.25rem', fontWeight: 800, color: 'var(--dole-green)', marginTop: '0.25rem' }}>
              {summary?.total_done ?? '--'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Marked Done by staff
            </div>
          </div>

          <div className="card">
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
              Avg Waiting Time
            </div>
            <div className="mono" style={{ fontSize: '2.25rem', fontWeight: 800, color: 'var(--dole-blue)', marginTop: '0.25rem' }}>
              {summary?.avg_wait_min ?? 0} <span style={{ fontSize: '1rem', fontWeight: 600 }}>min</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Check-in to counter call
            </div>
          </div>

          <div className="card">
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
              Avg Service Time
            </div>
            <div className="mono" style={{ fontSize: '2.25rem', fontWeight: 800, color: 'var(--dole-blue)', marginTop: '0.25rem' }}>
              {summary?.avg_service_min ?? 0} <span style={{ fontSize: '1rem', fontWeight: 600 }}>min</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Window call to completion
            </div>
          </div>

          <div className="card">
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
              Missed / Cancelled
            </div>
            <div className="mono" style={{ fontSize: '2.25rem', fontWeight: 800, color: 'var(--dole-red)', marginTop: '0.25rem' }}>
              {(summary?.total_no_show || 0) + (summary?.total_cancelled || 0)}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              {summary?.total_no_show || 0} no-shows · {summary?.total_cancelled || 0} cancelled
            </div>
          </div>

          <div className="card">
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
              Referrals
            </div>
            <div className="mono" style={{ fontSize: '2.25rem', fontWeight: 800, color: '#6d28d9', marginTop: '0.25rem' }}>
              {summary ? summary.total_referred_out : '--'}
              <span style={{ fontSize: '1rem', fontWeight: 600 }}> out</span>
              {' · '}
              {summary ? summary.total_referred_in : '--'}
              <span style={{ fontSize: '1rem', fontWeight: 600 }}> in</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Sent to / arrived from other offices
              {summary?.total_referred_not_arrived ? ` · ${summary.total_referred_not_arrived} sent did not arrive` : ''}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
