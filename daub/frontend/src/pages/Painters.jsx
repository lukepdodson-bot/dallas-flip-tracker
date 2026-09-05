import { useEffect, useState } from 'react';
import { api, money } from '../api/client';
import { Page, Loading, ErrorNote, Empty } from '../components/ui';

export default function Painters() {
  const [painters, setPainters] = useState(null);
  const [error, setError]       = useState(null);

  useEffect(() => {
    api.get('/painters').then(({ data }) => setPainters(data)).catch(err => setError(err.message));
  }, []);

  return (
    <Page
      title="Painters"
      lede="Price ranges are what the buyer pays. What the painter takes home after the photographer's share
            and the platform fee is shown on every quote before anyone commits."
    >
      <ErrorNote error={error} className="mb-4" />
      {!painters ? <Loading />
        : painters.length === 0 ? <Empty title="No painters have published a profile yet" />
        : (
          <div className="grid gap-5 md:grid-cols-2">
            {painters.map(painter => <PainterCard key={painter.id} painter={painter} />)}
          </div>
        )}
    </Page>
  );
}

export function PainterCard({ painter, footer }) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-ink-900">{painter.name}</h2>
          {painter.location && <p className="text-sm text-ink-400">{painter.location}</p>}
        </div>
        {!painter.accepting && (
          <span className="rounded-full bg-paper-200 px-2 py-0.5 text-xs text-ink-400">Not taking work</span>
        )}
      </div>

      {painter.bio && <p className="mt-3 text-sm text-ink-600">{painter.bio}</p>}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Fact label="Medium" value={painter.mediums.join(', ') || '--'} />
        <Fact label="From" value={money(painter.minPriceCents)} />
        <Fact label="Up to" value={painter.maxPriceCents ? money(painter.maxPriceCents) : 'open'} />
        <Fact label="Turnaround" value={`${painter.turnaroundDays} days`} />
      </dl>

      {painter.completed > 0 && (
        <p className="mt-3 text-xs text-ink-400">
          {painter.completed} commission{painter.completed === 1 ? '' : 's'} settled through the platform
        </p>
      )}
      {footer}
    </div>
  );
}

function Fact({ label, value }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="mt-0.5 text-ink-800">{value}</dd>
    </div>
  );
}
