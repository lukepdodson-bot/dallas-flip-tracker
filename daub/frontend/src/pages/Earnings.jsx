import { useEffect, useState } from 'react';
import { api, money, downloadFile, shortDate } from '../api/client';
import { Page, Loading, ErrorNote, Empty } from '../components/ui';
import PayoutStatus from '../components/PayoutStatus';

export default function Earnings() {
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy]   = useState(false);
  const year = new Date().getFullYear();

  const load = () => api.get('/tax/documents')
    .then(({ data }) => setDocuments(data))
    .catch(err => setError(err.message));

  useEffect(() => { load(); }, []);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/tax/documents/${year}`);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Page
      title="Earnings"
      lede="What the platform released to you, and the statement that backs it. You never invoice anyone here,
            and nobody invoices you."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr,1.3fr]">
        <PayoutStatus />

        <section className="card p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-lg text-ink-900">Annual statements</h2>
            <button className="btn-ghost" onClick={generate} disabled={busy}>
              {busy ? 'Working' : `Refresh ${year}`}
            </button>
          </div>

          <ErrorNote error={error} className="mt-3" />

          {!documents ? <Loading />
            : documents.length === 0 ? (
              <p className="mt-4 text-sm text-ink-400">
                Nothing yet. Once a commission settles, generate the statement for the year here.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {documents.map(document => (
                  <li key={document.taxYear} className="border-b border-paper-200 pb-3 last:border-0">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-ink-900">{document.taxYear}</p>
                        <p className="text-sm text-ink-400">
                          {money(document.grossCents)} across {document.payoutCount} payout
                          {document.payoutCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <button className="btn-ghost"
                              onClick={() => downloadFile(`/tax/documents/${document.taxYear}/pdf`, `${document.taxYear}-earnings.pdf`)}>
                        Statement
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-ink-400">
                      {document.reportable
                        ? `Above the ${money(document.thresholdCents)} reporting threshold, so expect a 1099-NEC.`
                        : `Below the ${money(document.thresholdCents)} reporting threshold for ${document.taxYear}.`}
                      {' '}Generated {shortDate(document.generatedAt)}.
                    </p>
                  </li>
                ))}
              </ul>
            )}

          <p className="mt-5 text-xs text-ink-400">
            These are the platform's own reconciled records, not filed returns, and reporting thresholds
            change. Check them against whatever you are sent, and take tax advice from someone qualified to
            give it.
          </p>
        </section>
      </div>
    </Page>
  );
}
