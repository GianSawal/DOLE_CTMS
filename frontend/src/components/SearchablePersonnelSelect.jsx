import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

const DIVISION_BADGES = {
  'TSSD 1': { color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  'TSSD1': { color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  'TSSD 2': { color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd' },
  'TSSD2': { color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd' },
  'IMSD': { color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  'MALSU': { color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
};

export default function SearchablePersonnelSelect({
  personnel = [],
  value = '',
  onChange,
  placeholder = '-- Select DOLE Personnel --',
  searchPlaceholder = 'Type to search personnel in real time...',
  noResultsText = 'No personnel found matching',
  serviceDivision = '',
  required = false,
  id = 'searchable-personnel-select',
  disabled = false,
  dropDirection = 'auto',
  maxListHeight = '240px',
  isPersonnelBusy = null,
  defaultOfficerName = '',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);

  // Find currently selected personnel object by full_name or employee_id
  const selectedPersonnel = useMemo(() => {
    if (!value) return null;
    const cleanVal = String(value).trim().toLowerCase();
    return personnel.find(
      (p) =>
        (p.full_name && p.full_name.toLowerCase() === cleanVal) ||
        (p.employee_id && p.employee_id.toLowerCase() === cleanVal) ||
        String(p.id) === cleanVal
    ) || null;
  }, [personnel, value]);

  // Instant real-time filtering while typing
  const filteredPersonnel = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return personnel;
    return personnel.filter((p) => {
      const nameMatch = p.full_name && p.full_name.toLowerCase().includes(q);
      const idMatch = p.employee_id && p.employee_id.toLowerCase().includes(q);
      const posMatch = p.position && p.position.toLowerCase().includes(q);
      const divMatch = p.division_names && p.division_names.some((d) => d.toLowerCase().includes(q));
      return nameMatch || idMatch || posMatch || divMatch;
    });
  }, [personnel, searchQuery]);

  // Calculate optimal drop direction (up vs down) to prevent cutting off in modal
  const calculateDirection = useCallback(() => {
    try {
      if (dropDirection === 'up') {
        setDropUp(true);
        return;
      }
      if (dropDirection === 'down') {
        setDropUp(false);
        return;
      }
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelowViewport = window.innerHeight - rect.bottom;
      const spaceAboveViewport = rect.top;

      // Check if inside a modal or constrained container
      const modalEl = containerRef.current.closest('[role="dialog"], .card, form') || containerRef.current.offsetParent;
      if (modalEl) {
        const modalRect = modalEl.getBoundingClientRect();
        const modalSpaceBelow = modalRect.bottom - rect.bottom;
        const modalSpaceAbove = rect.top - modalRect.top;

        if (modalSpaceBelow < 250 && modalSpaceAbove > modalSpaceBelow) {
          setDropUp(true);
          return;
        }
      }

      if (spaceBelowViewport < 280 && spaceAboveViewport > spaceBelowViewport) {
        setDropUp(true);
      } else {
        setDropUp(false);
      }
    } catch {
      setDropUp(false);
    }
  }, [dropDirection]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      calculateDirection();
      setSearchQuery('');
      setHighlightedIndex(0);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen, calculateDirection]);

  // Recalculate on window resize or scroll
  useEffect(() => {
    if (!isOpen) return;
    const handleScrollOrResize = () => {
      calculateDirection();
    };
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen, calculateDirection]);

  // Auto-scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const activeEl = listRef.current.children[highlightedIndex];
      if (activeEl && typeof activeEl.scrollIntoView === 'function') {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < filteredPersonnel.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredPersonnel.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredPersonnel[highlightedIndex]) {
        const p = filteredPersonnel[highlightedIndex];
        if (isPersonnelBusy && isPersonnelBusy(p)) return;
        handleSelect(p);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const handleSelect = (personnelObj) => {
    if (isPersonnelBusy && isPersonnelBusy(personnelObj)) return;
    if (onChange) {
      onChange(personnelObj.full_name, personnelObj);
    }
    setIsOpen(false);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    if (onChange) {
      onChange('', null);
    }
  };

  const getDivisionBadge = (divisionName) => {
    if (!divisionName) return null;
    const style = DIVISION_BADGES[divisionName.trim()] || {
      color: '#475569',
      bg: '#f1f5f9',
      border: '#cbd5e1',
    };
    return (
      <span
        key={divisionName}
        style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          padding: '0.15rem 0.5rem',
          borderRadius: '4px',
          color: style.color,
          backgroundColor: style.bg,
          border: `1px solid ${style.border}`,
          whiteSpace: 'nowrap',
          marginLeft: '0.4rem',
          flexShrink: 0,
        }}
      >
        {divisionName}
      </span>
    );
  };

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%' }}
      onKeyDown={handleKeyDown}
    >
      {/* Hidden real input for native HTML5 form required validation */}
      <input
        type="text"
        id={id}
        tabIndex={-1}
        required={required}
        value={value ? String(value) : ''}
        onChange={() => {}}
        style={{
          opacity: 0,
          position: 'absolute',
          left: '50%',
          bottom: 0,
          width: '1px',
          height: '1px',
          pointerEvents: 'none',
        }}
      />

      {/* Main Dropdown Button / Display Box */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        style={{
          minHeight: '44px',
          padding: '0.5rem 0.875rem',
          backgroundColor: disabled ? '#f8fafc' : '#ffffff',
          border: isOpen ? '1.5px solid var(--dole-blue)' : '1px solid var(--border-color)',
          boxShadow: isOpen ? '0 0 0 3px rgba(3, 5, 186, 0.12)' : 'none',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: disabled ? 'not-allowed' : 'pointer',
          userSelect: 'none',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, marginRight: '0.5rem' }}>
          {value ? (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem', minWidth: 0 }}>
              <span style={{ fontSize: '1rem', marginRight: '0.2rem' }}>👤</span>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.92rem' }}>
                {selectedPersonnel ? selectedPersonnel.full_name : value}
              </span>
              {selectedPersonnel?.position && (
                <span
                  style={{
                    fontSize: '0.78rem',
                    color: 'var(--text-muted)',
                    backgroundColor: 'var(--bg-ground)',
                    padding: '0.1rem 0.45rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  {selectedPersonnel.position}
                </span>
              )}
              {selectedPersonnel?.division_names?.map((d) => getDivisionBadge(d))}
            </div>
          ) : (
            <span style={{ color: '#94a3b8', fontSize: '0.92rem' }}>
              {placeholder}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
          {value && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              title="Clear selection"
              style={{
                border: 'none',
                background: 'transparent',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '1rem',
                padding: '0.2rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
                borderRadius: '50%',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--dole-red)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
            >
              ✕
            </button>
          )}
          <span
            style={{
              color: '#64748b',
              fontSize: '0.75rem',
              transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
              display: 'inline-block',
            }}
          >
            ▼
          </span>
        </div>
      </div>

      {/* Floating Dropdown Panel */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            ...(dropUp
              ? { bottom: 'calc(100% + 4px)' }
              : { top: 'calc(100% + 4px)' }),
            zIndex: 10000,
            backgroundColor: '#ffffff',
            borderRadius: 'var(--radius-md)',
            border: '1px solid #cbd5e1',
            boxShadow: '0 12px 28px -4px rgba(0, 0, 0, 0.18), 0 4px 10px rgba(0, 0, 0, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            animation: 'fadeIn 0.12s ease-out',
          }}
        >
          {/* Real-time Instant Search Input Header */}
          <div
            style={{
              padding: '0.65rem 0.75rem',
              backgroundColor: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span style={{ fontSize: '0.95rem', color: '#64748b' }}>🔍</span>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setHighlightedIndex(0);
              }}
              placeholder={searchPlaceholder}
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: '0.88rem',
                color: 'var(--text-primary)',
                padding: '0.2rem 0',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                style={{
                  border: 'none',
                  background: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  padding: '0.1rem 0.3rem',
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Results Summary Bar */}
          {(() => {
            const busyCount = isPersonnelBusy
              ? filteredPersonnel.filter((p) => Boolean(isPersonnelBusy(p))).length
              : 0;
            const availableCount = filteredPersonnel.length - busyCount;
            return (
              <div
                style={{
                  padding: '0.35rem 0.75rem',
                  backgroundColor: '#f1f5f9',
                  fontSize: '0.74rem',
                  color: '#64748b',
                  fontWeight: 600,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '1px solid #e2e8f0',
                }}
              >
                <span>
                  {availableCount} available{busyCount > 0 ? ` (${busyCount} busy)` : ''}
                  {serviceDivision ? ` under ${serviceDivision}` : ''}
                </span>
                <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                  ↑↓ Navigate · ↵ Select
                </span>
              </div>
            );
          })()}

          {/* Filtered Personnel List */}
          <div
            ref={listRef}
            style={{
              maxHeight: maxListHeight,
              overflowY: 'auto',
              padding: '0.35rem 0',
            }}
          >
            {filteredPersonnel.length === 0 ? (
              <div
                style={{
                  padding: '1.25rem 1rem',
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: '0.85rem',
                }}
              >
                {searchQuery ? (
                  <>
                    <p style={{ margin: 0, fontWeight: 600 }}>{noResultsText} "{searchQuery}"</p>
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>
                      Try typing a different name, Employee ID, or position.
                    </p>
                  </>
                ) : (
                  <>
                    <p style={{ margin: 0, fontWeight: 600 }}>No personnel registered</p>
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>
                      Add personnel under {serviceDivision || 'this division'} in the Personnel tab.
                    </p>
                  </>
                )}
              </div>
            ) : (
              filteredPersonnel.map((p, index) => {
                const isSelected = selectedPersonnel?.id === p.id || value === p.full_name;
                const isHighlighted = highlightedIndex === index;
                const busyInfo = isPersonnelBusy ? isPersonnelBusy(p) : null;
                const isBusy = Boolean(busyInfo);

                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      if (!isBusy) handleSelect(p);
                    }}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    title={
                      isBusy
                        ? `Unavailable: Currently assigned to Queue #${busyInfo.queue_no} (${busyInfo.status || 'Active'})`
                        : `Select ${p.full_name}`
                    }
                    style={{
                      padding: '0.65rem 0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: isBusy ? 'not-allowed' : 'pointer',
                      opacity: isBusy ? 0.65 : 1,
                      backgroundColor: isBusy
                        ? '#f8fafc'
                        : isHighlighted
                        ? 'rgba(3, 5, 186, 0.08)'
                        : isSelected
                        ? 'rgba(3, 5, 186, 0.04)'
                        : 'transparent',
                      borderLeft: isSelected
                        ? '3px solid var(--dole-blue)'
                        : isHighlighted && !isBusy
                        ? '3px solid #94a3b8'
                        : '3px solid transparent',
                      transition: 'background-color 0.1s ease',
                      gap: '0.75rem',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.85rem' }}>{isBusy ? '🚫' : '👤'}</span>
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: '0.9rem',
                            color: isBusy ? '#64748b' : 'var(--text-primary)',
                            textDecoration: isBusy ? 'line-through' : 'none',
                          }}
                        >
                          {p.full_name}
                        </span>
                        {p.employee_id && (
                          <span
                            className="mono"
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              color: isBusy ? '#94a3b8' : 'var(--dole-blue)',
                              backgroundColor: isBusy ? '#f1f5f9' : 'rgba(3, 5, 186, 0.06)',
                              padding: '0.1rem 0.35rem',
                              borderRadius: '3px',
                            }}
                          >
                            {p.employee_id}
                          </span>
                        )}
                      </div>

                      {p.position && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                          {p.position}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                      {defaultOfficerName && p.full_name?.toLowerCase().trim() === defaultOfficerName.toLowerCase().trim() && (
                        <span
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            color: '#1d4ed8',
                            backgroundColor: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            padding: '0.12rem 0.4rem',
                            borderRadius: '4px',
                            whiteSpace: 'nowrap',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.2rem',
                          }}
                        >
                          ⭐ Default
                        </span>
                      )}
                      {isBusy ? (
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            color: '#b91c1c',
                            backgroundColor: '#fef2f2',
                            border: '1px solid #fecaca',
                            padding: '0.15rem 0.45rem',
                            borderRadius: '4px',
                            whiteSpace: 'nowrap',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                          }}
                        >
                          🚫 Busy · #{busyInfo.queue_no}
                        </span>
                      ) : (
                        p.division_names?.map((d) => getDivisionBadge(d))
                      )}
                      {isSelected && !isBusy && (
                        <span style={{ color: 'var(--dole-blue)', fontWeight: 800, fontSize: '0.9rem', marginLeft: '0.25rem' }}>
                          ✓
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
