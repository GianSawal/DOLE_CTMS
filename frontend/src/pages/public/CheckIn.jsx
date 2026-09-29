import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { publicApi } from '../../api/public';
import Header from '../../components/Header';
import SearchableServiceSelect from '../../components/SearchableServiceSelect';
import { translations } from '../../locales/translations';

export default function CheckIn() {
  const { officeId } = useParams();
  const navigate = useNavigate();

  const [lang, setLang] = useState('en');
  const t = translations[lang];

  const [officeData, setOfficeData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [serviceId, setServiceId] = useState('');
  const [clientName, setClientName] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isGroup, setIsGroup] = useState(false);
  const [representativeName, setRepresentativeName] = useState('');
  const [groupSize, setGroupSize] = useState('2');
  const [isPriority, setIsPriority] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsAgreedCheckbox, setTermsAgreedCheckbox] = useState(false);

  useEffect(() => {
    async function fetchOffice() {
      try {
        setLoading(true);
        setError('');
        const data = await publicApi.getOfficeDetail(officeId);
        setOfficeData(data);
      } catch (err) {
        setError(err.message || 'Office not found or currently unavailable.');
      } finally {
        setLoading(false);
      }
    }
    if (officeId) {
      fetchOffice();
    }
  }, [officeId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!serviceId) {
      setError(lang === 'fil' ? 'Mangyaring pumili ng serbisyo bago magpatuloy.' : 'Please select a service to proceed.');
      return;
    }

    let finalClientName = '';
    if (isGroup) {
      const parsedSize = parseInt(groupSize, 10);
      const count = isNaN(parsedSize) || parsedSize < 2 ? 2 : parsedSize;
      const rep = isAnonymous ? 'Anonymous' : (representativeName.trim() || 'Anonymous');
      finalClientName = `${rep} (Group of ${count})`;
    } else {
      finalClientName = isAnonymous ? 'Anonymous' : (clientName.trim() || null);
    }

    try {
      setSubmitting(true);
      setError('');
      const res = await publicApi.checkin({
        office: Number(officeId),
        service: Number(serviceId),
        client_name: finalClientName,
        is_priority: isPriority,
      });

      // Redirect to client live ticket
      navigate(`/t/${res.ticket_token}`);
    } catch (err) {
      setError(err.message || 'Check-in failed. Please try again or ask DOLE staff for assistance.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>Loading DOLE office information...</p>
      </div>
    );
  }

  if (error && !officeData) {
    return (
      <div style={{ minHeight: '100vh', padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ maxWidth: '480px', textAlign: 'center', padding: '2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
          <h2 style={{ color: 'var(--dole-red)', marginBottom: '0.5rem' }}>Office Unavailable</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>{error}</p>
          <button onClick={() => window.location.reload()} className="btn btn-outline">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header
        lang={lang}
        setLang={setLang}
        title={officeData?.office?.name}
        subtitle="Department of Labor and Employment"
      />

      <main style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem 1rem',
      }}>
        {!termsAccepted ? (
          <div className="card" style={{ width: '100%', maxWidth: '560px', padding: '2rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <img
                src="/dolelogo.png"
                alt="DOLE Official Seal"
                className="dole-logo-img"
                style={{ width: '64px', height: '64px', margin: '0 auto 0.75rem', display: 'block' }}
              />
              <span className="badge badge-serving" style={{ marginBottom: '0.5rem' }}>
                🏛️ {officeData?.office?.name || 'DOLE Office'}
              </span>
              <h2 style={{ fontSize: '1.45rem', color: 'var(--text-primary)', marginBottom: '0.35rem', fontWeight: 800 }}>
                {t.terms_title}
              </h2>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                {t.terms_subtitle}
              </p>
            </div>

            <div style={{
              backgroundColor: '#f8fafc',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '1.25rem',
              maxHeight: '340px',
              overflowY: 'auto',
              marginBottom: '1.5rem',
              fontSize: '0.88rem',
              lineHeight: 1.55,
              color: 'var(--text-secondary)',
            }}>
              <p style={{ fontWeight: 700, color: 'var(--dole-blue)', marginBottom: '1rem', fontSize: '0.92rem' }}>
                {t.terms_intro}
              </p>

              <div style={{ marginBottom: '1rem', paddingBottom: '0.85rem', borderBottom: '1px solid #e2e8f0' }}>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '0.25rem', fontSize: '0.92rem' }}>
                  {t.terms_dpa_title}
                </strong>
                <p style={{ margin: 0 }}>
                  {t.terms_dpa_desc}
                </p>
              </div>

              <div style={{ marginBottom: '1rem', paddingBottom: '0.85rem', borderBottom: '1px solid #e2e8f0' }}>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '0.25rem', fontSize: '0.92rem' }}>
                  {t.terms_eodb_title}
                </strong>
                <p style={{ margin: 0 }}>
                  {t.terms_eodb_desc}
                </p>
              </div>

              <div>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '0.25rem', fontSize: '0.92rem' }}>
                  {t.terms_calling_title}
                </strong>
                <p style={{ margin: 0 }}>
                  {t.terms_calling_desc}
                </p>
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                cursor: 'pointer',
                margin: 0,
                fontSize: '0.9rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}>
                <input
                  type="checkbox"
                  checked={termsAgreedCheckbox}
                  onChange={(e) => setTermsAgreedCheckbox(e.target.checked)}
                  style={{ width: '22px', height: '22px', minHeight: 'unset', marginTop: '2px', accentColor: 'var(--dole-blue)' }}
                />
                <span>
                  {t.terms_agree_checkbox}
                </span>
              </label>
            </div>

            <button
              type="button"
              onClick={() => {
                if (termsAgreedCheckbox) {
                  setTermsAccepted(true);
                }
              }}
              disabled={!termsAgreedCheckbox}
              className="btn btn-primary btn-lg w-full"
              style={{ fontWeight: 800, minHeight: '52px' }}
            >
              {t.proceed_to_registration} ➔
            </button>
          </div>
        ) : (
          <div className="card" style={{ width: '100%', maxWidth: '520px', padding: '2rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
              <img
                src="/dolelogo.png"
                alt="DOLE Logo"
                className="dole-logo-img"
                style={{ width: '64px', height: '64px', margin: '0 auto 0.75rem', display: 'block' }}
              />
              <span className="badge badge-serving" style={{ marginBottom: '0.5rem' }}>
                🏛️ {officeData?.office?.code} Check-in
              </span>
              <h2 style={{ fontSize: '1.5rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                {t.checkin_title}
              </h2>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                {t.checkin_subtitle}
              </p>
            </div>

            {error && (
              <div style={{
                backgroundColor: 'var(--dole-red-light)',
                border: '1px solid #fecaca',
                color: 'var(--dole-red)',
                borderRadius: 'var(--radius-md)',
                padding: '0.75rem 1rem',
                marginBottom: '1.25rem',
                fontSize: '0.9rem',
              }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label>{t.office_label}</label>
                <input
                  type="text"
                  disabled
                  value={officeData?.office?.name || ''}
                  style={{ backgroundColor: '#f8fafc', color: '#475569', cursor: 'not-allowed' }}
                />
              </div>

              {/* Registration Type: Individual vs. Group */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>
                  {t.registration_type}
                </label>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '0.5rem',
                  background: '#f1f5f9',
                  padding: '4px',
                  borderRadius: 'var(--radius-md)',
                }}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsGroup(false);
                    }}
                    style={{
                      padding: '0.55rem 1rem',
                      borderRadius: 'var(--radius-sm)',
                      border: 'none',
                      background: !isGroup ? '#ffffff' : 'transparent',
                      color: !isGroup ? 'var(--dole-blue)' : 'var(--text-secondary)',
                      fontWeight: !isGroup ? 700 : 500,
                      boxShadow: !isGroup ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.4rem',
                      transition: 'all 0.15s ease',
                      fontSize: '0.9rem',
                    }}
                  >
                    <span>👤</span>
                    <span>{t.individual}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsGroup(true);
                    }}
                    style={{
                      padding: '0.55rem 1rem',
                      borderRadius: 'var(--radius-sm)',
                      border: 'none',
                      background: isGroup ? '#ffffff' : 'transparent',
                      color: isGroup ? 'var(--dole-blue)' : 'var(--text-secondary)',
                      fontWeight: isGroup ? 700 : 500,
                      boxShadow: isGroup ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.4rem',
                      transition: 'all 0.15s ease',
                      fontSize: '0.9rem',
                    }}
                  >
                    <span>👥</span>
                    <span>{t.group}</span>
                  </button>
                </div>
              </div>

              {/* Individual: Name field + Anonymous */}
              {!isGroup ? (
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                    <label htmlFor="client-name" style={{ margin: 0 }}>
                      {t.name_label}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        if (isAnonymous) {
                          setIsAnonymous(false);
                          setClientName('');
                        } else {
                          setIsAnonymous(true);
                          setClientName('Anonymous');
                        }
                      }}
                      className="btn btn-sm"
                      style={{
                        minHeight: '28px',
                        padding: '0.15rem 0.65rem',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        borderRadius: '20px',
                        backgroundColor: isAnonymous ? 'var(--dole-blue)' : '#f1f5f9',
                        color: isAnonymous ? '#ffffff' : 'var(--text-secondary)',
                        border: isAnonymous ? '1px solid var(--dole-blue)' : '1px solid #cbd5e1',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      title={isAnonymous ? 'Click to input custom name' : 'Click to register anonymously'}
                    >
                      {isAnonymous ? (t.anonymous_active || '✓ Anonymous') : (t.anonymous_btn || '👤 Anonymous')}
                    </button>
                  </div>

                  <div style={{ position: 'relative' }}>
                    <input
                      id="client-name"
                      type="text"
                      value={clientName}
                      onChange={(e) => {
                        setClientName(e.target.value);
                        if (e.target.value.trim().toLowerCase() === 'anonymous') {
                          setIsAnonymous(true);
                        } else if (isAnonymous && e.target.value.trim().toLowerCase() !== 'anonymous') {
                          setIsAnonymous(false);
                        }
                      }}
                      placeholder={isAnonymous ? 'Anonymous' : t.name_placeholder}
                      style={{
                        backgroundColor: isAnonymous ? 'rgba(3, 5, 186, 0.04)' : '#ffffff',
                        borderColor: isAnonymous ? 'var(--dole-blue)' : undefined,
                        fontWeight: isAnonymous ? 700 : 400,
                        color: isAnonymous ? 'var(--dole-blue)' : undefined,
                      }}
                    />
                    {isAnonymous && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsAnonymous(false);
                          setClientName('');
                        }}
                        style={{
                          position: 'absolute',
                          right: '12px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          border: 'none',
                          backgroundColor: 'transparent',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          fontSize: '0.9rem',
                          padding: '4px',
                        }}
                        title="Clear anonymous"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                    {t.anonymous_note}
                  </p>
                </div>
              ) : (
                /* Group: Representative Name (with Anonymous toggle) & Group Size */
                <>
                  <div style={{ marginBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                      <label htmlFor="representative-name" style={{ margin: 0 }}>
                        {t.representative_name} *
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          if (isAnonymous) {
                            setIsAnonymous(false);
                            setRepresentativeName('');
                          } else {
                            setIsAnonymous(true);
                            setRepresentativeName('Anonymous');
                          }
                        }}
                        className="btn btn-sm"
                        style={{
                          minHeight: '28px',
                          padding: '0.15rem 0.65rem',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          borderRadius: '20px',
                          backgroundColor: isAnonymous ? 'var(--dole-blue)' : '#f1f5f9',
                          color: isAnonymous ? '#ffffff' : 'var(--text-secondary)',
                          border: isAnonymous ? '1px solid var(--dole-blue)' : '1px solid #cbd5e1',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                        title={isAnonymous ? 'Click to input representative name' : 'Click to register group anonymously'}
                      >
                        {isAnonymous ? (t.anonymous_active || '✓ Anonymous') : (t.anonymous_btn || '👤 Anonymous')}
                      </button>
                    </div>

                    <div style={{ position: 'relative' }}>
                      <input
                        id="representative-name"
                        type="text"
                        required={!isAnonymous}
                        value={representativeName}
                        onChange={(e) => {
                          setRepresentativeName(e.target.value);
                          if (e.target.value.trim().toLowerCase() === 'anonymous') {
                            setIsAnonymous(true);
                          } else if (isAnonymous && e.target.value.trim().toLowerCase() !== 'anonymous') {
                            setIsAnonymous(false);
                          }
                        }}
                        placeholder={isAnonymous ? 'Anonymous' : t.representative_placeholder}
                        style={{
                          backgroundColor: isAnonymous ? 'rgba(3, 5, 186, 0.04)' : '#ffffff',
                          borderColor: isAnonymous ? 'var(--dole-blue)' : undefined,
                          fontWeight: isAnonymous ? 700 : 400,
                          color: isAnonymous ? 'var(--dole-blue)' : undefined,
                        }}
                      />
                      {isAnonymous && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsAnonymous(false);
                            setRepresentativeName('');
                          }}
                          style={{
                            position: 'absolute',
                            right: '12px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            border: 'none',
                            backgroundColor: 'transparent',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            padding: '4px',
                          }}
                          title="Clear anonymous"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                      {isAnonymous ? t.anonymous_group_note : t.anonymous_note}
                    </p>
                  </div>

                  <div style={{ marginBottom: '1.25rem' }}>
                    <label htmlFor="group-size" style={{ display: 'block', marginBottom: '0.375rem', fontWeight: 600 }}>
                      {t.group_size_label} *
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ position: 'relative', width: '130px' }}>
                        <input
                          id="group-size"
                          type="number"
                          min="2"
                          max="999"
                          required
                          value={groupSize}
                          onChange={(e) => setGroupSize(e.target.value)}
                          placeholder={t.group_size_placeholder}
                          style={{
                            width: '100%',
                            fontWeight: 700,
                            fontSize: '1.05rem',
                            paddingLeft: '2.2rem',
                          }}
                        />
                        <span style={{
                          position: 'absolute',
                          left: '10px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          fontSize: '1rem',
                          pointerEvents: 'none',
                          color: 'var(--text-muted)',
                        }}>
                          👥
                        </span>
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                        {t.group_size_subtext}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Service Requested - Chosen after filling client / group info */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label htmlFor="service-select">{t.service_label} *</label>
                <SearchableServiceSelect
                  id="service-select"
                  required
                  services={officeData?.services || []}
                  value={serviceId}
                  onChange={(val) => setServiceId(val)}
                  placeholder={t.select_service}
                  searchPlaceholder={t.search_services}
                  noResultsText={t.no_services_found}
                />
              </div>

              <div style={{
                backgroundColor: isPriority ? 'var(--dole-gold-light)' : '#f8fafc',
                border: isPriority ? '1px solid #fde68a' : '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '1rem',
                marginBottom: '1.75rem',
                transition: 'all 0.2s ease',
              }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer', margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={isPriority}
                    onChange={(e) => setIsPriority(e.target.checked)}
                    style={{ width: '22px', height: '22px', minHeight: 'unset', marginTop: '2px', accentColor: 'var(--dole-gold-dark)' }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                      {t.priority_label}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      {t.priority_subtext}
                    </div>
                  </div>
                </label>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="btn btn-primary btn-lg w-full"
              >
                {submitting ? t.submitting : t.get_ticket_btn}
              </button>
            </form>

            <div style={{ marginTop: '1.5rem', textAlign: 'center', borderTop: 'var(--border-hairline)', paddingTop: '1rem' }}>
              <button
                type="button"
                onClick={() => setTermsAccepted(false)}
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textDecoration: 'underline', border: 'none', background: 'transparent', cursor: 'pointer' }}
              >
                📄 {t.view_terms_btn}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
