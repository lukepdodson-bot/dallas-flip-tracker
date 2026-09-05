import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { ErrorNote } from './ui';

/**
 * Stripe Connect onboarding. Until this is done a payee's leg of a settlement
 * fails - the buyer still gets their painting and their certificate, but the
 * money sits waiting - so it is worth being loud about.
 */
export default function PayoutStatus() {
  const [status, setStatus] = useState(null);
  const [error, setError]   = useState(null);
  const [busy, setBusy]     = useState(false);

  const load = () => api.get('/auth/payout-account')
    .then(({ data }) => setStatus(data))
    .catch(err => setError(err.message));

  useEffect(() => { load(); }, []);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post('/auth/payout-account');
      if (data.simulated) await load();            // no real onboarding to visit
      else window.location.assign(data.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const ready = status?.payoutsEnabled;

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg text-ink-900">Getting paid</h2>
          <p className="mt-1 text-sm text-ink-600">
            {ready
              ? 'Your payout account is ready. Your share is transferred automatically when a commission settles.'
              : 'Connect a payout account before your first commission settles, or your share waits until you do.'}
          </p>
          {status?.simulated && (
            <p className="mt-2 text-xs text-ink-400">
              This install is running the ledger simulator - no Stripe key is configured, so onboarding is
              skipped and payouts are recorded rather than sent.
            </p>
          )}
        </div>
        {!ready && (
          <button className="btn-primary shrink-0" onClick={connect} disabled={busy}>
            {busy ? 'Opening' : 'Connect'}
          </button>
        )}
      </div>
      <ErrorNote error={error} className="mt-3" />
    </section>
  );
}
