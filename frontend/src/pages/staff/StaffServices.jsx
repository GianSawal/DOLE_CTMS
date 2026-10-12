import { useState, useEffect, useCallback } from 'react';
import { staffApi } from '../../api/staff';
import { PageHeader, Notice } from '../../components/ui';

export default function StaffServices() {
  const [services, setServices] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [notice, setNotice] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [list, sum] = await Promise.all([
        staffApi.getServices({ search: search.trim(), division: divisionFilter }),
        staffApi.getServicesSummary().catch(() => null),
      ]);
      setServices(Array.isArray(list) ? list : (list?.results || []));
      setSummary(sum);
    } catch (err) {
      setNotice({ type: 'error', text: err.message || 'Failed to load services.' });
    } finally {
      setLoading(false);
    }
  }, [search, divisionFilter]);

  useEffect(() => {
    const t = setTimeout(fetchData, 250);
    return () => clearTimeout(t);
  }, [fetchData]);

  useEffect(() => {
    staffApi.getDivisions().then(d => setDivisions(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const changeDivision = async (service, value) => {
    try {
      setSavingId(service.id);
      const updated = await staffApi.setServiceDivision(service.id, value ? Number(value) : null);
      setServices(list => list.map(s => (s.id === updated.id ? updated : s)));
      setNotice({ type: 'success', text: `"${service.name}" is now ${updated.division_name || 'untagged'}.` });
      staffApi.getServicesSummary().then(setSummary).catch(() => {});
    } catch (err) {
      setNotice({ type: 'error', text: err.message || 'Could not change the division.' });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-ground)' }}>

      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1100px', margin: '0 auto', width: '100%' }}>
        <PageHeader
          title="Services"
          subtitle="Tag each service with its division. Divisions are for classification and reports only; any window can serve any service."
        />

        {summary && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <span className="staff-stat-pill staff-stat-pill-blue">{summary.total_services} services</span>
            {Object.entries(summary.by_division || {}).map(([name, count]) => (
              <span key={name} className="staff-stat-pill staff-stat-pill-green">{name}: {count}</span>
            ))}
            {summary.untagged_services > 0 && (
              <span className="staff-stat-pill staff-stat-pill-amber">{summary.untagged_services} without a division</span>
            )}
          </div>
        )}

        <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search services" aria-label="Search services" style={{ minHeight: '44px' }} />
          <select value={divisionFilter} onChange={(e) => setDivisionFilter(e.target.value)} aria-label="Division" style={{ minHeight: '44px' }}>
            <option value="">All divisions</option>
            {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value="none">Without a division</option>
          </select>
        </div>

        <Notice notice={notice} onDismiss={() => setNotice(null)} />

        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.92rem', minWidth: '560px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={{ padding: '0.75rem 1rem' }}>Service</th>
                <th style={{ padding: '0.75rem 1rem', width: '120px' }}>Status</th>
                <th style={{ padding: '0.75rem 1rem', width: '220px' }}>Division</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading services…</td></tr>
              ) : services.length === 0 ? (
                <tr><td colSpan={3} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No services match.</td></tr>
              ) : services.map(s => (
                <tr key={s.id} style={{ borderTop: 'var(--border-hairline)' }}>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)', fontWeight: 600 }}>{s.name}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span className={s.is_active ? 'badge badge-done' : 'badge badge-waiting'}>{s.is_active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td style={{ padding: '0.5rem 1rem' }}>
                    <select
                      value={s.division ?? ''}
                      disabled={savingId === s.id}
                      onChange={(e) => changeDivision(s, e.target.value)}
                      aria-label={`Division of ${s.name}`}
                      style={{ minHeight: '40px', padding: '0.4rem 0.6rem', fontSize: '0.9rem' }}
                    >
                      <option value="">No division</option>
                      {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
          Service names and availability are managed in the CSM system.
        </p>
      </main>
    </div>
  );
}
