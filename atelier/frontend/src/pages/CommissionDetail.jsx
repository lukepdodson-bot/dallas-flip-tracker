import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, money, shortDate, downloadFile } from '../api/client';
import { Page, Loading, ErrorNote, StateBadge, SplitTable } from '../components/ui';

export default function CommissionDetail() {
  const { id } = useParams();
  const [commission, setCommission] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/commissions/${id}`);
      setCommission(data);
    } catch (err) { setError(err.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (error && !commission) return <Page><ErrorNote error={error} /></Page>;
  if (!commission) return <Loading />;

  return (
    <Page>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-ink-400">Commission #{commission.id}</p>
          <h1 className="mt-1 font-display text-3xl text-ink-900">{commission.photo?.title}</h1>
          <p className="mt-1 text-ink-400">
            {commission.painter?.name} painting after {commission.photographer?.name}
            {commission.medium && ` - ${commission.medium}`}{commission.size && `, ${commission.size}`}
          </p>
        </div>
        <StateBadge state={commission.state} label={commission.stateLabel} />
      </header>

      <div className="grid gap-8 lg:grid-cols-[1.4fr,1fr]">
        <div className="space-y-6">
          <Licence commission={commission} onChange={load} />
          <Actions commission={commission} onChange={load} />
          <Milestones commission={commission} onChange={load} />
          <Timeline events={commission.events} />
        </div>

        <div className="space-y-6">
          <div className="card overflow-hidden">
            {commission.photo?.display_file && (
              <img src={`/api/photos/${commission.photo.id}/display`} alt={commission.photo.title} className="w-full" />
            )}
          </div>

          <section className="card p-5">
            <h2 className="mb-3 font-display text-lg text-ink-900">The money</h2>
            <SplitTable quote={commission} highlight={commission.role} />
            <p className="mt-3 text-xs text-ink-400">
              {commission.escrow_state === 'held' && 'Held in escrow. Nothing is released until the buyer confirms delivery.'}
              {commission.escrow_state === 'released' && 'Released and split.'}
              {commission.escrow_state === 'refunded' && 'Refunded to the buyer in full.'}
              {commission.escrow_state === 'none' && 'Not yet funded.'}
            </p>
            {commission.payouts?.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-ink-400">
                {commission.payouts.map(payout => (
                  <li key={payout.party} className="flex justify-between">
                    <span>{payout.party}</span>
                    <span className={payout.state === 'failed' ? 'text-clay-600' : ''}>{payout.state}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {commission.certificateId && (
            <section className="card p-5">
              <h2 className="font-display text-lg text-ink-900">Certificate of authenticity</h2>
              <p className="mt-2 text-sm text-ink-600">
                Signed and permanent, naming both creators and the licence. Anyone you show it to can check
                it without an account.
              </p>
              <p className="mt-3 font-mono text-sm text-ink-800">{commission.certificateId}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link className="btn-primary" to={`/verify/${commission.certificateId}`}>Verify it</Link>
                <a className="btn-ghost" href={`/api/registry/${commission.certificateId}/certificate.pdf`}
                   target="_blank" rel="noreferrer">Certificate PDF</a>
              </div>
            </section>
          )}
        </div>
      </div>
    </Page>
  );
}

// ── The licence ──────────────────────────────────────────────────────────────

function Licence({ commission, onChange }) {
  const [typedName, setTypedName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy]   = useState(false);

  const licence = commission.license;
  if (!licence) {
    return (
      <section className="card p-5">
        <h2 className="font-display text-lg text-ink-900">Licence</h2>
        <p className="mt-2 text-sm text-ink-600">
          The licence is issued the moment the payment is held, so the paperwork always exists before
          anyone starts work.
        </p>
      </section>
    );
  }

  const signedParties = licence.signatures.map(signature => signature.party);
  const youOwe = licence.outstanding.includes(commission.role);

  async function sign(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/commissions/${commission.id}/sign`, { typedName });
      setTypedName('');
      await onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg text-ink-900">{licence.number}</h2>
          <p className="text-sm text-ink-400">
            Single-use: one painting, one buyer, no reproduction rights, copyright retained by the photographer.
          </p>
        </div>
        <StateBadge state={licence.executed ? 'settled' : 'awaiting_payment'}
                    label={licence.executed ? 'Executed' : 'Awaiting signature'} />
      </div>

      <ul className="mt-4 space-y-2 text-sm">
        {['photographer', 'painter', 'buyer'].map(party => {
          const signature = licence.signatures.find(s => s.party === party);
          return (
            <li key={party} className="flex items-center justify-between border-b border-paper-200 pb-2">
              <span className="capitalize text-ink-600">{party}</span>
              <span className={signature ? 'text-ink-800' : 'text-ink-400'}>
                {signature ? `${signature.typed_name} - ${shortDate(signature.signed_at)}` : 'not yet signed'}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-ghost"
                onClick={() => downloadFile(`/commissions/${commission.id}/license.pdf`, `${licence.number}.pdf`)}>
          Read the licence
        </button>

        {commission.role === 'painter' && licence.executed && commission.state === 'active' && (
          <button className="btn-accent"
                  onClick={() => downloadFile(`/photos/${commission.photo.id}/licensed`, `${licence.number}-reference`)}>
            Download the full-resolution file
          </button>
        )}
      </div>

      {commission.role === 'painter' && licence.executed && (
        <p className="mt-3 text-xs text-ink-400">
          Each download carries an identifier tied to your account. There is no visible watermark - you get
          the file clean.
        </p>
      )}

      {youOwe && (
        <form onSubmit={sign} className="mt-5 rounded-md bg-paper-100 p-4">
          <label className="label" htmlFor="typedName">Sign as {commission.role} - type your full legal name</label>
          <input id="typedName" className="input" value={typedName} required minLength={2}
                 onChange={e => setTypedName(e.target.value)} />
          <ErrorNote error={error} className="mt-3" />
          <button className="btn-primary mt-3" disabled={busy}>{busy ? 'Signing' : 'Sign the licence'}</button>
          <p className="mt-2 text-xs text-ink-400">
            Read it first. Typing your name is an electronic signature, and what is recorded is your name,
            the time, and the hash of the exact terms you signed.
          </p>
        </form>
      )}

      {!youOwe && !licence.executed && (
        <p className="mt-4 text-sm text-ink-400">
          Waiting on the {licence.outstanding.join(' and the ')}. Work starts when everyone has signed.
        </p>
      )}
    </section>
  );
}

// ── What this person can do next ─────────────────────────────────────────────

const ACTION_COPY = {
  deliver: ['Mark as delivered', 'Tell the buyer the painting is done and on its way.'],
  accept:  ['Confirm delivery', 'Releases the money and issues the certificate. Do this once the painting is in your hands.'],
  dispute: ['Raise an issue', 'Holds the money while it is sorted out.'],
  cancel:  ['Cancel', 'Ends the commission before any money moves.'],
  refund:  ['Refund the buyer', 'Returns the payment in full and voids the licence.'],
};

function Actions({ commission, onChange }) {
  const [busy, setBusy]   = useState(null);
  const [note, setNote]   = useState('');
  const [error, setError] = useState(null);

  const actions = commission.availableActions.filter(action => ACTION_COPY[action]);
  if (!actions.length) return null;

  async function run(action) {
    setBusy(action);
    setError(null);
    try {
      await api.post(`/commissions/${commission.id}/${action}`, { note, reason: note });
      setNote('');
      await onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const needsNote = actions.some(action => ['deliver', 'dispute', 'cancel', 'refund'].includes(action));

  return (
    <section className="card p-5">
      <h2 className="font-display text-lg text-ink-900">Your move</h2>

      {commission.state === 'delivered' && commission.role === 'buyer' && commission.auto_accept_at && (
        <p className="mt-2 text-sm text-ink-600">
          If you do nothing, this is accepted automatically on {shortDate(commission.auto_accept_at)} and the
          money is released. Raise an issue before then if something is wrong.
        </p>
      )}

      {needsNote && (
        <div className="mt-4">
          <label className="label" htmlFor="note">A note (optional)</label>
          <textarea id="note" className="input" rows={2} value={note} onChange={e => setNote(e.target.value)} />
        </div>
      )}

      <ErrorNote error={error} className="mt-3" />

      <div className="mt-4 space-y-3">
        {actions.map(action => {
          const [label, description] = ACTION_COPY[action];
          return (
            <div key={action} className="flex items-start justify-between gap-4">
              <p className="text-sm text-ink-600">{description}</p>
              <button className={action === 'accept' ? 'btn-accent shrink-0' : 'btn-ghost shrink-0'}
                      disabled={Boolean(busy)} onClick={() => run(action)}>
                {busy === action ? 'Working' : label}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Progress and history ─────────────────────────────────────────────────────

function Milestones({ commission, onChange }) {
  if (!commission.milestones?.length) return null;
  const isPainter = commission.role === 'painter';

  async function toggle(milestone) {
    await api.patch(`/commissions/${commission.id}/milestones/${milestone.id}`,
      { complete: milestone.state !== 'complete' });
    await onChange();
  }

  return (
    <section className="card p-5">
      <h2 className="mb-3 font-display text-lg text-ink-900">Progress</h2>
      <ol className="space-y-2">
        {commission.milestones.map(milestone => (
          <li key={milestone.id} className="flex items-center justify-between border-b border-paper-200 pb-2 text-sm last:border-0">
            <span className={milestone.state === 'complete' ? 'text-ink-800' : 'text-ink-400'}>
              {milestone.state === 'complete' ? '●' : '○'} {milestone.label}
              {milestone.note && <span className="ml-2 text-ink-400">- {milestone.note}</span>}
            </span>
            {isPainter && !['settled', 'refunded', 'cancelled'].includes(commission.state) && (
              <button className="text-xs text-clay-600 underline" onClick={() => toggle(milestone)}>
                {milestone.state === 'complete' ? 'reopen' : 'mark done'}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Timeline({ events }) {
  if (!events?.length) return null;
  return (
    <section className="card p-5">
      <h2 className="mb-3 font-display text-lg text-ink-900">History</h2>
      <ol className="space-y-3">
        {events.map(event => (
          <li key={event.id} className="border-l-2 border-paper-200 pl-4 text-sm">
            <p className="text-ink-800">{event.note || `${event.from_state} to ${event.to_state}`}</p>
            <p className="text-xs text-ink-400">
              {shortDate(event.created_at)}{event.actor_role && ` - ${event.actor_role}`}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
