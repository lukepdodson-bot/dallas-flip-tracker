import { money } from '../api/client';

/** One consistent place for the "we are working / it broke / nothing here" trio. */
export function Loading({ label = 'Loading' }) {
  return <p className="py-16 text-center text-sm text-ink-400">{label}...</p>;
}

export function ErrorNote({ error, className = '' }) {
  if (!error) return null;
  return (
    <p className={`rounded-md border border-clay-400/40 bg-clay-100 px-3 py-2 text-sm text-clay-600 ${className}`}>
      {typeof error === 'string' ? error : error.message}
    </p>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="card px-6 py-14 text-center">
      <p className="font-display text-lg text-ink-600">{title}</p>
      {children && <div className="mt-2 text-sm text-ink-400">{children}</div>}
    </div>
  );
}

export function Page({ title, lede, actions, children }) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      {(title || actions) && (
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            {title && <h1 className="font-display text-3xl text-ink-900">{title}</h1>}
            {lede && <p className="mt-1 max-w-2xl text-sm text-ink-400">{lede}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </div>
  );
}

const STATE_TONE = {
  quoted: 'bg-paper-200 text-ink-600',
  awaiting_payment: 'bg-amber-100 text-amber-800',
  funded: 'bg-sky-100 text-sky-800',
  active: 'bg-emerald-100 text-emerald-800',
  delivered: 'bg-indigo-100 text-indigo-800',
  disputed: 'bg-rose-100 text-rose-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  settled: 'bg-ink-800 text-paper-50',
  cancelled: 'bg-paper-200 text-ink-400',
  refunded: 'bg-paper-200 text-ink-400',
};

export function StateBadge({ state, label }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATE_TONE[state] || 'bg-paper-200 text-ink-600'}`}>
      {label || String(state).replace(/_/g, ' ')}
    </span>
  );
}

/**
 * The split, shown the same way everywhere. A painter should never have to work
 * out what they are actually being paid.
 */
export function SplitTable({ quote, highlight }) {
  const rows = [
    ['Painter',      quote.painterCents      ?? quote.painter_cents,      'painter'],
    ['Photographer', quote.photographerCents ?? quote.photographer_cents, 'photographer'],
    ['Platform fee', quote.platformCents     ?? quote.platform_cents,     'platform'],
  ];
  const total = quote.priceCents ?? quote.price_cents;

  return (
    <dl className="text-sm">
      {rows.map(([label, cents, key]) => (
        <div key={label}
             className={`flex justify-between border-b border-paper-200 py-2 ${highlight === key ? 'font-medium text-ink-900' : 'text-ink-600'}`}>
          <dt>{label}{highlight === key && ' (you)'}</dt>
          <dd>{money(cents)}</dd>
        </div>
      ))}
      <div className="flex justify-between pt-2 font-medium text-ink-900">
        <dt>Buyer pays</dt>
        <dd>{money(total)}</dd>
      </div>
      {quote.floorApplied && (
        <p className="mt-2 text-xs text-ink-400">
          The photographer's floor price on this image is above their percentage, so it applies instead.
        </p>
      )}
    </dl>
  );
}
