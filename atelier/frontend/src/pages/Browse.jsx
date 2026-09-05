import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money } from '../api/client';
import { Page, Loading, ErrorNote, Empty } from '../components/ui';

export default function Browse() {
  const [photos, setPhotos]   = useState(null);
  const [error, setError]     = useState(null);
  const [filters, setFilters] = useState({ q: '', orientation: '', shotForPainting: false });

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get('/photos', {
          params: {
            q: filters.q || undefined,
            orientation: filters.orientation || undefined,
            shotForPainting: filters.shotForPainting ? 1 : undefined,
          },
        });
        setPhotos(data);
      } catch (err) { setError(err.message); }
    }, 200);
    return () => clearTimeout(timer);
  }, [filters]);

  return (
    <Page
      title="The library"
      lede="Every image here is cleared for commission work. The photographer set the terms and the floor price
            themselves, and both travel with the image into the licence."
    >
      <div className="card mb-6 flex flex-wrap items-end gap-4 p-4">
        <div className="min-w-[14rem] flex-1">
          <label className="label" htmlFor="q">Search</label>
          <input id="q" className="input" placeholder="water, portrait, winter field"
                 value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="orientation">Orientation</label>
          <select id="orientation" className="input" value={filters.orientation}
                  onChange={e => setFilters({ ...filters, orientation: e.target.value })}>
            <option value="">Any</option>
            <option value="landscape">Landscape</option>
            <option value="portrait">Portrait</option>
            <option value="square">Square</option>
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-ink-600">
          <input type="checkbox" checked={filters.shotForPainting}
                 onChange={e => setFilters({ ...filters, shotForPainting: e.target.checked })} />
          Shot for painting
        </label>
      </div>

      <ErrorNote error={error} className="mb-4" />

      {!photos ? <Loading label="Loading the library" />
        : photos.length === 0 ? (
          <Empty title="Nothing matches that yet">Try clearing the filters.</Empty>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map(photo => <PhotoCard key={photo.id} photo={photo} />)}
          </div>
        )}
    </Page>
  );
}

function PhotoCard({ photo }) {
  const commission = photo.skus.find(sku => sku.sku === 'commission');

  return (
    <Link to={`/photos/${photo.id}`} className="card group overflow-hidden transition hover:border-clay-400">
      <div className="aspect-[4/3] overflow-hidden bg-paper-200">
        {photo.thumbUrl && (
          <img src={photo.thumbUrl} alt={photo.title} loading="lazy"
               className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg leading-snug text-ink-900">{photo.title}</h2>
          {photo.shotForPainting && (
            <span className="shrink-0 rounded-full bg-clay-100 px-2 py-0.5 text-[11px] text-clay-600">
              for painting
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-ink-400">{photo.photographer?.name}</p>
        {commission?.floorPriceCents > 0 && (
          <p className="mt-3 text-xs text-ink-400">
            Photographer's floor {money(commission.floorPriceCents)}
          </p>
        )}
      </div>
    </Link>
  );
}
