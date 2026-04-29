import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';

const SALE_TYPES = ['Foreclosure', 'REO', 'Tax Sale', 'Short Sale', 'HUD', 'Probate'];
const PROPERTY_TYPES = ['SFR', 'Condo', 'Multi-Family', 'Land', 'Commercial'];

function MultiSelect({ label, options, value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
        {label}
      </label>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const selected = value.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(
                selected ? value.filter(v => v !== opt) : [...value, opt]
              )}
              className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                selected
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-brand-400'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Filters({ filters, onChange, onReset }) {
  const [expanded, setExpanded] = useState(false);

  const { data: opts } = useQuery({
    queryKey: ['filter-options'],
    queryFn: () => api.get('/api/properties/filter-options').then(r => r.data),
    staleTime: 10 * 60 * 1000,
  });

  const zipCodes = opts?.zip_codes || [];
  const cities = opts?.cities || [];

  const set = (key, val) => onChange({ ...filters, [key]: val });
  const setNum = (key, val) => onChange({ ...filters, [key]: val === '' ? '' : val });

  const activeCount = [
    filters.sale_types?.length,
    filters.property_types?.length,
    filters.zip_codes?.length,
    filters.cities?.length,
    filters.min_price || filters.max_price,
    filters.min_beds,
    filters.min_baths,
    filters.min_sqft || filters.max_sqft,
    filters.auction_date_from || filters.auction_date_to,
    filters.list_date_from || filters.list_date_to,
    filters.has_auction_date !== '',
  ].filter(Boolean).length;

  return (
    <div className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-screen-2xl mx-auto px-4 py-3">
        {/* Top row - always visible */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Sale type quick filter */}
          <div className="flex-1 min-w-0">
            <MultiSelect
              label="Sale Type"
              options={SALE_TYPES}
              value={filters.sale_types || []}
              onChange={(v) => set('sale_types', v)}
            />
          </div>

          {/* Price range */}
          <div className="flex items-center gap-1 shrink-0">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Price</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  placeholder="Min"
                  value={filters.min_price || ''}
                  onChange={e => setNum('min_price', e.target.value)}
                  className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                <span className="text-gray-400 text-xs">–</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={filters.max_price || ''}
                  onChange={e => setNum('max_price', e.target.value)}
                  className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>
          </div>

          {/* Beds / Baths */}
          <div className="shrink-0">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Beds / Baths</label>
            <div className="flex gap-1">
              <select
                value={filters.min_beds || ''}
                onChange={e => set('min_beds', e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">Beds</option>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}+</option>)}
              </select>
              <select
                value={filters.min_baths || ''}
                onChange={e => set('min_baths', e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">Baths</option>
                {[1, 1.5, 2, 2.5, 3].map(n => <option key={n} value={n}>{n}+</option>)}
              </select>
            </div>
          </div>

          {/* Toggle more filters */}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded border text-sm font-medium transition-colors ${
              expanded || activeCount > 3
                ? 'border-brand-500 text-brand-700 bg-brand-50'
                : 'border-gray-300 text-gray-600 hover:border-gray-400'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 010 2H4a1 1 0 01-1-1zm3 6a1 1 0 011-1h10a1 1 0 010 2H7a1 1 0 01-1-1zm3 6a1 1 0 011-1h4a1 1 0 010 2h-4a1 1 0 01-1-1z" />
            </svg>
            More {activeCount > 0 ? `(${activeCount})` : ''}
          </button>

          {activeCount > 0 && (
            <button
              type="button"
              onClick={onReset}
              className="shrink-0 text-sm text-red-500 hover:text-red-700 font-medium"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Expanded filters */}
        {expanded && (
          <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">

            {/* Property type */}
            <MultiSelect
              label="Property Type"
              options={PROPERTY_TYPES}
              value={filters.property_types || []}
              onChange={(v) => set('property_types', v)}
            />

            {/* Zip code */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Zip Code
              </label>
              <select
                multiple
                value={filters.zip_codes || []}
                onChange={e => set('zip_codes', Array.from(e.target.selectedOptions, o => o.value))}
                className="w-full h-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {zipCodes.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
              <p className="text-xs text-gray-400 mt-0.5">Cmd/Ctrl+click multi-select</p>
            </div>

            {/* City */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                City
              </label>
              <select
                multiple
                value={filters.cities || []}
                onChange={e => set('cities', Array.from(e.target.selectedOptions, o => o.value))}
                className="w-full h-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {cities.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Sq footage */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Sq Footage
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  placeholder="Min"
                  value={filters.min_sqft || ''}
                  onChange={e => setNum('min_sqft', e.target.value)}
                  className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                <span className="text-gray-400 text-xs">–</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={filters.max_sqft || ''}
                  onChange={e => setNum('max_sqft', e.target.value)}
                  className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>

            {/* Auction date */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Auction Date
              </label>
              <div className="space-y-1">
                <input
                  type="date"
                  value={filters.auction_date_from || ''}
                  onChange={e => set('auction_date_from', e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                <input
                  type="date"
                  value={filters.auction_date_to || ''}
                  onChange={e => set('auction_date_to', e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>

            {/* List date */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Date Listed
              </label>
              <div className="space-y-1">
                <input
                  type="date"
                  value={filters.list_date_from || ''}
                  onChange={e => set('list_date_from', e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                <input
                  type="date"
                  value={filters.list_date_to || ''}
                  onChange={e => set('list_date_to', e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>

            {/* Has auction date */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Auction Scheduled
              </label>
              <select
                value={filters.has_auction_date || ''}
                onChange={e => set('has_auction_date', e.target.value)}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">Any</option>
                <option value="true">Has auction date</option>
                <option value="false">No auction date</option>
              </select>
            </div>

            {/* Sort */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Sort By
              </label>
              <div className="flex gap-1">
                <select
                  value={filters.sort_by || 'list_date'}
                  onChange={e => set('sort_by', e.target.value)}
                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="list_date">Date Listed</option>
                  <option value="price">Price</option>
                  <option value="auction_date">Auction Date</option>
                  <option value="sqft">Sq Ft</option>
                  <option value="bedrooms">Beds</option>
                </select>
                <select
                  value={filters.sort_dir || 'desc'}
                  onChange={e => set('sort_dir', e.target.value)}
                  className="px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="desc">↓</option>
                  <option value="asc">↑</option>
                </select>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
