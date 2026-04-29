import { useQuery } from '@tanstack/react-query';
import api from '../api/client';

function Stat({ label, value, color = 'text-brand-700' }) {
  return (
    <div className="text-center px-4 py-2 border-r border-gray-200 last:border-0">
      <div className={`text-xl font-bold ${color}`}>{value ?? '—'}</div>
      <div className="text-xs text-gray-500 mt-0.5 whitespace-nowrap">{label}</div>
    </div>
  );
}

export default function StatsBar() {
  const { data } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get('/api/properties/stats').then(r => r.data),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  const avg = data?.avg_price ? `$${Math.round(data.avg_price / 1000)}K` : null;
  const updated = data?.last_updated
    ? new Date(data.last_updated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Never';

  return (
    <div className="bg-white border-b border-gray-200">
      <div className="max-w-screen-2xl mx-auto px-4">
        <div className="flex items-center overflow-x-auto">
          <Stat label="Active Listings" value={data?.total_active} />
          <Stat label="Pending" value={data?.total_pending} color="text-yellow-600" />
          <Stat label="Upcoming Auctions" value={data?.upcoming_auctions} color="text-red-600" />
          <Stat label="Avg Price" value={avg} />
          {data?.by_sale_type?.slice(0, 3).map(st => (
            <Stat key={st.sale_type} label={st.sale_type} value={st.count} color="text-gray-700" />
          ))}
          <div className="ml-auto pl-4 text-xs text-gray-400 whitespace-nowrap py-2 shrink-0">
            Updated: {updated}
          </div>
        </div>
      </div>
    </div>
  );
}
