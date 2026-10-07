'use client';
import { useId, useState } from 'react';

type Props = { name: 'expires_days' | 'days'; defaultDays?: number; extend?: boolean };
export function AccessDurationFields({ name, defaultDays = 60, extend = false }: Props) {
  const [mode, setMode] = useState<'limited' | 'unlimited'>('limited');
  const [days, setDays] = useState(String(defaultDays));
  const id = useId();
  const limited = mode === 'limited';
  return <>
    <label htmlFor={`${id}-mode`}>{extend ? 'Extension' : 'Access duration'}
      <select id={`${id}-mode`} name="access_mode" value={mode} onChange={e => setMode(e.target.value as 'limited' | 'unlimited')}>
        <option value="limited">Limited duration</option><option value="unlimited">Unlimited</option>
      </select>
    </label>
    {limited && <label htmlFor={`${id}-days`}>{extend ? 'Days to add' : 'Access duration in days'}
      <input id={`${id}-days`} name={name} type="number" inputMode="numeric" min={1} max={90} required value={days} onChange={e => setDays(e.target.value)}/>
      <span className="supporting">Choose 1 to 90 days.</span>
    </label>}
    <p className="supporting">{extend
      ? (limited ? 'Current access gains the selected days; expired access restarts from today. Unlimited credentials stay unlimited.' : 'All non-revoked credentials become unlimited. Expired access restarts without an end date.')
      : (limited ? 'Agent access lasts for the selected duration.' : 'Access continues until you revoke it.')}</p>
  </>;
}
export function readAccessDays(form: FormData, name: 'expires_days' | 'days'): number | null {
  if (form.get('access_mode') === 'unlimited') return null;
  const raw = form.get(name);
  const days = typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (form.get('access_mode') !== 'limited' || !Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error('Choose 1 to 90 days or select Unlimited.');
  }
  return days;
}
