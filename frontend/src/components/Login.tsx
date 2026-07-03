import React, { useState } from 'react';

interface LoginProps {
  onLoginSuccess: (token: string, user: { id: string; email: string; name: string; role: string; organizationId: string; organizationName: string }) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Login failed.');
      }

      onLoginSuccess(data.token, data.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <img src="/logo.svg" alt="Codity Logo" style={styles.logoImg} />
          <h1 style={styles.title}>Sign In to Codity.ai</h1>
          <p style={styles.subtitle}>Distributed Background Scheduler</p>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} style={styles.form}>
          <div className="form-group" style={{ marginBottom: '14px' }}>
            <label className="form-label" htmlFor="email" style={{ color: 'var(--text-secondary)' }}>
              Email address
            </label>
            <input
              id="email"
              type="email"
              className="form-input"
              style={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="form-group" style={{ marginBottom: '18px' }}>
            <label className="form-label" htmlFor="password" style={{ color: 'var(--text-secondary)' }}>
              Password
            </label>
            <input
              id="password"
              type="password"
              className="form-input"
              style={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '10px', marginTop: '4px' }}
            disabled={loading}
          >
            {loading ? 'Authenticating...' : 'Sign in'}
          </button>
        </form>

        <div style={styles.credentialsBox}>
          <h3 style={{ fontSize: '10px', color: 'var(--text-primary)', marginBottom: '8px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            Autofill Accounts:
          </h3>
          <div 
            className="credential-chip" 
            role="button"
            onClick={() => { setEmail('admin@example.com'); setPassword('password123'); }}
          >
            <span>Admin</span>
            <code style={{ fontSize: '10px', opacity: 0.8 }}>admin@example.com</code>
          </div>
          <div 
            className="credential-chip" 
            role="button"
            onClick={() => { setEmail('dev@example.com'); setPassword('password123'); }}
          >
            <span>Developer</span>
            <code style={{ fontSize: '10px', opacity: 0.8 }}>dev@example.com</code>
          </div>
          <div 
            className="credential-chip" 
            role="button"
            onClick={() => { setEmail('viewer@example.com'); setPassword('password123'); }}
          >
            <span>Viewer</span>
            <code style={{ fontSize: '10px', opacity: 0.8 }}>viewer@example.com</code>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    width: '100vw',
    backgroundColor: 'transparent', // Transparent container to show canvas grid
    padding: '16px',
    fontFamily: "'Outfit', sans-serif",
  },
  card: {
    backgroundColor: 'var(--bg-card)',
    border: '2px solid var(--border-color)',
    borderRadius: '8px',
    width: '100%',
    maxWidth: '360px', // Smaller, more compact card size
    padding: '30px', // Cleaner, minimal padding
    position: 'relative',
  },
  header: {
    textAlign: 'center',
    marginBottom: '20px',
  },
  logoImg: {
    height: '32px', // Standard clean logo
    marginBottom: '12px',
    display: 'inline-block',
  },
  title: {
    fontSize: '18px',
    fontWeight: 700,
    color: 'var(--text-primary)',
    marginBottom: '2px',
  },
  subtitle: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
  },
  error: {
    backgroundColor: 'var(--danger-bg)',
    border: '2px solid var(--danger)',
    color: 'var(--danger)',
    padding: '8px 10px',
    borderRadius: '4px',
    fontSize: '12px',
    marginBottom: '14px',
    textAlign: 'center',
  },
  form: {
    marginBottom: '20px',
  },
  input: {
    backgroundColor: 'var(--bg-page)',
    color: 'var(--text-primary)',
    borderColor: 'var(--border-color)',
    padding: '8px 10px',
  },
  credentialsBox: {
    backgroundColor: 'var(--bg-page)',
    border: '2px solid var(--border-color)',
    borderRadius: '6px',
    padding: '12px',
    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.03)',
  },
};
