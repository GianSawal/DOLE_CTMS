import React, { useState, useEffect } from 'react';
import { staffApi } from '../api/staff';
import { publicApi } from '../api/public';
import Modal from './Modal';
import SearchableServiceSelect from './SearchableServiceSelect';

/**
 * Front-desk walk-in registration. Issues a ticket into the office's shared
 * queue and hands the created transaction to `onCreated` (e.g. to print a slip).
 */
export default function WalkinModal({ isOpen, onClose, officeId, onCreated }) {
  const [services, setServices] = useState([]);
  const [walkinService, setWalkinService] = useState('');
  const [walkinName, setWalkinName] = useState('');
  const [walkinPriority, setWalkinPriority] = useState(false);
  const [walkinIsGroup, setWalkinIsGroup] = useState(false);
  const [walkinRepName, setWalkinRepName] = useState('');
  const [walkinGroupSize, setWalkinGroupSize] = useState('2');
  const [walkinMemberNames, setWalkinMemberNames] = useState(['', '']);
  const [walkinConcern, setWalkinConcern] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && officeId) {
      publicApi.getOfficeDetail(officeId)
        .then(res => setServices(res.services || []))
        .catch(() => setServices([]));
    }
  }, [isOpen, officeId]);

  const resetForm = () => {
    setWalkinName('');
    setWalkinService('');
    setWalkinPriority(false);
    setWalkinIsGroup(false);
    setWalkinRepName('');
    setWalkinGroupSize('2');
    setWalkinMemberNames(['', '']);
    setWalkinConcern('');
    setError('');
  };

  const selectedService = services.find(s => String(s.id) === String(walkinService));
  const concernRequired = !!selectedService?.requires_concern;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!walkinService) return;
    if (concernRequired && !walkinConcern.trim()) {
      setError('Please describe what the client needs.');
      return;
    }

    let finalClientName = '';
    let memberNames = null;
    if (walkinIsGroup) {
      const parsedSize = parseInt(walkinGroupSize, 10);
      const count = isNaN(parsedSize) || parsedSize < 2 ? 2 : parsedSize;
      const rep = (walkinRepName.trim().toLowerCase() === 'anonymous' || !walkinRepName.trim())
        ? 'Anonymous'
        : walkinRepName.trim();
      finalClientName = `${rep} (Group of ${count})`;
      memberNames = walkinMemberNames.slice(0, count).map(n => n.trim()).filter(Boolean);
      if (memberNames.length < count) {
        setError('Please enter the name for every group member.');
        return;
      }
    } else {
      finalClientName = walkinName;
    }

    try {
      setSaving(true);
      setError('');
      const newTx = await staffApi.createWalkin({
        office: Number(officeId),
        service: Number(walkinService),
        client_name: finalClientName,
        is_priority: walkinPriority,
        group_member_names: memberNames,
        concern_note: concernRequired ? walkinConcern.trim() : '',
      });
      resetForm();
      onCreated(newTx);
    } catch (err) {
      setError(err.message || 'Failed to register walk-in.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Walk-in Client Registration"
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div role="alert" style={{ backgroundColor: 'var(--dole-red-light)', color: 'var(--dole-red-dark)', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', padding: '0.65rem 0.9rem', fontSize: '0.85rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}
        {/* Registration Type Segmented Control */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600, fontSize: '0.85rem' }}>
            Registration Type
          </label>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '0.4rem',
            background: '#f1f5f9',
            padding: '3px',
            borderRadius: 'var(--radius-md)',
          }}>
            <button
              type="button"
              onClick={() => setWalkinIsGroup(false)}
              style={{
                padding: '0.45rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: !walkinIsGroup ? '#ffffff' : 'transparent',
                color: !walkinIsGroup ? 'var(--dole-blue)' : 'var(--text-secondary)',
                fontWeight: !walkinIsGroup ? 700 : 500,
                boxShadow: !walkinIsGroup ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                cursor: 'pointer',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.35rem',
              }}
            >
              <span>👤</span>
              <span>Individual</span>
            </button>
            <button
              type="button"
              onClick={() => setWalkinIsGroup(true)}
              style={{
                padding: '0.45rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: walkinIsGroup ? '#ffffff' : 'transparent',
                color: walkinIsGroup ? 'var(--dole-blue)' : 'var(--text-secondary)',
                fontWeight: walkinIsGroup ? 700 : 500,
                boxShadow: walkinIsGroup ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                cursor: 'pointer',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.35rem',
              }}
            >
              <span>👥</span>
              <span>Group</span>
            </button>
          </div>
        </div>

        {!walkinIsGroup ? (
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
              <label style={{ margin: 0 }}>Client Name (Optional)</label>
              <button
                type="button"
                onClick={() => setWalkinName(walkinName === 'Anonymous' ? '' : 'Anonymous')}
                className="btn btn-sm"
                style={{
                  minHeight: '26px',
                  padding: '0.15rem 0.55rem',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  borderRadius: '20px',
                  backgroundColor: walkinName === 'Anonymous' ? 'var(--dole-blue)' : '#f1f5f9',
                  color: walkinName === 'Anonymous' ? '#ffffff' : 'var(--text-secondary)',
                  border: walkinName === 'Anonymous' ? '1px solid var(--dole-blue)' : '1px solid #cbd5e1',
                  cursor: 'pointer',
                }}
                title={walkinName === 'Anonymous' ? 'Click to clear anonymous' : 'Click to register as Anonymous'}
              >
                {walkinName === 'Anonymous' ? '✓ Anonymous' : '👤 Anonymous'}
              </button>
            </div>
            <input
              type="text"
              value={walkinName}
              onChange={(e) => setWalkinName(e.target.value)}
              placeholder="e.g. Juan Dela Cruz or Anonymous"
              style={{
                backgroundColor: walkinName === 'Anonymous' ? 'rgba(3, 5, 186, 0.04)' : '#ffffff',
                borderColor: walkinName === 'Anonymous' ? 'var(--dole-blue)' : undefined,
                fontWeight: walkinName === 'Anonymous' ? 700 : 400,
                color: walkinName === 'Anonymous' ? 'var(--dole-blue)' : undefined,
              }}
            />
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <label style={{ margin: 0 }}>Representative Name</label>
                <button
                  type="button"
                  onClick={() => {
                    const next = walkinRepName === 'Anonymous' ? '' : 'Anonymous';
                    setWalkinRepName(next);
                    if (next === 'Anonymous') {
                      setWalkinMemberNames(prev => {
                        const updated = [...prev];
                        if (!updated[0] || updated[0] === walkinRepName) {
                          updated[0] = 'Anonymous';
                        }
                        return updated;
                      });
                    }
                  }}
                  className="btn btn-sm"
                  style={{
                    minHeight: '26px',
                    padding: '0.15rem 0.55rem',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    borderRadius: '20px',
                    backgroundColor: walkinRepName === 'Anonymous' ? 'var(--dole-blue)' : '#f1f5f9',
                    color: walkinRepName === 'Anonymous' ? '#ffffff' : 'var(--text-secondary)',
                    border: walkinRepName === 'Anonymous' ? '1px solid var(--dole-blue)' : '1px solid #cbd5e1',
                    cursor: 'pointer',
                  }}
                  title={walkinRepName === 'Anonymous' ? 'Click to clear anonymous' : 'Click to register as Anonymous'}
                >
                  {walkinRepName === 'Anonymous' ? '✓ Anonymous' : '👤 Anonymous'}
                </button>
              </div>
              <input
                type="text"
                value={walkinRepName}
                onChange={(e) => {
                  const val = e.target.value;
                  setWalkinRepName(val);
                  setWalkinMemberNames(prev => {
                    const updated = [...prev];
                    if (!updated[0] || updated[0] === walkinRepName) {
                      updated[0] = val;
                    }
                    return updated;
                  });
                }}
                placeholder="e.g. Maria Santos (Representative)"
                style={{
                  backgroundColor: walkinRepName === 'Anonymous' ? 'rgba(3, 5, 186, 0.04)' : '#ffffff',
                  borderColor: walkinRepName === 'Anonymous' ? 'var(--dole-blue)' : undefined,
                  fontWeight: walkinRepName === 'Anonymous' ? 700 : 400,
                  color: walkinRepName === 'Anonymous' ? 'var(--dole-blue)' : undefined,
                }}
              />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600, fontSize: '0.85rem' }}>
                Number of Members in Group *
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ position: 'relative', width: '110px' }}>
                  <input
                    type="number"
                    min="2"
                    max="50"
                    required
                    value={walkinGroupSize}
                    onChange={(e) => {
                      const val = e.target.value;
                      setWalkinGroupSize(val);
                      const size = parseInt(val, 10);
                      if (!isNaN(size) && size >= 2 && size <= 50) {
                        setWalkinMemberNames(prev => {
                          const arr = [...prev];
                          while (arr.length < size) arr.push('');
                          return arr.slice(0, size);
                        });
                      }
                    }}
                    placeholder="e.g. 5"
                    style={{
                      width: '100%',
                      fontWeight: 700,
                      paddingLeft: '2rem',
                    }}
                  />
                  <span style={{
                    position: 'absolute',
                    left: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: '0.9rem',
                    pointerEvents: 'none',
                  }}>
                    👥
                  </span>
                </div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Total people in group
                </span>
              </div>
            </div>

            {/* Dynamic Member Name Inputs */}
            {(() => {
              const size = parseInt(walkinGroupSize, 10);
              const count = isNaN(size) || size < 2 ? 2 : Math.min(size, 50);
              return count > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.85rem' }}>
                    👤 Member Names *
                  </label>
                  <div style={{
                    maxHeight: '220px',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem',
                    padding: '0.75rem',
                    background: '#f8fafc',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                  }}>
                    {Array.from({ length: count }).map((_, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          color: 'var(--text-muted)',
                          minWidth: '18px',
                          textAlign: 'right',
                        }}>
                          {i + 1}.
                        </span>
                        <input
                          type="text"
                          required
                          value={walkinMemberNames[i] || ''}
                          onChange={(e) => {
                            const updated = [...walkinMemberNames];
                            updated[i] = e.target.value;
                            setWalkinMemberNames(updated);
                          }}
                          placeholder={i === 0 ? "Member 1 (Representative full name)" : `Member ${i + 1} full name`}
                          style={{
                            flex: 1,
                            fontSize: '0.85rem',
                            padding: '0.4rem 0.65rem',
                            minHeight: '36px',
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                    Enter the full name of each group member. All names are required.
                  </p>
                </div>
              );
            })()}
          </>
        )}

        {/* Select Service after representative and group members */}
        <div style={{ marginBottom: '1rem' }}>
          <label>Select Service *</label>
          <SearchableServiceSelect
            required
            services={services}
            value={walkinService}
            onChange={(val) => setWalkinService(val)}
            placeholder="-- Select Service --"
            searchPlaceholder="Search services or division..."
          />
        </div>

        {concernRequired && (
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="walkin-concern">Client's Concern *</label>
            <textarea
              id="walkin-concern"
              required
              rows={3}
              maxLength={300}
              value={walkinConcern}
              onChange={(e) => setWalkinConcern(e.target.value)}
              placeholder="e.g. Asking about unpaid last pay from a previous employer"
              style={{ resize: 'vertical', minHeight: '76px', lineHeight: 1.45 }}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
              The selected service is a catch-all; briefly note what the client needs.
            </p>
          </div>
        )}

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={walkinPriority}
              onChange={(e) => setWalkinPriority(e.target.checked)}
              style={{ width: '20px', height: '20px', minHeight: 'unset' }}
            />
            <span style={{ fontWeight: 600 }}>Priority Lane (Senior / PWD / Pregnant)</span>
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-outline"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary"
          >
            Issue Ticket & Slip
          </button>
        </div>
      </form>
    </Modal>
  );
}
