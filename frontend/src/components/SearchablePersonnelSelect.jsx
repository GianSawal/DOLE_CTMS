import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

const DIVISION_BADGES = {
  'TSSD 1': { color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  'TSSD1': { color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  'TSSD 2': { color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd' },
  'TSSD2': { color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd' },
  'IMSD': { color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  'MALSU': { color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
};

function getInitials(name) {
  if (!name) return '👤';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '👤';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function SearchablePersonnelSelect({
  personnel = [],
  value = '',
  onChange,
  placeholder = '-- Select DOLE Personnel --',
  searchPlaceholder = 'Type to search personnel in real time...',
  noResultsText = 'No personnel found matching',
  serviceDivision = '',
  serviceId = null,
  required = false,
  id = 'searchable-personnel-select',
  disabled = false,
  dropDirection = 'auto',
  maxListHeight = '260px',
  isPersonnelBusy = null,
  valueKey = 'name', // 'name' (default for StaffQueue) or 'id' (for StaffUsers)
  showOffice = true,
  showAccountStatus = false,
  currentUserId = null,
  allowClear = true,
  allowStandAlone = false,
  standAloneLabel = '-- No Personnel Linked (Stand-alone Account) --',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);

  // Find currently selected personnel object by ID, full_name, or employee_id
  const selectedPersonnel = useMemo(() => {
    if (!value) return null;
    const cleanVal = String(value).trim().toLowerCase();
    return (
      personnel.find(
        (p) =>
          String(p.id) === cleanVal ||
          (p.full_name && p.full_name.toLowerCase() === cleanVal) ||
          (p.employee_id && p.employee_id.toLowerCase() === cleanVal)
      ) || null
    );
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
      const officeMatch = p.office_name && p.office_name.toLowerCase().includes(q);
      const userMatch = p.user_username && p.user_username.toLowerCase().includes(q);
      return nameMatch || idMatch || posMatch || divMatch || officeMatch || userMatch;
    });
  }, [personnel, searchQuery]);

  // Check if stand-alone option should be shown
  const showStandAloneOption =
    allowStandAlone &&
    (!searchQuery ||
      'stand-alone stand alone no personnel unlinked unlink none'
        .toLowerCase()
        .includes(searchQuery.toLowerCase().trim()));

  const totalNavCount = (showStandAloneOption ? 1 : 0) + filteredPersonnel.length;

  // Calculate optimal drop direction (up vs down) to prevent clipping
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

      // Check if inside a modal or scrollable container
      const modalEl =
        containerRef.current.closest('[role="dialog"], .card, form') || containerRef.current.offsetParent;
      if (modalEl) {
        const modalRect = modalEl.getBoundingClientRect();
        const modalSpaceBelow = modalRect.bottom - rect.bottom;
        const modalSpaceAbove = rect.top - modalRect.top;

        if (modalSpaceBelow < 280 && modalSpaceAbove > modalSpaceBelow) {
          setDropUp(true);
          return;
        }
      }

      if (spaceBelowViewport < 300 && spaceAboveViewport > spaceBelowViewport) {
        setDropUp(true);
      } else {
        setDropUp(false);
      }
    } catch {
      setDropUp(false);
    }
  }, [dropDirection]);

  // Focus search input and position on open
  useEffect(() => {
    if (isOpen) {
      calculateDirection();
      setSearchQuery('');
      if (selectedPersonnel) {
        const idx = filteredPersonnel.findIndex((p) => p.id === selectedPersonnel.id);
        if (idx !== -1) {
          setHighlightedIndex(showStandAloneOption ? idx + 1 : idx);
        } else {
          setHighlightedIndex(0);
        }
      } else {
        setHighlightedIndex(0);
      }
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

  const handleSelect = (personnelObj) => {
    if (!personnelObj) {
      if (onChange) {
        onChange('', null);
      }
      setIsOpen(false);
      return;
    }

    if (isPersonnelBusy && isPersonnelBusy(personnelObj)) return;

    if (onChange) {
      if (valueKey === 'id') {
        onChange(String(personnelObj.id), personnelObj);
      } else {
        onChange(personnelObj.full_name, personnelObj);
      }
    }
    setIsOpen(false);
  };

  const handleClear = (e) => {
    if (e) e.stopPropagation();
    if (onChange) {
      onChange('', null);
    }
  };

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
      setHighlightedIndex((prev) => (prev < totalNavCount - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : Math.max(0, totalNavCount - 1)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showStandAloneOption && highlightedIndex === 0) {
        handleSelect(null);
      } else {
        const pIdx = showStandAloneOption ? highlightedIndex - 1 : highlightedIndex;
        if (filteredPersonnel[pIdx]) {
          const p = filteredPersonnel[pIdx];
          if (isPersonnelBusy && isPersonnelBusy(p)) return;
          handleSelect(p);
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
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
          fontSize: '0.7rem',
          fontWeight: 700,
          padding: '0.12rem 0.45rem',
          borderRadius: '4px',
          color: style.color,
          backgroundColor: style.bg,
          border: `1px solid ${style.border}`,
          whiteSpace: 'nowrap',
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
      {/* Hidden input for native HTML5 form validation */}
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
          minHeight: '46px',
          padding: '0.55rem 0.85rem',
          backgroundColor: disabled ? '#f8fafc' : '#ffffff',
          border: isOpen ? '1.5px solid var(--dole-blue)' : '1px solid var(--border-color)',
          boxShadow: isOpen ? '0 0 0 3px rgba(3, 5, 186, 0.12)' : 'none',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: disabled ? 'not-allowed' : 'pointer',
          userSelect: 'none',
          transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, marginRight: '0.5rem' }}>
          {selectedPersonnel ? (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem', minWidth: 0 }}>
              {/* Personnel Initials Avatar */}
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #0305ba 0%, #1e40af 100%)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: '0.74rem',
                  flexShrink: 0,
                  boxShadow: '0 1px 3px rgba(3, 5, 186, 0.25)',
                }}
              >
                {getInitials(selectedPersonnel.full_name)}
              </div>

              {/* Personnel Name */}
              <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.92rem' }}>
                {selectedPersonnel.full_name}
              </span>

              {/* Employee ID */}
              {selectedPersonnel.employee_id && (
                <span
                  className="mono"
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: 'var(--dole-blue)',
                    backgroundColor: 'rgba(3, 5, 186, 0.08)',
                    padding: '0.1rem 0.4rem',
                    borderRadius: '4px',
                  }}
                >
                  {selectedPersonnel.employee_id}
                </span>
              )}

              {/* Position */}
              {selectedPersonnel.position && (
                <span
                  style={{
                    fontSize: '0.76rem',
                    color: '#64748b',
                    backgroundColor: '#f1f5f9',
                    padding: '0.1rem 0.45rem',
                    borderRadius: '4px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  {selectedPersonnel.position}
                </span>
              )}

              {/* Office badge */}
              {showOffice && selectedPersonnel.office_name && (
                <span
                  style={{
                    fontSize: '0.74rem',
                    color: '#334155',
                    backgroundColor: '#f8fafc',
                    padding: '0.1rem 0.45rem',
                    borderRadius: '4px',
                    border: '1px solid #cbd5e1',
                  }}
                >
                  🏢 {selectedPersonnel.office_name}
                </span>
              )}

              {/* Division badges */}
              {selectedPersonnel.division_names?.map((d) => getDivisionBadge(d))}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#94a3b8' }}>
              <span style={{ fontSize: '1rem', color: '#94a3b8' }}>🔍</span>
              <span style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 500 }}>
                {placeholder}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
          {value && allowClear && !disabled && (
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
                transition: 'color 0.15s ease',
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
            boxShadow: '0 14px 34px -4px rgba(0, 0, 0, 0.18), 0 4px 12px rgba(0, 0, 0, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            animation: 'fadeIn 0.12s ease-out',
          }}
        >
          {/* Instant Search Bar Header */}
          <div
            style={{
              padding: '0.65rem 0.8rem',
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
                color: '#0f172a',
                padding: '0.2rem 0',
                fontWeight: 500,
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
                  padding: '0.1rem 0.35rem',
                  borderRadius: '50%',
                }}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Results Summary Bar */}
          <div
            style={{
              padding: '0.35rem 0.8rem',
              backgroundColor: '#f1f5f9',
              fontSize: '0.73rem',
              color: '#64748b',
              fontWeight: 600,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            <span>
              {filteredPersonnel.length} personnel {searchQuery ? `matching "${searchQuery}"` : 'available'}
              {serviceDivision ? ` under ${serviceDivision}` : ''}
            </span>
            <span style={{ fontSize: '0.69rem', color: '#94a3b8' }}>
              ↑↓ Navigate · ↵ Select · Esc Close
            </span>
          </div>

          {/* Scrollable Results List */}
          <div
            ref={listRef}
            style={{
              maxHeight: maxListHeight,
              overflowY: 'auto',
              padding: '0.25rem 0',
            }}
          >
            {/* Optional Stand-alone / Unlink Option at Top */}
            {showStandAloneOption && (
              <div
                role="button"
                onClick={() => handleSelect(null)}
                onMouseEnter={() => setHighlightedIndex(0)}
                style={{
                  padding: '0.65rem 0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  backgroundColor:
                    highlightedIndex === 0
                      ? 'rgba(3, 5, 186, 0.08)'
                      : !value
                      ? 'rgba(3, 5, 186, 0.03)'
                      : 'transparent',
                  borderLeft:
                    highlightedIndex === 0
                      ? '3px solid var(--dole-blue)'
                      : !value
                      ? '3px solid #94a3b8'
                      : '3px solid transparent',
                  borderBottom: '1px dashed #e2e8f0',
                  gap: '0.75rem',
                  transition: 'background-color 0.1s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      backgroundColor: '#e2e8f0',
                      color: '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                    }}
                  >
                    ⚪
                  </div>
                  <div>
                    <div style={{ fontSize: '0.88rem', fontWeight: !value ? 800 : 600, color: !value ? 'var(--dole-blue)' : '#475569' }}>
                      {standAloneLabel}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.1rem' }}>
                      Account operates independently without linking to the personnel directory
                    </div>
                  </div>
                </div>
                {!value && (
                  <span style={{ color: 'var(--dole-blue)', fontWeight: 800, fontSize: '0.9rem' }}>
                    ✓
                  </span>
                )}
              </div>
            )}

            {/* List of personnel */}
            {filteredPersonnel.length === 0 && !showStandAloneOption ? (
              <div
                style={{
                  padding: '1.5rem 1rem',
                  textAlign: 'center',
                  color: '#64748b',
                }}
              >
                <div style={{ fontSize: '1.4rem', marginBottom: '0.35rem' }}>🔍</div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: '0.88rem', color: '#0f172a' }}>
                  {noResultsText} "{searchQuery}"
                </p>
                <p style={{ margin: '0.25rem 0 0.65rem 0', fontSize: '0.78rem', color: '#94a3b8' }}>
                  Try typing a different name, Employee ID, office, or position.
                </p>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{
                    padding: '0.3rem 0.75rem',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    backgroundColor: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '4px',
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  Clear Search
                </button>
              </div>
            ) : (
              filteredPersonnel.map((p, index) => {
                const navIndex = showStandAloneOption ? index + 1 : index;
                const isSelected =
                  String(selectedPersonnel?.id) === String(p.id) ||
                  (valueKey === 'name' && value === p.full_name);
                const isHighlighted = highlightedIndex === navIndex;
                const busyInfo = isPersonnelBusy ? isPersonnelBusy(p) : null;
                const isBusy = Boolean(busyInfo);

                // Account link status
                const isLinkedToCurrent =
                  currentUserId && String(p.user) === String(currentUserId);
                const isLinkedToOther =
                  p.user && (!currentUserId || String(p.user) !== String(currentUserId));

                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      if (!isBusy) handleSelect(p);
                    }}
                    onMouseEnter={() => setHighlightedIndex(navIndex)}
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
                    {/* Left: Avatar + Details */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          background: isBusy
                            ? 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)'
                            : 'linear-gradient(135deg, #0305ba 0%, #1e40af 100%)',
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 800,
                          fontSize: '0.75rem',
                          flexShrink: 0,
                          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12)',
                        }}
                      >
                        {isBusy ? '🚫' : getInitials(p.full_name)}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: '0.9rem',
                              color: isBusy ? '#64748b' : '#0f172a',
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
                                backgroundColor: isBusy ? '#f1f5f9' : 'rgba(3, 5, 186, 0.07)',
                                padding: '0.1rem 0.35rem',
                                borderRadius: '4px',
                              }}
                            >
                              {p.employee_id}
                            </span>
                          )}

                          {/* Account status badge */}
                          {showAccountStatus && (
                            <>
                              {isLinkedToCurrent ? (
                                <span
                                  style={{
                                    fontSize: '0.68rem',
                                    fontWeight: 700,
                                    color: '#047857',
                                    backgroundColor: '#ecfdf5',
                                    border: '1px solid #a7f3d0',
                                    padding: '0.08rem 0.4rem',
                                    borderRadius: '4px',
                                  }}
                                >
                                  ✓ Linked to this account
                                </span>
                              ) : isLinkedToOther ? (
                                <span
                                  style={{
                                    fontSize: '0.68rem',
                                    fontWeight: 600,
                                    color: '#b45309',
                                    backgroundColor: '#fffbeb',
                                    border: '1px solid #fde68a',
                                    padding: '0.08rem 0.4rem',
                                    borderRadius: '4px',
                                  }}
                                  title={`Linked to user account @${p.user_username}`}
                                >
                                  🔗 Linked to @{p.user_username}
                                </span>
                              ) : (
                                <span
                                  style={{
                                    fontSize: '0.68rem',
                                    fontWeight: 600,
                                    color: '#64748b',
                                    backgroundColor: '#f8fafc',
                                    border: '1px solid #e2e8f0',
                                    padding: '0.08rem 0.4rem',
                                    borderRadius: '4px',
                                  }}
                                >
                                  👤 Available
                                </span>
                              )}
                            </>
                          )}
                        </div>

                        {/* Position & Office Sub-row */}
                        <div
                          style={{
                            fontSize: '0.78rem',
                            color: '#64748b',
                            marginTop: '0.15rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            flexWrap: 'wrap',
                          }}
                        >
                          {p.position && <span>{p.position}</span>}
                          {showOffice && p.office_name && (
                            <span style={{ color: '#475569', fontWeight: 500 }}>
                              🏢 {p.office_name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Specialist Badge, Busy info, Division badges, Checkmark */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                      {serviceId &&
                        Array.isArray(p.service_ids) &&
                        p.service_ids.includes(Number(serviceId)) && (
                          <span
                            style={{
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              color: '#059669',
                              backgroundColor: '#ecfdf5',
                              border: '1px solid #a7f3d0',
                              padding: '0.12rem 0.4rem',
                              borderRadius: '4px',
                              whiteSpace: 'nowrap',
                            }}
                            title="Personnel explicitly assigned to this service"
                          >
                            ★ Service Specialist
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
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                          {p.division_names?.map((d) => getDivisionBadge(d))}
                        </div>
                      )}

                      {isSelected && !isBusy && (
                        <span
                          style={{
                            color: 'var(--dole-blue)',
                            fontWeight: 800,
                            fontSize: '0.95rem',
                            marginLeft: '0.3rem',
                          }}
                        >
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
