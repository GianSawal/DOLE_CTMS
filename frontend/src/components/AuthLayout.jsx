import '../staff.css';

/** Split layout for the sign-in and password pages: brand panel on the left, form on the right. */
export default function AuthLayout({ children }) {
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="auth-aside-brand">
          <img src="/dolelogo.png" alt="DOLE seal" />
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#a9afcf' }}>
              Republic of the Philippines
            </div>
            <div style={{ color: '#fff', fontWeight: 700 }}>Department of Labor and Employment</div>
          </div>
        </div>
        <div>
          <h2>Client Transaction Monitoring System</h2>
          <p>
            One shared queue per office, service windows, client hand-offs, and the CSM survey,
            all in one place for DOLE Regional Office III and its field offices.
          </p>
        </div>
        <div style={{ fontSize: '0.78rem', color: '#7a81aa' }}>
          Accounts are shared with the DOLE CSM system.
        </div>
      </aside>
      <main className="auth-panel">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}
