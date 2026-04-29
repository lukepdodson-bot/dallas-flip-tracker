import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import Filters from '../components/Filters';
import PropertyCard from '../components/PropertyCard';
import PropertyMap from '../components/PropertyMap';
import StatsBar from '../components/StatsBar';

const DEFAULT_FILTERS = {
  sale_types: [],
  property_types: [],
  zip_codes: [],
  cities: [],
  min_price: '',
  max_price: '',
  min_beds: '',
  min_baths: '',
  min_sqft: '',
  max_sqft: '',
  auction_date_from: '',
  auction_date_to: '',
  list_date_from: '',
  list_date_to: '',
  has_auction_date: '',
  sort_by: 'list_date',
  sort_dir: 'desc',
};

function buildParams(filters, page) {
  const p = new URLSearchParams();
  p.set('page', page);
  p.set('per_page', '50');
  if (filters.sale_types?.length)    p.set('sale_type', filters.sale_types.join(','));
  if (filters.property_types?.length) p.set('property_type', filters.property_types.join(','));
  if (filters.zip_codes?.length)     p.set('zip_code', filters.zip_codes.join(','));
  if (filters.cities?.length)        p.set('city', filters.cities.join(','));
  if (filters.min_price)  p.set('min_price', filters.min_price);
  if (filters.max_price)  p.set('max_price', filters.max_price);
  if (filters.min_beds)   p.set('min_beds', filters.min_beds);
  if (filters.min_baths)  p.set('min_baths', filters.min_baths);
  if (filters.min_sqft)   p.set('min_sqft', filters.min_sqft);
  if (filters.max_sqft)   p.set('max_sqft', filters.max_sqft);
  if (filters.auction_date_from) p.set('auction_date_from', filters.auction_date_from);
  if (filters.auction_date_to)   p.set('auction_date_to', filters.auction_date_to);
  if (filters.list_date_from)    p.set('list_date_from', filters.list_date_from);
  if (filters.list_date_to)      p.set('list_date_to', filters.list_date_to);
  if (filters.has_auction_date)  p.set('has_auction_date', filters.has_auction_date);
  if (filters.sort_by)  p.set('sort_by', filters.sort_by);
  if (filters.sort_dir) p.set('sort_dir', filters.sort_dir);
  return p.toString();
}

export default function Dashboard() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [view, setView] = useState('split'); // 'list' | 'map' | 'split'
  const [highlightedId, setHighlightedId] = useState(null);

  const handleFilterChange = useCallback((newFilters) => {
    setFilters(newFilters);
    setPage(1);
  }, []);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['properties', filters, page],
    queryFn: () =>
      api.get(`/api/properties?${buildParams(filters, page)}`).then(r => r.data),
    keepPreviousData: true,
  });

  // All map markers (separate query, no pagination)
  const mapQuery = buildParams(filters, 1).replace('per_page=50', 'per_page=500');
  const { data: mapData } = useQuery({
    queryKey: ['properties-map', filters],
    queryFn: () => api.get(`/api/properties/map`).then(r => r.data),
    staleTime: 2 * 60 * 1000,
  });

  const properties = data?.properties || [];
  const total = data?.total || 0;
  const pages = data?.pages || 1;

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      <StatsBar />
      <Filters
        filters={filters}
        onChange={handleFilterChange}
        onReset={() => { setFilters(DEFAULT_FILTERS); setPage(1); }}
      />

      {/* View toggle + count */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">
            {isLoading ? 'Loading...' : `${total.toLocaleString()} properties`}
            {isFetching && !isLoading && <span className="ml-2 text-gray-400 text-xs">Updating...</span>}
          </span>
        </div>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          {[
            { key: 'list', icon: '≡', label: 'List' },
            { key: 'split', icon: '⊞', label: 'Split' },
            { key: 'map', icon: '⊙', label: 'Map' },
          ].map(({ key, icon, label }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                view === key
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{icon}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex">
        {/* List pane */}
        {(view === 'list' || view === 'split') && (
          <div className={`${view === 'split' ? 'w-full lg:w-2/5 xl:w-1/3' : 'w-full'} overflow-y-auto bg-gray-50`}>
            {isLoading ? (
              <div className="p-8 text-center text-gray-400">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600 mx-auto mb-3" />
                Loading properties...
              </div>
            ) : properties.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <div className="text-4xl mb-3">🔍</div>
                <p className="font-medium">No properties match your filters</p>
                <p className="text-sm mt-1">Try broadening your search</p>
              </div>
            ) : (
              <>
                <div className={`p-3 grid gap-2 ${view === 'list' ? 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1'}`}>
                  {properties.map(p => (
                    view === 'split'
                      ? <PropertyCard key={p.id} property={p} compact onHighlight={setHighlightedId} />
                      : <PropertyCard key={p.id} property={p} onHighlight={setHighlightedId} />
                  ))}
                </div>

                {/* Pagination */}
                {pages > 1 && (
                  <div className="flex items-center justify-center gap-2 py-4 px-3">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-100"
                    >
                      ← Prev
                    </button>
                    <span className="text-sm text-gray-600">
                      Page {page} of {pages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(pages, p + 1))}
                      disabled={page >= pages}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-100"
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Map pane */}
        {(view === 'map' || view === 'split') && (
          <div className={`${view === 'split' ? 'hidden lg:block lg:flex-1' : 'flex-1'} relative`}>
            <PropertyMap
              markers={mapData || []}
              highlightedId={highlightedId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
