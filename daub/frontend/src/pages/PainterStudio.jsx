import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { Page, ErrorNote, Empty, Loading } from '../components/ui';
import PayoutStatus from '../components/PayoutStatus';

export default function PainterStudio() {
  const { user, is } = useAuth();
  const [profile, setProfile] = useState(null);
  const [error, setError]     = useState(null);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    if (!user || !is('painter')) return;
    api.get(`/painters/${user.id}`)
      .then(({ data }) => setProfile({
        bio: data.bio || '',
        mediums: data.mediums.join(', '),
        minPrice: (data.minPriceCents || 0) / 100,
        maxPrice: data.maxPriceCents ? data.maxPriceCents / 100 : '',
        turnaroundDays: data.turnaroundDays,
        accepting: data.accepting,
        location: data.location || '',
      }))
      .catch(err => setError(err.message));
  }, [user, is]);

  if (!is('painter')) {
    return <Page title="My profile"><Empty title="This area is for painter accounts" /></Page>;
  }
  if (!profile) return <Loading />;

  const set = (key, value) => setProfile(prev => ({ ...prev, [key]: value }));

  async function save(event) {
    event.preventDefault();
    setError(null);
    try {
      await api.put('/painters/me', {
        bio: profile.bio,
        mediums: profile.mediums,
        minPriceCents: Math.round(Number(profile.minPrice) * 100),
        maxPriceCents: profile.maxPrice === '' ? null : Math.round(Number(profile.maxPrice) * 100),
        turnaroundDays: Number(profile.turnaroundDays),
        accepting: profile.accepting,
        location: profile.location,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) { setError(err.message); }
  }

  return (
    <Page
      title="My profile"
      lede="This is what a buyer sees when they are choosing who paints their commission."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={save} className="card space-y-4 p-5">
          <div>
            <label className="label" htmlFor="bio">About your work</label>
            <textarea id="bio" className="input" rows={5} value={profile.bio}
                      onChange={e => set('bio', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="mediums">Mediums</label>
              <input id="mediums" className="input" value={profile.mediums}
                     onChange={e => set('mediums', e.target.value)} placeholder="oil, gouache" />
            </div>
            <div>
              <label className="label" htmlFor="location">Where you work</label>
              <input id="location" className="input" value={profile.location}
                     onChange={e => set('location', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="minPrice">From (USD)</label>
              <input id="minPrice" type="number" min="0" className="input" value={profile.minPrice}
                     onChange={e => set('minPrice', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="maxPrice">Up to</label>
              <input id="maxPrice" type="number" min="0" className="input" value={profile.maxPrice}
                     onChange={e => set('maxPrice', e.target.value)} placeholder="open" />
            </div>
            <div>
              <label className="label" htmlFor="turnaround">Turnaround (days)</label>
              <input id="turnaround" type="number" min="1" className="input" value={profile.turnaroundDays}
                     onChange={e => set('turnaroundDays', e.target.value)} />
            </div>
          </div>

          <p className="text-xs text-ink-400">
            These are the buyer's prices. What reaches you after the photographer's share and the platform
            fee is shown on every quote before anyone commits.
          </p>

          <label className="flex items-center gap-2 text-sm text-ink-600">
            <input type="checkbox" checked={profile.accepting} onChange={e => set('accepting', e.target.checked)} />
            Taking commissions right now
          </label>

          <ErrorNote error={error} />
          <button className="btn-primary w-full">{saved ? 'Saved' : 'Save profile'}</button>
        </form>

        <div className="space-y-6">
          <PayoutStatus />
          <section className="card p-5 text-sm text-ink-600">
            <h2 className="font-display text-lg text-ink-900">How a commission reaches you</h2>
            <ol className="mt-3 space-y-2">
              <li>1. A buyer picks your name and pays. The sale is settled before you start.</li>
              <li>2. A single-use licence appears on the commission. Read it, then sign.</li>
              <li>3. Once all three of you have signed, the full-resolution file unlocks. No visible watermark.</li>
              <li>4. Mark it delivered. Your share is transferred when the buyer confirms.</li>
            </ol>
          </section>
        </div>
      </div>
    </Page>
  );
}
