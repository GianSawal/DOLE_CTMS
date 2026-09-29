import React, { useState, useEffect, useRef, useMemo } from 'react';

const DIVISION_BADGES = {
  'TSSD 1': { color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  'TSSD1': { color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  'TSSD 2': { color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd' },
  'TSSD2': { color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd' },
  'IMSD': { color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  'MALSU': { color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
};

export default function SearchableServiceSelect({
  services = [],
  value = '',
  onChange,
  placeholder = '-- Select a Service --',
  searchPlaceholder = 'Search services or division...',
  noResultsText = 'No services found matching',
  required = false,
  id = 'searchable-service-select',
  disabled = false,
  dropDirection = 'auto',
  maxListHeight = '240px',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);

  // Find currently selected service object
  const selectedService = useMemo(() => {
    if (!value) return null;
    return services.find(s => String(s.id) === String(value)) || null;
  }, [services, value]);

  // Instant real-time filtering while typing
  const filteredServices = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return services;
    return services.filter(svc => {
      const nameMatch = svc.name && svc.name.toLowerCase().includes(q);
      const divMatch = svc.division_name && svc.division_name.toLowerCase().includes(q);
      return nameMatch || divMatch;
    });
  }, [services, searchQuery]);

  // Calculate optimal drop direction (up vs down)
  const calculateDirection = useCallback(() => {
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
    const modalEl = containerRef.current.closest('[role="dialog"], [style*="position: fixed"], .card, form') || containerRef.current.offsetParent;
    if (modalEl) {
      const modalRect = modalEl.getBoundingClientRect();
      const modalSpaceBelow = modalRect.bottom - rect.bottom;
      const modalSpaceAbove = rect.top - modalRect.top;

      // If space below inside modal is limited (< 260px) and space above has more room:
      if (modalSpaceBelow < 260 && modalSpaceAbove > modalSpaceBelow) {
        setDropUp(true);
        return;
      }
    }

    if (spaceBelowViewport < 300 && spaceAboveViewport > spaceBelowViewport) {
      setDropUp(true);
    } else {
      setDropUp(false);
    }
  }, [dropDirection]);

  // Focus search input and detect direction when dropdown opens
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

  // Auto-scroll highlighted index into view
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
      setHighlightedIndex((prev) => (prev < filteredServices.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredServices.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredServices[highlightedIndex]) {
        handleSelect(filteredServices[highlightedIndex].id);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const handleSelect = (serviceId) => {
    if (onChange) {
      onChange(serviceId);
    }
    setIsOpen(false);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    if (onChange) {
      onChange('');
    }
  };

  const getDivisionBadge = (divisionName) => {
    if (!divisionName) return null;
    const style = DIVISION_BADGES[divisionName.trim()] || {
      color: '#475569',
      bg: '#f1f5f9',
      border: '#cbd5e1'
    };
    return (
      <span style={{
        fontSize: '0.72rem',
        fontWeight: 700,
        padding: '0.15rem 0.5rem',
        borderRadius: '4px',
        color: style.color,
        backgroundColor: style.bg,
        border: `1px solid ${style.border}`,
        whiteSpace: 'nowrap',
        marginLeft: '0.5rem',
        flexShrink: 0,
      }}>
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
          {selectedService ? (
            <div style={{ display: 'flex', alignItems: 'center', width: '100%', minWidth: 0 }}>
              <span style={{
                color: 'var(--text-primary)',
                fontWeight: 600,
                fontSize: '0.92rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {selectedService.name}
              </span>
              {getDivisionBadge(selectedService.division_name)}
            </div>
          ) : (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.92rem' }}>
              {placeholder}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
          {selectedService && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              title="Clear selection"
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '2px 5px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.9rem',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
            >
              ✕
            </button>
          )}
          <span style={{
            color: '#64748b',
            fontSize: '0.75rem',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}>
            ▼
          </span>
        </div>
      </div>

      {/* Floating Dropdown Menu */}
      {isOpen && (
        <div style={{
          position: 'absolute',
          ...(dropUp ? {
            bottom: 'calc(100% + 4px)',
            top: 'auto',
            boxShadow: '0 -10px 25px -5px rgba(0, 0, 0, 0.15), 0 -8px 10px -6px rgba(0, 0, 0, 0.1)',
          } : {
            top: 'calc(100% + 4px)',
            bottom: 'auto',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          }),
          left: 0,
          right: 0,
          backgroundColor: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: '10px',
          zIndex: 9999,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Search Header Input */}
          <div style={{
            padding: '0.6rem',
            borderBottom: '1px solid #f1f5f9',
            backgroundColor: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}>
            <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>🔍</span>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={searchPlaceholder}
              style={{
                flex: 1,
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '0.45rem 0.65rem',
                fontSize: '0.88rem',
                outline: 'none',
                backgroundColor: '#ffffff',
                minHeight: '34px',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--dole-blue)')}
              onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  padding: '2px 4px',
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Service Results List */}
          <div
            ref={listRef}
            style={{
              maxHeight: maxListHeight || '240px',
              overflowY: 'auto',
              padding: '0.35rem 0',
            }}
          >
            {filteredServices.length === 0 ? (
              <div style={{
                padding: '1.25rem 1rem',
                textAlign: 'center',
                color: '#64748b',
                fontSize: '0.85rem',
              }}>
                {noResultsText} "{searchQuery}"
              </div>
            ) : (
              filteredServices.map((svc, idx) => {
                const isSelected = String(svc.id) === String(value);
                const isHighlighted = idx === highlightedIndex;
                return (
                  <div
                    key={svc.id}
                    onClick={() => handleSelect(svc.id)}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    style={{
                      padding: '0.65rem 0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      backgroundColor: isSelected
                        ? 'rgba(3, 5, 186, 0.08)'
                        : isHighlighted
                        ? '#f1f5f9'
                        : 'transparent',
                      transition: 'background-color 0.1s ease',
                      borderBottom: '1px solid #f8fafc',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, marginRight: '0.5rem' }}>
                      <span style={{
                        fontSize: '0.88rem',
                        fontWeight: isSelected ? 700 : 500,
                        color: isSelected ? 'var(--dole-blue)' : '#0f172a',
                        lineHeight: 1.35,
                      }}>
                        {svc.name}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                      {getDivisionBadge(svc.division_name)}
                      {isSelected && (
                        <span style={{ color: 'var(--dole-blue)', fontWeight: 800, fontSize: '0.9rem' }}>
                          ✓
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Results Summary Footer */}
          <div style={{
            padding: '0.4rem 0.75rem',
            backgroundColor: '#f8fafc',
            borderTop: '1px solid #f1f5f9',
            fontSize: '0.72rem',
            color: '#64748b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span>
              {filteredServices.length} {filteredServices.length === 1 ? 'service' : 'services'} available
            </span>
            <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
              Press ↑↓ to navigate, Enter to select
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
