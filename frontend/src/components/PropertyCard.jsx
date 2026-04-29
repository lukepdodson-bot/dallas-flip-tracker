import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';

const SALE_TYPE_COLORS = {
  'Foreclosure': 'bg-red-100 text-red-800',
  'REO':         'bg-orange-100 text-orange-800',
  'Tax Sale':    'bg-purple-100 text-purple-800',
  'Short Sale':  'bg-yellow-100 text-yellow-800',
  'HUD':         'bg-blue-100 text-blue-800',
  'Probate':     'bg-gray-100 text-gray-700',
};

const STATUS_COLORS = {
  'Active':  'bg-green-100 text-green-800',
  'Pending': 'bg-yellow-100 text-yellow-800',
  'Sold':    'bg-gray-100 text-gray-600',
};

function fmtPrice(p) {
  if (!p) return 'Price N/A';
  if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(1)}M`;
  if (p >= 1000) return `$${Math.round(p / 1000)}K`;
  return `$${p.toLocaleString()}`;
}

function fmtDate(d) {
  if (!d) return null;
  try {
    return formatDistanceToNow(new Date(d + 'T12:00:00'), { addSuffix: true });
  } catch {
    return d;
  }
}

export default function PropertyCard({ property, compact = false, onHighlight }) {
  const saleColor = SALE_TYPE_COLORS[property.sale_type] || 'bg-gray-100 text-gray-700';
  const statusColor = STATUS_COLORS[property.status] || 'bg-gray-100 text-gray-600';

  const discount = property.price && property.estimated_value
    ? Math.round((1 - property.price / property.estimated_value) * 100)
    : null;

  if (compact) {
    return (
      <Link
        to={`/property/${property.id}`}
        onMouseEnter={() => onHighlight?.(property.id)}
        onMouseLeave={() => onHighlight?.(null)}
        className="block bg-white border border-gray-200 rounded-lg p-3 hover:border-brand-400 hover:shadow-md transition-all"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{property.address}</p>
            <p className="text-xs text-gray-500">{property.city}, TX {property.zip_code}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-base font-bold text-brand-700">{fmtPrice(property.price)}</p>
            {discount > 0 && (
              <p className="text-xs font-medium text-green-600">{discount}% below est.</p>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${saleColor}`}>
            {property.sale_type}
          </span>
          {property.bedrooms && (
            <span className="text-xs text-gray-500">{property.bedrooms}bd</span>
          )}
          {property.bathrooms && (
            <span className="text-xs text-gray-500">{property.bathrooms}ba</span>
          )}
          {property.sqft && (
            <span className="text-xs text-gray-500">{property.sqft?.toLocaleString()} sqft</span>
          )}
          {property.auction_date && (
            <span className="text-xs text-red-600 font-medium ml-auto">
              Auction {fmtDate(property.auction_date)}
            </span>
          )}
        </div>
      </Link>
    );
  }

  return (
    <Link
      to={`/property/${property.id}`}
      onMouseEnter={() => onHighlight?.(property.id)}
      onMouseLeave={() => onHighlight?.(null)}
      className="block bg-white rounded-xl border border-gray-200 hover:border-brand-400 hover:shadow-lg transition-all overflow-hidden"
    >
      {/* Image placeholder */}
      <div className="h-40 bg-gradient-to-br from-gray-100 to-gray-200 relative flex items-center justify-center">
        <span className="text-5xl opacity-30">🏠</span>
        {/* Badges */}
        <div className="absolute top-2 left-2 flex gap-1 flex-wrap">
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${saleColor}`}>
            {property.sale_type}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusColor}`}>
            {property.status}
          </span>
        </div>
        {discount > 0 && (
          <div className="absolute top-2 right-2 bg-green-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
            -{discount}%
          </div>
        )}
      </div>

      <div className="p-4">
        {/* Price */}
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-2xl font-bold text-brand-700">{fmtPrice(property.price)}</span>
          {property.estimated_value && (
            <span className="text-sm text-gray-400 line-through">{fmtPrice(property.estimated_value)}</span>
          )}
        </div>

        {/* Address */}
        <p className="text-sm font-semibold text-gray-900 truncate">{property.address}</p>
        <p className="text-xs text-gray-500 mb-2">{property.city}, TX {property.zip_code}</p>

        {/* Details row */}
        <div className="flex items-center gap-3 text-sm text-gray-600 mb-3">
          {property.bedrooms && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 4a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V4z"/>
              </svg>
              {property.bedrooms} bd
            </span>
          )}
          {property.bathrooms && (
            <span>{property.bathrooms} ba</span>
          )}
          {property.sqft && (
            <span>{property.sqft?.toLocaleString()} ft²</span>
          )}
          {property.year_built && (
            <span className="text-gray-400">{property.year_built}</span>
          )}
        </div>

        {/* Bottom row */}
        <div className="flex items-center justify-between text-xs text-gray-400 border-t pt-2">
          <div>
            {property.auction_date ? (
              <span className="text-red-600 font-semibold">
                Auction: {new Date(property.auction_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            ) : (
              <span>Listed {fmtDate(property.list_date)}</span>
            )}
          </div>
          <span className="truncate max-w-[100px]">{property.source}</span>
        </div>
      </div>
    </Link>
  );
}
