import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../api/client';
import PropertyCard from '../components/PropertyCard';

export default function SavedProperties() {
  const { data: saved = [], isLoading } = useQuery({
    queryKey: ['saved-properties'],
    queryFn: () => api.get('/api/properties/saved/list').then(r => r.data),
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600" />
    </div>
  );

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Saved Properties</h1>
          <p className="text-gray-500 text-sm mt-0.5">{saved.length} saved</p>
        </div>
        <Link to="/" className="text-sm text-brand-600 hover:underline">← Back to listings</Link>
      </div>

      {saved.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-5xl mb-4">☆</div>
          <p className="text-lg font-medium">No saved properties yet</p>
          <p className="text-sm mt-1">Save properties from the listings page to track them here.</p>
          <Link to="/" className="mt-4 inline-block px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700">
            Browse Listings
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {saved.map(p => (
            <div key={p.id}>
              <PropertyCard property={p} />
              {p.saved_notes && (
                <div className="mt-1 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-gray-700">
                  <span className="font-medium">Note:</span> {p.saved_notes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
