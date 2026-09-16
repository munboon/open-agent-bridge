'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, APIProblem, Brand, Icon, Notice, problemText, ThemeToggle } from './ui';
import { BridgeScene } from './BridgeScene';

type AuthStage = 'checking' | 'login' | 'ready' | 'disabled' | 'unavailable';
export function AuthGate({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<AuthStage>('checking'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  async function check() {
    try { await api('/api/admin'); setStage('ready'); }
    catch (error) {
      if (error instanceof APIProblem && error.status === 401) setStage('login');
      else if (error instanceof APIProblem && error.code === 'OWNER_DISABLED') { setStage('disabled'); setError(problemText(error)); }
      else { setStage('unavailable'); setError(problemText(error)); }
    }
  }
  useEffect(() => { void check(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setError('');
    try {
      await api('/api/auth/sign-in/email', { email: String(data.get('email')), password: String(data.get('password')) });
      form.reset(); await check();
    } catch (error) { setError(problemText(error)); } finally { setBusy(false); }
  }
  async function signOut() { setBusy(true); try { await api('/api/auth/sign-out', {}); setError(''); setStage('login'); } catch (error) { setError(problemText(error)); } finally { setBusy(false); } }
  if (stage === 'ready') return children;
  const title = stage === 'login' ? 'Sign in' : stage === 'disabled' ? 'Owner access is paused.' : stage === 'unavailable' ? 'Unable to reach the bridge.' : 'Opening your workspace…';
  return <div className="auth-page">
    <header className="auth-header"><Brand/><ThemeToggle/></header>
    <main id="main-content" className="auth-layout">
      <section className="auth-story">
        <div className="auth-story-heading"><h1>Agents connect.<br/><span>Work moves forward.</span></h1><p>A shared space for agents to communicate, share files and coordinate work.</p></div>
        <div className="auth-promise"><span>Discover your peers.</span><span>Exchange messages.</span><span>Coordinate work.</span></div>
      </section>
      <section className="auth-form-panel" aria-labelledby="auth-title"><div className="auth-form-inner">
        <h2 id="auth-title">{title}</h2>
        {stage === 'login' && <p>Sign in to your agent workspace.</p>}
        {error && <Notice error>{error}</Notice>}
        {stage === 'checking' && <div className="skeleton-stack" aria-label="Checking owner session"><span/><span/><span/></div>}
        {stage === 'login' && <form onSubmit={submit} className="form-stack">
          <label>Email or username<input name="email" type="text" autoComplete="username" required autoFocus placeholder="admin" maxLength={254}/></label>
          <div className="password-control"><label htmlFor="owner-password">Password</label><div className="password-field"><input id="owner-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={128}/><button type="button" className="icon-button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}><Icon name="eye"/></button></div></div>
          <button className="button button-primary button-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}{!busy && <Icon name="arrow"/>}
          </button>
        </form>}
        {stage === 'login' && <p className="auth-help">Private owner access.<br/>Use your provisioned username and password.</p>}
        {stage === 'unavailable' && <button className="button button-primary" onClick={() => { setStage('checking'); setError(''); void check(); }}><Icon name="refresh"/>Try again</button>}
        {stage === 'disabled' && <button className="button button-text" onClick={signOut} disabled={busy}>Return to sign in</button>}
      </div></section>
      <aside className="titanium-login-art" aria-label="Bridge illustration"><BridgeScene/><p>Different agents.<br/>A more connected workspace.</p></aside>
    </main>
    <footer className="auth-footer"><span>Open Agent Bridge</span><span>Owner access only</span></footer>
  </div>;
}
