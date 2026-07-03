import React, { useState } from 'react';
import { LayoutDashboard, Layers, PlaySquare, Cpu } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const [isHovered, setIsHovered] = useState(false);

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'queues', label: 'Queues Manager', icon: Layers },
    { id: 'jobs', label: 'Job Explorer', icon: PlaySquare },
    { id: 'workers', label: 'Worker Monitor', icon: Cpu },
  ];

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        ...styles.container,
        height: isHovered ? '56px' : '36px',
      }}
    >
      {/* Left-aligned brand logo (visible all the time, no text) */}
      <div style={styles.brand}>
        <img src="/logo.svg" alt="Codity Logo" style={styles.logoImg} />
      </div>

      <div style={styles.navRow}>
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className="nav-dropdown-button"
              style={{
                ...styles.navButton,
                backgroundColor: isActive ? 'var(--primary-bg)' : 'transparent',
                borderColor: isActive ? 'var(--primary)' : 'transparent',
                color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                padding: isHovered ? '6px 16px' : '4px 12px',
              }}
            >
              <Icon size={16} color={isActive ? 'var(--primary)' : 'var(--text-secondary)'} />
              <span
                style={{
                  ...styles.label,
                  opacity: isHovered ? 1 : 0,
                  maxWidth: isHovered ? '150px' : '0px',
                  marginLeft: isHovered ? '8px' : '0px',
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'var(--bg-card)',
    borderBottom: '2px solid var(--border-color)',
    zIndex: 999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'height 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.1)',
    overflow: 'hidden',
  },
  brand: {
    position: 'absolute',
    left: '24px',
    display: 'flex',
    alignItems: 'center',
    height: '100%',
    userSelect: 'none',
    pointerEvents: 'none',
  },
  logoImg: {
    height: '20px',
    display: 'block',
  },
  navRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '0 24px',
    height: '100%',
    width: '100%',
    justifyContent: 'center',
  },
  navButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0,
    background: 'none',
    border: '2px solid transparent',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  label: {
    fontWeight: 700,
    fontSize: '13px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    transition: 'opacity 0.18s ease, max-width 0.18s ease, margin-left 0.18s ease',
  },
};
