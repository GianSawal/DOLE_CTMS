import { useState, useEffect, useCallback } from 'react';
import { ClipboardPen, Users } from 'lucide-react';
import { staffApi } from '../../api/staff';
import { useAuth } from '../../context/AuthContext';
import { PageHeader, Notice } from '../../components/ui';
import WalkinModal from '../../components/WalkinModal';
import Modal from '../../components/Modal';
import PrintSlip from '../../components/PrintSlip';
import ArrivingReferrals from '../../components/ArrivingReferrals';

const REFRESH_MS = 10000;

/**
 * Registration desk: registers walk-in clients into the office's shared queue and prints
 * their slip, and confirms clients other offices referred here when they arrive.
 * The only page a Registration Desk account can open.
 */
export default function StaffRegistration() {
  const { user } = useAuth();
  const [desk, setDesk] = useState(null);
  const [error, setError] = useState('');
  const [registering, setRegistering] = useState(false);
  const [printedTx, setPrintedTx] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const loadDesk = useCallback(async () => {
    try {
      setDesk(await staffApi.getRegistrationDesk());
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load the registration desk.');
    }
  }, []);

  useEffect(() => {
    loadDesk();
    const timer = setInterval(loadDesk, REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadDesk]);

  const office = desk?.office || user?.registration;
  const officeId = desk?.office?.id || user?.registration?.office_id;

  const referrals = desk?.expected_referrals || [];

  const handleArrived = async (ref) => {
    try {
      setConfirming(true);
      setNotice(null);
      const tx = await staffApi.markReferralArrived(ref.id);
      setPrintedTx(tx);
      setNotice({ type: 'success', text: `${ref.client_name || 'The referred client'} joined the line as Queue ${tx.queue_no}. Hand them the new slip.` });
    } catch (err) {
      setNotice({ type: 'error', text: err.message || 'Could not confirm the arrival.' });
    } finally {
      setConfirming(false);
      loadDesk();
    }
  };

  const handleCreated = (tx) => {
    setRegistering(false);
    setPrintedTx(tx);
    setNotice({ type: 'success', text: `Queue ${tx.queue_no} registered. Hand the client their slip.` });
    loadDesk();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-ground)' }}>
      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '720px', margin: '0 auto', width: '100%' }}>
        <PageHeader
          title="Registration"
          subtitle={`Register walk-in clients for ${office?.name || office?.office_name || 'your office'}. They join the office's queue and are called on the TV.`}
        />

        <Notice notice={error ? { type: 'error', text: error } : notice} onDismiss={error ? undefined : () => setNotice(null)} />

        <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Users size={28} aria-hidden="true" style={{ color: 'var(--dole-blue)', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: '2rem', fontWeight: 800, lineHeight: 1, color: 'var(--text-primary)' }}>
              {desk ? desk.waiting_count : '—'}
            </div>
            <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              {desk?.waiting_count === 1 ? 'client waiting' : 'clients waiting'}
              {desk?.priority_waiting ? ` · ${desk.priority_waiting} priority` : ''}
            </div>
          </div>
        </div>

        <button
          className="btn btn-primary btn-lg w-full"
          onClick={() => { setNotice(null); setRegistering(true); }}
          disabled={!officeId}
          style={{ minHeight: '64px', fontSize: '1.1rem', gap: '0.6rem' }}
        >
          <ClipboardPen size={22} aria-hidden="true" /> Register Client
        </button>

        <section className="card" style={{ marginTop: '1.25rem', borderTop: '5px solid #6d28d9' }}>
          <h2 style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6d28d9', margin: '0 0 0.35rem' }}>
            Arriving referrals · {referrals.length}
          </h2>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Clients other offices sent here. When one arrives and shows their first slip, press Arrived: they join the
            line and get a new slip with this office's queue number.
          </p>
          <ArrivingReferrals referrals={referrals} busy={confirming} onArrived={handleArrived} />
        </section>

        <WalkinModal
          isOpen={registering}
          onClose={() => setRegistering(false)}
          officeId={officeId}
          onCreated={handleCreated}
        />
        <Modal isOpen={!!printedTx} onClose={() => setPrintedTx(null)} title="Queue Slip">
          <PrintSlip transaction={printedTx} onClose={() => setPrintedTx(null)} />
        </Modal>
      </main>
    </div>
  );
}
