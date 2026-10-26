import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { publicApi } from '../../api/public';
import Header from '../../components/Header';
import { translations } from '../../locales/translations';
import { rememberReferral, forgetReferral } from '../../utils/pendingReferrals';
import { useClientLang, rememberTicket, forgetTicket } from '../../utils/clientMemory';

// A ticket still in progress, worth offering back if the client scans the QR again
const ACTIVE_STATUSES = ['waiting', 'serving', 'pending', 'transferred'];
const PAGE_TITLE = document.title;

// Gets the attention of a client whose phone is in their pocket or showing another app.
// Each part may be refused by the browser (no vibration on iPhone, sound needs an earlier tap).
function alertCalled() {
  try { navigator.vibrate?.([400, 200, 400, 200, 400]); } catch { /* not supported */ }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35].forEach((at, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = i ? 660 : 880;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.3);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch { /* no audio */ }
}

// The office's CSM survey page, carrying the client's SURVEY CODE (?code=T2TW) so the
// CSM can pre-fill it instead of making the client type it.
function surveyLink(ticket) {
  try {
    const url = new URL(ticket.office_survey_url);
    if (ticket.claim_code) url.searchParams.set('code', ticket.claim_code);
    return url.toString();
  } catch {
    return ticket.office_survey_url;
  }
}

export default function Ticket() {
  const { ticketToken } = useParams();
  const [lang, setLang] = useClientLang();
  const t = translations[lang];

  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // A failed update (weak signal): keep showing the last ticket instead of replacing it
  const [offline, setOffline] = useState(false);
  const lastStatus = useRef(null);

  // Polling every 5 seconds (mandated by §1 hard requirements)
  useEffect(() => {
    let isMounted = true;
    lastStatus.current = null;

    async function fetchTicket() {
      try {
        const data = await publicApi.getTicket(ticketToken);
        // While the client is on the way, remember the referral for the other office's check-in page
        const ref = data.status === 'referred' ? data.referred_to : null;
        if (ref && !ref.arrived && !ref.expired) rememberReferral(ticketToken, ref.office_id);
        else forgetReferral(ticketToken);
        if (ACTIVE_STATUSES.includes(data.status)) rememberTicket(ticketToken, data.office);
        else forgetTicket(ticketToken);
        if (isMounted) {
          if (data.status === 'serving' && lastStatus.current && lastStatus.current !== 'serving') alertCalled();
          lastStatus.current = data.status;
          setTicket(data);
          setNotFound(false);
          setOffline(false);
        }
      } catch (err) {
        if (isMounted) {
          if (err.status === 404) {
            setNotFound(true);
            forgetTicket(ticketToken);
          } else {
            setOffline(true);
          }
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

  // The browser tab shows the call too, so a client in another app or tab notices it
  useEffect(() => {
    if (ticket?.status === 'serving') {
      document.title = `🔔 ${t.your_turn}: ${ticket.queue_no} → ${ticket.counter || t.designated_counter}`;
    } else {
      document.title = PAGE_TITLE;
    }
    return () => { document.title = PAGE_TITLE; };
  }, [ticket?.status, ticket?.queue_no, ticket?.counter, t]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>{t.loading_ticket}</p>
      </div>
    );
  }

  if (notFound || !ticket) {
    return (
      <div style={{ minHeight: '100vh', padding: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ maxWidth: '440px', textAlign: 'center', padding: '2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>{notFound ? '❌' : '📶'}</div>
          <h2 style={{ color: 'var(--dole-red)', marginBottom: '0.5rem' }}>{notFound ? t.ticket_not_found : t.loading_ticket}</h2>
          <p style={{ color: 'var(--text-secondary)' }}>{notFound ? t.ticket_not_found_desc : t.reconnecting}</p>
        </div>
      </div>
    );
  }

  // What the client should know or do now, for statuses that need explaining
  const statusNote = {
    pending: t.pending_note,
    transferred: t.transferred_note,
    cancelled: t.cancelled_note,
    no_show: t.no_show_note,
    done: ticket.surveyed ? null : t.done_note,
  }[ticket.status];

  const getStatusBadge = () => {
    switch (ticket.status) {
      case 'waiting':
        return <span className="badge badge-waiting">{t.status_waiting}</span>;
      case 'serving':
        return <span className="badge badge-serving" style={{ fontSize: '0.9rem', padding: '0.4rem 0.85rem' }}>🔔 {t.status_serving}</span>;
      case 'pending':
        return <span className="badge badge-pending" style={{ fontSize: '0.9rem', padding: '0.4rem 0.85rem' }}>⏳ {t.status_pending}</span>;
      case 'transferred':
        return <span className="badge badge-serving">{t.status_transferred}</span>;
      case 'done':
        return <span className="badge badge-done">{t.status_done}</span>;
      case 'no_show':
        return <span className="badge badge-no_show">{t.status_no_show}</span>;
      case 'cancelled':
        return <span className="badge badge-cancelled">{t.status_cancelled}</span>;
      case 'referred':
        return <span className="badge badge-referred">{t.status_referred}</span>;
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
          {offline && (
            <div role="status" style={{
              backgroundColor: '#fffbeb', border: '1px solid #fde68a', color: '#92400e',
              borderRadius: 'var(--radius-md)', padding: '0.55rem 0.75rem', marginBottom: '1rem',
              fontSize: '0.8rem', lineHeight: 1.4,
            }}>
              📶 {t.reconnecting}
            </div>
          )}
          <div style={{ marginBottom: '1rem' }}>
            {getStatusBadge()}
          </div>

          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t.queue_number}
          </div>

          {/* Huge Queue Number (small on a referred ticket: the number to remember is the new office's) */}
          <div className="mono" style={{
            fontSize: ticket.status === 'referred' ? '2rem' : '4.5rem',
            fontWeight: 900,
            lineHeight: 1,
            margin: '0.5rem 0',
            color: ticket.status === 'serving' ? 'var(--dole-blue)' : (ticket.status === 'referred' ? 'var(--text-muted)' : 'var(--text-primary)'),
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
              {t.priority_client}
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
                {ticket.counter || t.designated_counter}
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

          {/* What this status means for the client and what to do next */}
          {statusNote && (
            <div style={{
              backgroundColor: ticket.status === 'done' ? 'var(--dole-green-light)' : '#f8fafc',
              border: `1px solid ${ticket.status === 'done' ? '#a7f3d0' : 'var(--border-color)'}`,
              color: ticket.status === 'done' ? '#065f46' : 'var(--text-primary)',
              borderRadius: 'var(--radius-md)',
              padding: '1rem',
              margin: '1.25rem 0',
              fontSize: '0.92rem',
              lineHeight: 1.5,
              fontWeight: ticket.status === 'done' ? 700 : 400,
            }}>
              {statusNote}
            </div>
          )}

          {/* Referred: send the client to their new ticket at the other office */}
          {ticket.status === 'referred' && ticket.referred_to && (
            <div style={{
              backgroundColor: '#f5f3ff',
              border: '2px solid #ddd6fe',
              borderRadius: 'var(--radius-md)',
              padding: '1.25rem',
              margin: '1.25rem 0',
            }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#6d28d9' }}>{t.referred_to_label}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                {ticket.referred_to.office_name}
              </div>
              <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                {ticket.referred_to.service_name}
              </div>

              {ticket.referred_to.arrived ? (
                <>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>{t.referred_new_number}</div>
                  <div className="mono" style={{ fontSize: '3.5rem', fontWeight: 900, color: '#6d28d9', lineHeight: 1.05 }}>
                    {ticket.referred_to.queue_no}
                  </div>
                  <Link to={`/t/${ticket.referred_to.ticket_token}`} className="btn btn-primary w-full" style={{ marginTop: '1rem' }}>
                    {t.open_new_ticket}
                  </Link>
                </>
              ) : ticket.referred_to.expired ? (
                <p style={{ margin: '0.9rem 0 0', fontWeight: 600, color: 'var(--dole-red-dark)', lineHeight: 1.45 }}>
                  {t.referred_expired}
                </p>
              ) : (
                <>
                  <p style={{ margin: '0.9rem 0 0', fontSize: '0.92rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    {t.referred_scan_hint}
                  </p>
                  <p style={{ margin: '0.6rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {t.referred_valid_until}{' '}
                    {new Date(ticket.referred_to.expires_at).toLocaleString(lang === 'fil' ? 'fil-PH' : 'en-PH', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </p>
                </>
              )}
            </div>
          )}

          {/* DONE and already surveyed: thank the client */}
          {ticket.status === 'done' && ticket.surveyed && (
            <div style={{ margin: '1.75rem 0' }}>
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
            {ticket.referred_from_office && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>{t.referred_from_label}:</span>
                <strong>{ticket.referred_from_office}</strong>
              </div>
            )}
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>{t.transaction_no}:</span>
              <span className="mono" style={{ fontWeight: 700 }}>{ticket.transaction_no}</span>
            </div>
            {ticket.status !== 'referred' && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>{t.claim_code}:</span>
                <span className="mono" style={{ fontWeight: 800, letterSpacing: '0.1em', color: 'var(--dole-blue)' }}>
                  {ticket.claim_code}
                </span>
              </div>
            )}
          </div>

          {/* Only while the client may still be called */}
          {ACTIVE_STATUSES.includes(ticket.status) && (
            <p style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              marginTop: '1.5rem',
              lineHeight: 1.4,
            }}>
              ℹ️ {t.keep_ticket_note}
            </p>
          )}

          {/* Survey: always the office's CSM survey page (the CSM rejects per-ticket links).
              Same tab on purpose: QR scanners' built-in browsers often ignore new-tab links.
              Only once Done: the CSM refuses any other ticket, so earlier it is a dead end
              (a referred ticket never becomes Done; the client rates the office that finishes). */}
          {!ticket.surveyed && ticket.office_survey_url && ticket.status === 'done' && (
            <div style={{
              marginTop: '1.25rem',
              paddingTop: '1.25rem',
              borderTop: 'var(--border-hairline)',
            }}>
              <p style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 0.75rem', lineHeight: 1.4 }}>
                {t.rate_prompt}
              </p>
              <a
                href={surveyLink(ticket)}
                className="btn btn-gold btn-lg w-full"
                style={{ fontSize: '1.1rem', boxShadow: 'var(--shadow-md)' }}
              >
                {t.rate_service_btn}
              </a>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.45rem' }}>
                {t.office_survey_note}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
