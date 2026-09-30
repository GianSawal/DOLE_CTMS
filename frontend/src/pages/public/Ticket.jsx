import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { publicApi } from '../../api/public';
import Header from '../../components/Header';
import { translations } from '../../locales/translations';

export default function Ticket() {
  const { ticketToken } = useParams();
  const [lang, setLang] = useState('en');
  const t = translations[lang];

  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Polling every 5 seconds (mandated by §1 hard requirements)
  useEffect(() => {
    let isMounted = true;

    async function fetchTicket() {
      try {
        const data = await publicApi.getTicket(ticketToken);
        if (isMounted) {
          setTicket(data);
          setError('');
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Ticket not found.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchTicket();
    const interval = setInterval(fetchTicket, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [ticketToken]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>Loading your ticket...</p>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div style={{ minHeight: '100vh', padding: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ maxWidth: '440px', textAlign: 'center', padding: '2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>❌</div>
          <h2 style={{ color: 'var(--dole-red)', marginBottom: '0.5rem' }}>Ticket Not Found</h2>
          <p style={{ color: 'var(--text-secondary)' }}>{error || 'Invalid or expired ticket link.'}</p>
        </div>
      </div>
    );
  }

  const getStatusBadge = () => {
    switch (ticket.status) {
      case 'waiting':
        return <span className="badge badge-waiting">{t.status_waiting}</span>;
      case 'serving':
        return <span className="badge badge-serving" style={{ fontSize: '0.9rem', padding: '0.4rem 0.85rem' }}>🔔 {t.status_serving}</span>;
      case 'pending':
        return <span className="badge badge-pending" style={{ fontSize: '0.9rem', padding: '0.4rem 0.85rem' }}>⏳ Pending / Processing</span>;
      case 'done':
        return <span className="badge badge-done">{t.status_done}</span>;
      case 'no_show':
        return <span className="badge badge-no_show">{t.status_no_show}</span>;
      case 'cancelled':
        return <span className="badge badge-cancelled">{t.status_cancelled}</span>;
      default:
        return <span className="badge badge-waiting">{ticket.status}</span>;
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header
        lang={lang}
        setLang={setLang}
        title={ticket.office_name}
        subtitle="Live Queue Ticket"
      />

      <main style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem 1rem',
      }}>
        <div className="card" style={{
          width: '100%',
          maxWidth: '480px',
          textAlign: 'center',
          padding: '2rem 1.5rem',
          borderTop: ticket.status === 'serving' ? '6px solid var(--dole-blue)' : (ticket.status === 'done' ? '6px solid var(--dole-green)' : 'var(--border-hairline)'),
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
            <img
              src="/dolelogo.png"
              alt="DOLE Official Seal"
              className="dole-logo-img"
              style={{ width: '56px', height: '56px', objectFit: 'contain' }}
            />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            {getStatusBadge()}
          </div>

          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t.queue_number}
          </div>

          {/* Huge Queue Number */}
          <div className="mono" style={{
            fontSize: '4.5rem',
            fontWeight: 900,
            lineHeight: 1,
            margin: '0.5rem 0',
            color: ticket.status === 'serving' ? 'var(--dole-blue)' : 'var(--text-primary)',
            letterSpacing: '-0.03em',
          }}>
            {ticket.queue_no}
          </div>

          {ticket.is_priority && (
            <div style={{
              display: 'inline-block',
              backgroundColor: 'var(--dole-gold-light)',
              color: 'var(--dole-gold-dark)',
              border: '1px solid #fde68a',
              borderRadius: 'var(--radius-full)',
              padding: '0.25rem 0.75rem',
              fontSize: '0.75rem',
              fontWeight: 700,
              marginBottom: '1rem',
            }}>
              ★ Priority Client (RA 9994 / RA 7277)
            </div>
          )}

          {/* Serving announcement when called */}
          {ticket.status === 'serving' && (
            <div style={{
              backgroundColor: 'var(--dole-blue-light)',
              border: '2px solid var(--dole-blue)',
              borderRadius: 'var(--radius-md)',
              padding: '1.25rem',
              margin: '1.25rem 0',
              animation: 'pulse 2s infinite',
            }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--dole-blue)' }}>
                {t.now_serving_at}
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--dole-blue)', marginTop: '0.25rem' }}>
                {ticket.counter || 'Designated Counter'}
              </div>
            </div>
          )}

          {/* Waiting status information */}
          {ticket.status === 'waiting' && (
            <div style={{
              backgroundColor: '#f8fafc',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '1rem',
              margin: '1.25rem 0',
            }}>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {ticket.ahead}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {t.ahead_label}
              </div>
            </div>
          )}

          {/* DONE state & Survey Hand-off */}
          {ticket.status === 'done' && (
            <div style={{ margin: '1.75rem 0' }}>
              {ticket.surveyed ? (
                <div style={{
                  backgroundColor: 'var(--dole-green-light)',
                  border: '1px solid #a7f3d0',
                  color: '#065f46',
                  borderRadius: 'var(--radius-md)',
                  padding: '1.25rem',
                }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🎉</div>
                  <div style={{ fontWeight: 700, fontSize: '1rem' }}>
                    {t.survey_completed}
                  </div>
                </div>
              ) : (
                ticket.survey_url && (
                  <div>
                    <a
                      href={ticket.survey_url}
                      className="btn btn-gold btn-lg w-full"
                      style={{ fontSize: '1.15rem', boxShadow: 'var(--shadow-md)' }}
                    >
                      {t.rate_service_btn}
                    </a>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                      Click above to rate your experience in the DOLE CSM Survey
                    </p>
                  </div>
                )
              )}
            </div>
          )}

          {/* Transaction Metadata Details */}
          <div style={{
            borderTop: 'var(--border-hairline)',
            marginTop: '1.5rem',
            paddingTop: '1.25rem',
            textAlign: 'left',
            fontSize: '0.85rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>{t.service_label}:</span>
              <strong>{ticket.service_name}</strong>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>{t.transaction_no}:</span>
              <span className="mono" style={{ fontWeight: 700 }}>{ticket.transaction_no}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>{t.claim_code}:</span>
              <span className="mono" style={{ fontWeight: 800, letterSpacing: '0.1em', color: 'var(--dole-blue)' }}>
                {ticket.claim_code}
              </span>
            </div>
          </div>

          <p style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            marginTop: '1.5rem',
            lineHeight: 1.4,
          }}>
            ℹ️ {t.keep_ticket_note}
          </p>
        </div>
      </main>
    </div>
  );
}
