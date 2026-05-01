import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import api from '../api/client';

const SALE_TYPE_COLORS = {
  'Foreclosure': 'bg-red-100 text-red-800 border-red-200',
  'REO':         'bg-orange-100 text-orange-800 border-orange-200',
  'Tax Sale':    'bg-purple-100 text-purple-800 border-purple-200',
  'Short Sale':  'bg-yellow-100 text-yellow-800 border-yellow-200',
  'HUD':         'bg-blue-100 text-blue-800 border-blue-200',
  'Probate':     'bg-gray-100 text-gray-700 border-gray-200',
};

function DetailRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900 text-right max-w-[60%]">{value}</span>
    </div>
  );
}

function fmtCurrency(v) {
  if (!v) return null;
  return `$${v.toLocaleString()}`;
}

function fmtDate(d) {
  if (!d) return null;
  try {
    const date = new Date(d + 'T12:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return d; }
}

export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);

  const { data: property, isLoading, error } = useQuery({
    queryKey: ['property', id],
    queryFn: () => api.get(`/api/properties/${id}`).then(r => {
      setNotes(r.data.saved_notes || '');
      return r.data;
    }),
  });

  const saveMutation = useMutation({
    mutationFn: (notes) => api.post(`/api/properties/${id}/save`, { notes }).then(r => r.data),
    onSuccess: (data) => {
      queryClient.setQueryData(['property', id], old => ({ ...old, saved: data.saved }));
      queryClient.invalidateQueries(['properties']);
    },
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600" />
    </div>
  );

  if (error || !property) return (
    <div className="max-w-2xl mx-auto p-8 text-center">
      <p className="text-gray-500">Property not found.</p>
      <Link to="/" className="text-brand-600 hover:underline mt-2 block">← Back to listings</Link>
    </div>
  );

  const saleColor = SALE_TYPE_COLORS[property.sale_type] || 'bg-gray-100 text-gray-700';
  const discount = property.price && property.estimated_value
    ? Math.round((1 - property.price / property.estimated_value) * 100)
    : null;

  const daysOnMarket = property.list_date
    ? Math.floor((new Date() - new Date(property.list_date + 'T12:00:00')) / 86400000)
    : null;

  const isUpcomingAuction = property.auction_date && new Date(property.auction_date + 'T12:00:00') > new Date();
  const auctionDaysOut = property.auction_date
    ? Math.ceil((new Date(property.auction_date + 'T12:00:00') - new Date()) / 86400000)
    : null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Back button */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600 mb-4">
        ← Back to listings
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - main info */}
        <div className="lg:col-span-2 space-y-4">
          {/* Header card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <div className="flex flex-wrap gap-2 mb-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${saleColor}`}>
                    {property.sale_type}
                  </span>
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${
                    property.status === 'Active' ? 'bg-green-100 text-green-800 border-green-200' :
                    property.status === 'Pending' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
                    'bg-gray-100 text-gray-700 border-gray-200'
                  }`}>
                    {property.status}
                  </span>
                </div>
                <h1 className="text-xl font-bold text-gray-900">{property.address}</h1>
                <p className="text-gray-500">{property.city}, TX {property.zip_code} &bull; {property.county} County</p>

                {/* Owner info — public record from DCAD + skip trace */}
                {(property.owner_name || property.owner_mailing_address || property.owner_phone || property.owner_email) && (
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                    <p className="font-semibold text-amber-900 mb-1">Owner of Record</p>
                    {property.owner_name && (
                      <p className="text-amber-900"><span className="text-amber-700">Name:</span> {property.owner_name}</p>
                    )}
                    {property.owner_mailing_address && property.owner_mailing_address !== `${property.address}, ${property.city}, TX ${property.zip_code || ''}`.trim() && (
                      <p className="text-amber-900"><span className="text-amber-700">Mailing:</span> {property.owner_mailing_address}</p>
                    )}
                    {property.owner_phone && (
                      <p className="text-amber-900">
                        <span className="text-amber-700">Phone:</span>{' '}
                        <a href={`tel:${property.owner_phone}`} className="underline hover:text-amber-700">{property.owner_phone}</a>
                      </p>
                    )}
                    {property.owner_email && (
                      <p className="text-amber-900">
                        <span className="text-amber-700">Email:</span>{' '}
                        <a href={`mailto:${property.owner_email}`} className="underline hover:text-amber-700">{property.owner_email}</a>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Save button */}
              <button
                onClick={() => {
                  if (property.saved) {
                    saveMutation.mutate(null);
                  } else {
                    setShowNotes(true);
                    saveMutation.mutate(notes);
                  }
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-medium text-sm transition-colors ${
                  property.saved
                    ? 'bg-yellow-50 border-yellow-300 text-yellow-700 hover:bg-yellow-100'
                    : 'bg-white border-gray-300 text-gray-600 hover:border-brand-400 hover:text-brand-600'
                }`}
              >
                {property.saved ? '★ Saved' : '☆ Save'}
              </button>
            </div>

            {/* Price block */}
            <div className="flex flex-wrap items-baseline gap-4 py-4 border-t border-b border-gray-100 mb-4">
              <div>
                <p className="text-3xl font-bold text-brand-700">{fmtCurrency(property.price) || 'Price N/A'}</p>
                {property.price && property.sqft && (
                  <p className="text-sm text-gray-400">${Math.round(property.price / property.sqft)}/sqft</p>
                )}
              </div>
              {property.estimated_value && (
                <div>
                  <p className="text-lg text-gray-400 line-through">{fmtCurrency(property.estimated_value)}</p>
                  <p className="text-sm text-gray-500">Est. value</p>
                </div>
              )}
              {discount > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  <p className="text-2xl font-bold text-green-600">{discount}%</p>
                  <p className="text-xs text-green-600">below est. value</p>
                </div>
              )}
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Beds', value: property.bedrooms ? `${property.bedrooms} bd` : null },
                { label: 'Baths', value: property.bathrooms ? `${property.bathrooms} ba` : null },
                { label: 'Sq Ft', value: property.sqft ? property.sqft.toLocaleString() : null },
                { label: 'Year Built', value: property.year_built },
              ].map(({ label, value }) => value ? (
                <div key={label} className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-gray-900">{value}</p>
                  <p className="text-xs text-gray-500">{label}</p>
                </div>
              ) : null)}
            </div>
          </div>

          {/* Auction alert */}
          {isUpcomingAuction && (
            <div className={`rounded-xl border-2 p-4 flex items-start gap-3 ${
              auctionDaysOut <= 7 ? 'bg-red-50 border-red-400' : 'bg-orange-50 border-orange-300'
            }`}>
              <span className="text-2xl">⚠️</span>
              <div>
                <p className={`font-bold ${auctionDaysOut <= 7 ? 'text-red-800' : 'text-orange-800'}`}>
                  Auction in {auctionDaysOut} day{auctionDaysOut !== 1 ? 's' : ''}
                </p>
                <p className={`text-sm ${auctionDaysOut <= 7 ? 'text-red-600' : 'text-orange-700'}`}>
                  {fmtDate(property.auction_date)}
                  {property.sale_type === 'Foreclosure' && ' — Dallas County Courthouse, 600 Commerce St, Dallas TX. Cash only.'}
                </p>
              </div>
            </div>
          )}

          {/* Description */}
          {property.description && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="font-semibold text-gray-900 mb-2">Description</h2>
              <p className="text-sm text-gray-600 leading-relaxed">{property.description}</p>
            </div>
          )}

          {/* Notes */}
          {(property.saved || showNotes) && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="font-semibold text-gray-900 mb-2">Your Notes</h2>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Add notes about this property (rehab estimates, drive-by notes, etc.)"
                className="w-full h-28 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
              />
              <button
                onClick={() => saveMutation.mutate(notes)}
                className="mt-2 px-4 py-1.5 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700"
              >
                Save notes
              </button>
            </div>
          )}
        </div>

        {/* Right column - details */}
        <div className="space-y-4">
          {/* Property details */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Property Details</h2>
            <DetailRow label="Property Type" value={property.property_type} />
            <DetailRow label="Lot Size" value={property.lot_size_sqft ? `${property.lot_size_sqft.toLocaleString()} sqft` : null} />
            <DetailRow label="Year Built" value={property.year_built} />
            <DetailRow label="County" value={`${property.county} County`} />
            <DetailRow label="Zip Code" value={property.zip_code} />
            <DetailRow label="Days on Market" value={daysOnMarket !== null ? `${daysOnMarket} days` : null} />
          </div>

          {/* Sale details */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Sale Details</h2>
            <DetailRow label="Sale Type" value={property.sale_type} />
            <DetailRow label="Status" value={property.status} />
            <DetailRow label="List Date" value={fmtDate(property.list_date)} />
            <DetailRow label="Auction Date" value={property.auction_date ? fmtDate(property.auction_date) : null} />
            <DetailRow label="Case Number" value={property.case_number} />
            <DetailRow label="Lender" value={property.lender} />
            <DetailRow label="Trustee" value={property.trustee} />
            <DetailRow label="Source" value={property.source} />
          </div>

          {/* Links */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Quick Links</h2>
            <div className="space-y-2">
              {property.source_url && (
                <a
                  href={property.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-brand-600 hover:text-brand-800 hover:underline"
                >
                  → Home Link
                </a>
              )}
              <a
                href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${property.lat},${property.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-brand-600 hover:text-brand-800 hover:underline"
              >
                → Google Street View
              </a>
              <a
                href={`https://www.zillow.com/homes/${encodeURIComponent(property.address + ', ' + property.city + ', TX')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-brand-600 hover:text-brand-800 hover:underline"
              >
                → Zillow Comps
              </a>
            </div>
          </div>

          {/* Potential ROI estimate */}
          {property.price && property.estimated_value && property.price < property.estimated_value && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-5">
              <h2 className="font-semibold text-green-900 mb-3">Rough Flip Estimate</h2>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-green-700">Purchase price</span>
                  <span className="font-medium text-green-900">{fmtCurrency(property.price)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-green-700">Estimated ARV</span>
                  <span className="font-medium text-green-900">{fmtCurrency(property.estimated_value)}</span>
                </div>
                <div className="flex justify-between text-xs text-green-600 border-t border-green-200 pt-1 mt-1">
                  <span>Spread (before rehab)</span>
                  <span className="font-bold">{fmtCurrency(property.estimated_value - property.price)}</span>
                </div>
                <p className="text-xs text-green-600 mt-2">
                  * Estimated value from listing source. Always verify with your own comps before bidding.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
