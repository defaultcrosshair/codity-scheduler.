import React from 'react';
import { LogOut } from 'lucide-react';

interface NavbarProps {
  user: { name: string; role: string; organizationName: string } | null;
  onLogout: () => void;
}

export default function Navbar({ user, onLogout }: NavbarProps) {
  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return 'badge badge-priority-high';
      case 'DEVELOPER':
        return 'badge badge-priority-medium';
      default:
        return 'badge badge-priority-low';
    }
  };

  return (
    <header style={styles.header}>
      <div style={styles.left}>
        <div style={styles.brand}>
          <img src="/logo.svg" alt="Codity Logo" style={styles.logoImg} />
          <span style={styles.brandGradient}>Codity</span>
          <span style={styles.brandSub}>Scheduler</span>
        </div>
      </div>

      <div style={styles.right}>
        {user && (
          <div style={styles.userInfo}>
            <span style={styles.orgName}>{user.organizationName}</span>
            <span style={styles.divider}>|</span>
            <span style={styles.userName}>{user.name}</span>
            <span
              className={getRoleBadgeClass(user.role)}
              style={{ fontSize: '9px', fontWeight: 800, padding: '2px 6px', margin: 0 }}
            >
              {user.role}
            </span>
          </div>
        )}

        <button onClick={onLogout} className="logout-btn-red" title="Sign Out">
          <LogOut size={16} color="#000000" />
          <span>Sign Out</span>
        </button>
      </div>
    </header>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    height: 'var(--header-height)',
    backgroundColor: 'var(--bg-header)',
    borderTop: '2px solid var(--border-color)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between', // corrected from invalid 'between'
    padding: '0 24px',
    flexShrink: 0,
    width: '100%',
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: '32px',
  },
  brand: {
    fontSize: '20px',
    fontWeight: 'bold',
    letterSpacing: '-0.8px',
    display: 'flex',
    alignItems: 'center',
    userSelect: 'none',
  },
  logoImg: {
    height: '24px',
    marginRight: '8px',
    display: 'block',
  },
  brandGradient: {
    color: 'var(--primary)',
    fontWeight: 'bold',
  },
  brandSub: {
    color: 'var(--text-secondary)',
    fontWeight: 400,
    fontSize: '16px',
    marginLeft: '6px',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '14px',
  },
  orgName: {
    color: 'var(--text-secondary)',
    fontWeight: 500,
  },
  divider: {
    color: 'var(--border-color)',
  },
  userName: {
    color: 'var(--text-primary)',
    fontWeight: 500,
  },

};
