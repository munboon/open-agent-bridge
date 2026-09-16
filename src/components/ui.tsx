'use client';

import { browserRequestKey } from '../lib/browser-request-key';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export type IconName = 'search' | 'filter' | 'trash' | 'archive' | 'server' | 'link' | 'bolt' | 'chevron' | 'bridge' | 'projects' | 'agents' | 'messages' | 'tasks' | 'transfer' | 'audit' | 'plus' | 'arrow' | 'back' | 'check' | 'close' | 'sun' | 'moon' | 'key' | 'shield' | 'logout' | 'refresh' | 'download' | 'copy' | 'eye' | 'settings' | 'menu';
const generatedIcons: IconName[] = ['search','filter','trash','archive','server','link','bolt','chevron','bridge','projects','agents','messages','tasks','transfer','audit','plus','arrow','back','check','close','sun','moon','key','shield','logout','refresh','download','copy','eye','settings','menu'];
export function Icon({name, className = ''}: {name: IconName; className?: string}) {
  const index = generatedIcons.indexOf(name);
  return <span className={`icon titanium-icon ${className}`} aria-hidden="true"><span style={{backgroundPosition: `${index % 6 * 20}% ${Math.floor(index / 6) * 20}%`}}/></span>;
}
export function Brand() {
  return <div className="brand"><img className="titanium-brand-mark" src="/brand/open-agent-bridge.svg" alt="" width="48" height="33"/><span>Open<small>Agent Bridge</small></span></div>;
}
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { let theme = document.documentElement.dataset.theme || 'light'; try { const saved = localStorage.getItem('oab-theme'); if (saved === 'dark' || saved === 'light') theme = saved; } catch {} document.documentElement.dataset.theme = theme; setDark(theme === 'dark'); }, []);
  function toggle() { const value = !dark; document.documentElement.dataset.theme = value ? 'dark' : 'light'; setDark(value); try { localStorage.setItem('oab-theme', value ? 'dark' : 'light'); } catch {} }
  return <button type="button" className="icon-button" onClick={toggle} aria-label={dark ? 'Use light theme' : 'Use dark theme'} title={dark ? 'Use light theme' : 'Use dark theme'}><Icon name={dark ? 'sun' : 'moon'}/></button>;
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`notice ${error ? 'notice-error' : ''}`} role={error ? 'alert' : 'status'}><Icon name={error ? 'shield' : 'check'}/><div>{children}</div></div>;
}
export function Modal({ title, children, onClose, busy = false, className = '' }: { className?: string; title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={`modal ${className}`} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}><div className="modal-heading"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={busy}><Icon name="close"/></button></div>{children}</dialog>;
}
export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-symbol"><Icon name={icon}/></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function downloadText(filename: string, value: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([value], { type })); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function SecretValue({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  const [revealed, setRevealed] = useState(false); const [copied, setCopied] = useState(false); const [error, setError] = useState('');
  async function copy() { try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setError('Clipboard access was blocked. Reveal the value to copy it manually.'); } }
  return <div className="secret-value"><label>{label}{multiline && revealed ? <textarea readOnly value={value} rows={5} spellCheck={false}/> : <input type={revealed ? 'text' : 'password'} readOnly value={value} autoComplete="off" spellCheck={false}/>}</label><div className="button-row"><button type="button" className="button button-text" onClick={() => setRevealed(!revealed)}><Icon name="eye"/>{revealed ? 'Hide' : 'Reveal'}</button><button type="button" className="button button-text" onClick={copy}><Icon name="copy"/>{copied ? 'Copied' : 'Copy'}</button></div>{error && <Notice error>{error}</Notice>}</div>;
}
export class APIProblem extends Error {
  constructor(public code: string, message: string, public status: number, public requestId?: string) { super(message); }
}
export async function api<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? undefined : { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey ?? browserRequestKey() }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new APIProblem('NETWORK_ERROR', 'The bridge could not be reached. Check your connection and try again.', 0); }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new APIProblem(payload?.code ?? payload?.error?.code ?? 'REQUEST_FAILED', payload?.message ?? payload?.error?.message ?? 'The request could not be completed.', response.status, payload?.request_id);
  return payload as T;
}
export function problemText(error: unknown): string {
  if (!(error instanceof APIProblem)) return 'The request could not be completed. Try again.';
  const messages: Record<string, string> = {
    INVALID_EMAIL_OR_PASSWORD: 'The username or password was not recognized. Check both and try again.', OWNER_DISABLED: 'This owner account is disabled. Contact the local administrator to restore access.',
    TOO_MANY_REQUESTS: 'Too many attempts. Wait a moment before trying again.', SERVICE_UNAVAILABLE: 'The bridge is temporarily unavailable. Try again shortly.',
    INVALID_ORIGIN: 'This address is not authorized for owner administration. Open the configured bridge address.', INVALID_REQUEST: 'Check the form values and try again.',
  };
  return messages[error.code] ?? (error.status === 429 ? messages.TOO_MANY_REQUESTS : error.message);
}
