import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { Card, ErrorMessage, Shell } from '../components/Shell';
import { EventBrand, LifecycleStatus } from '../components/EventBrand';
import type { QueueInfo, VendorDashboard } from '../types';
import { useAppI18n } from '../i18n/context';


export function VendorPage() {
  const { queueId = '' } = useParams();
  const { t, locale } = useAppI18n();
  const [queue, setQueue] = useState<QueueInfo | null>(null);
  const [periodLoaded, setPeriodLoaded] = useState(false);
  const [dashboard, setDashboard] = useState<VendorDashboard | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');
  const generation = useRef(0);
  const currentDashboard = dashboard?.queueId === queueId ? dashboard : null;
  const customerUrl = currentDashboard?.customerUrl;
  const loadPeriod = useCallback(async (requestGeneration = generation.current) => {
    try { const result = await apiRequest<QueueInfo>(`/api/queues/${queueId}`); if (generation.current === requestGeneration) setQueue(result); }
    catch { if (generation.current === requestGeneration) { setQueue(null); setDashboard(null); setError('errors.queueNotFound'); } }
    finally { if (generation.current === requestGeneration) setPeriodLoaded(true); }
  }, [queueId]);
  const load = useCallback(async (requestGeneration = generation.current) => {
    try { const result = await apiRequest<VendorDashboard>(`/api/vendor/${queueId}`); if (generation.current === requestGeneration) { setDashboard(result); setNeedsLogin(false); } }
    catch (cause) { if (generation.current !== requestGeneration) return; setDashboard(null); if (cause instanceof Error && cause.message.includes('authentication')) setNeedsLogin(true); else setError('errors.loadDashboard'); }
  }, [queueId]);
  useEffect(() => { const current = ++generation.current; setPeriodLoaded(false); setQueue(null); setDashboard(null); setNeedsLogin(false); setBusy(false); setError(''); setQr(''); void loadPeriod(current); void load(current); return () => { if (generation.current === current) generation.current += 1; }; }, [loadPeriod, load]);
  useEffect(() => { setQr(''); if (!customerUrl) return; let active = true; void QRCode.toDataURL(`${location.origin}${customerUrl}`, { width: 420, margin: 2 }).then(value => { if (active) setQr(value); }); const timer = setInterval(() => { void loadPeriod(); void load(); }, 3000); return () => { active = false; clearInterval(timer); }; }, [customerUrl, load, loadPeriod]);
  async function unlock(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const requestGeneration = generation.current; setBusy(true); setError(''); const form = new FormData(event.currentTarget); try { await apiRequest(`/api/queues/${queueId}/unlock`, { method: 'POST', body: JSON.stringify({ credential: form.get('credential') }) }); if (generation.current === requestGeneration) await load(requestGeneration); } catch { if (generation.current === requestGeneration) setError('errors.accessDenied'); } finally { if (generation.current === requestGeneration) setBusy(false); } }
  async function action(path: string, method: 'POST' | 'DELETE') { const requestGeneration = generation.current; setBusy(true); setError(''); try { await apiRequest(path, { method }); if (generation.current === requestGeneration) await load(requestGeneration); return generation.current === requestGeneration; } catch { if (generation.current === requestGeneration) setError('errors.actionFailed'); return false; } finally { if (generation.current === requestGeneration) setBusy(false); } }
  async function logout() { if (await action(`/api/vendor/${queueId}/logout`, 'POST')) { setDashboard(null); setNeedsLogin(true); } }
  if (!periodLoaded || (queue !== null && queue.queueId !== queueId)) return <Shell><div className="narrow"><Card><p>{t('staff.loading')}</p></Card></div></Shell>;
  if (!queue) return <Shell><div className="narrow"><Card><ErrorMessage message={error ? t(error) : ''} /></Card></div></Shell>;
  if (queue.lifecycleStatus === 'scheduled') return <Shell><div className="narrow"><Card className="lifecycle-card"><LifecycleStatus event={queue} audience="staff" /><Link className="button ghost" to="/">{t('staff.backLogin')}</Link></Card></div></Shell>;
  if (queue?.lifecycleStatus === 'ended') return <Shell><div className="narrow"><Card className="lifecycle-card"><LifecycleStatus event={queue} audience="staff" /><Link className="button ghost" to="/">{t('staff.backLogin')}</Link></Card></div></Shell>;
  if (needsLogin && !currentDashboard) return <Shell><div className="narrow"><Card><div className="lock-mark">N</div><p className="eyebrow">{t('staff.protectedEvent')}</p><h1>{t('staff.access')}</h1><p className="muted">{t('staff.passwordHint')}</p><form className="form-stack" onSubmit={unlock}><label>{t('common.password')}<input name="credential" type="password" autoComplete="current-password" required /></label><ErrorMessage message={error ? t(error) : ''} /><button className="button primary" disabled={busy}>{busy ? t('common.checking') : t('staff.unlock')}</button><Link className="button ghost" to="/">{t('staff.anotherEvent')}</Link></form></Card></div></Shell>;
  if (!currentDashboard) return <Shell><div className="narrow"><Card><p>{t('staff.loading')}</p><ErrorMessage message={error ? t(error) : ''} /></Card></div></Shell>;
  const joinUrl = `${location.origin}${currentDashboard.customerUrl}`;
  return <Shell actions={<button className="button small ghost" onClick={() => void logout()}>{t('common.logOut')}</button>}><section className="dashboard-head"><div><EventBrand event={currentDashboard} eyebrow={t('staff.dashboard')} /><p className="muted">{t('staff.waitingCount', { count: currentDashboard.waitingCount, unit: t(currentDashboard.waitingCount === 1 ? 'common.person' : 'common.people') })}</p></div><button className="button primary" disabled={busy || !currentDashboard.waitingCount} onClick={() => void action(`/api/vendor/${queueId}/serve-next`, 'POST')}>{t('staff.callNext')}</button></section><ErrorMessage message={error ? t(error) : ''} />
    <div className="dashboard-grid"><Card className="qr-card"><h2>{t('staff.publicAccess')}</h2><p className="muted">{t('staff.publicHint')}</p>{qr && <img src={qr} alt={t('staff.qrAlt')} />}<div className="stack"><strong>{t('staff.publicUrl')}</strong><code>{joinUrl}</code><button className="button secondary" onClick={() => navigator.clipboard.writeText(joinUrl)}>{t('staff.copyUrl')}</button>{qr && <a className="button ghost" href={qr} download={`${currentDashboard.name}-queue-qr.png`}>{t('staff.downloadQr')}</a>}<Link className="text-link" to={currentDashboard.customerUrl}>{t('staff.previewCustomer')}</Link></div></Card>
      <Card className="queue-card"><div className="section-heading row"><div><h2>{t('staff.currentQueue')}</h2><p className="muted">{t('staff.fifo')}</p></div>{currentDashboard.customers.length > 0 && <button className="button small danger" disabled={busy} onClick={() => confirm(t('staff.clearConfirm')) && void action(`/api/vendor/${queueId}/customers`, 'DELETE')}>{t('staff.clearAll')}</button>}</div>{currentDashboard.customers.length === 0 ? <div className="empty"><strong>{t('staff.empty')}</strong><p>{t('staff.emptyHint')}</p></div> : <ol className="customer-list">{currentDashboard.customers.map((customer, index) => <li key={customer.customerId}><span className="position">{index + 1}</span><div className="customer-info"><strong>{customer.name}</strong><span>{new Date(customer.joinedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}{customer.phone ? ` · ${customer.phone}` : ''}</span>{customer.message && <p>{customer.message}</p>}</div><button className="button small ghost" disabled={busy} onClick={() => confirm(t('staff.removeConfirm', { name: customer.name })) && void action(`/api/vendor/${queueId}/customers/${customer.customerId}`, 'DELETE')}>{t('staff.remove')}</button></li>)}</ol>}</Card></div>
  </Shell>;
}
