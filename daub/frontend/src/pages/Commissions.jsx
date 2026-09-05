import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money, shortDate } from '../api/client';
import { Page, Loading, ErrorNote, Empty, StateBadge } from '../components/ui';

const LENSES = [
  ['',             'Everything'],
  ['buyer',        'Commissioned by me'],
  ['painter',      'I am painting'],
  ['photographer', 'From my images'],
];

export default function Commissions() {
  const [role, setRole] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setRows(null);
    api.get('/commissions', { params: { role: role || undefined } })
      .then(({ data }) => setRows(data))
      .catch(err => setError(err.message));
  }, [role]);

  return (
    <Page title="Commissions" lede="Every deal you are a party to, whichever side of it you are on.">
      <div className="mb-6 flex flex-wrap gap-2">
        {LENSES.map(([value, label]) => (
          <button key={value} onClick={() => setRole(value)}
                  className={value === role ? 'btn-primary' : 'btn-ghost'}>
            {label}
          </button>
        ))}
      </div>

      <ErrorNote error={error} className="mb-4" />

      {!rows ? <Loading />
        : rows.length === 0 ? (
          <Empty title="Nothing here yet">
            <Link className="underline" to="/browse">Browse the library</Link> to commission a painting.
          </Empty>
        ) : (
          <div className="space-y-3">
            {rows.map(row => <Row key={row.id} row={row} />)}
          </div>
        )}
    </Page>
  );
}

function Row({ row }) {
  const yourLabel = row.role === 'buyer' ? 'You pay' : 'Your share';

  return (
    <Link to={`/commissions/${row.id}`} className="card flex items-center gap-4 p-4 transition hover:border-clay-400">
      <div className="h-16 w-20 shrink-0 overflow-hidden rounded bg-paper-200">
        {row.photo?.thumb_file && <img src={`/api/photos/${row.photo.id}/thumb`} alt="" className="h-full w-full object-cover" />}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg text-ink-900">{row.photo?.title || `Commission #${row.id}`}</p>
        <p className="text-sm text-ink-400">
          {row.painter?.name} - {row.medium || 'medium tbc'} - opened {shortDate(row.created_at)}
        </p>
      </div>

      <div className="text-right">
        <p className="text-sm font-medium text-ink-900">{money(row.yourCents)}</p>
        <p className="text-xs text-ink-400">{yourLabel}</p>
      </div>

      <StateBadge state={row.state} />
    </Link>
  );
}
