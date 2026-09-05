import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, money } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { Page, Loading, ErrorNote, SplitTable } from '../components/ui';

export default function PhotoDetail() {
  const { id } = useParams();
  const { user } = useAuth();

  const [photo, setPhoto]       = useState(null);
  const [painters, setPainters] = useState([]);
  const [error, setError]       = useState(null);

  useEffect(() => {
    Promise.all([api.get(`/photos/${id}`), api.get('/painters', { params: { accepting: 1 } })])
      .then(([photoResponse, paintersResponse]) => {
        setPhoto(photoResponse.data);
        setPainters(paintersResponse.data);
      })
      .catch(err => setError(err.message));
  }, [id]);

  if (error && !photo) return <Page><ErrorNote error={error} /></Page>;
  if (!photo) return <Loading />;

  const commissionSku = photo.skus.find(sku => sku.sku === 'commission');
  const ownImage = user?.id === photo.photographer?.id;

  return (
    <Page>
      <div className="grid gap-10 lg:grid-cols-[1.3fr,1fr]">
        <div>
          <div className="card overflow-hidden">
            {photo.displayUrl && <img src={photo.displayUrl} alt={photo.title} className="w-full" />}
          </div>
          <h1 className="mt-5 font-display text-3xl text-ink-900">{photo.title}</h1>
          <p className="mt-1 text-ink-400">{photo.photographer?.name}</p>
          {photo.description && <p className="mt-4 text-ink-600">{photo.description}</p>}

          {photo.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {photo.tags.map(tag => (
                <span key={tag} className="rounded-full bg-paper-200 px-2.5 py-0.5 text-xs text-ink-600">{tag}</span>
              ))}
            </div>
          )}

          <p className="mt-6 text-sm text-ink-400">
            The web copy is what you see here. The painter receives the full-resolution file only once the
            licence is signed by all three of you, and never a RAW file.
            {commissionSku?.floorPriceCents > 0 &&
              ` The photographer's floor on this image is ${money(commissionSku.floorPriceCents)}.`}
          </p>
        </div>

        <div>
          {ownImage
            ? <p className="card p-5 text-sm text-ink-400">This is your image. <Link className="underline" to="/studio">Manage it in your studio.</Link></p>
            : <CommissionForm photo={photo} painters={painters} />}
        </div>
      </div>
    </Page>
  );
}

function CommissionForm({ photo, painters }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [painterId, setPainterId] = useState('');
  const [price, setPrice]         = useState('');
  const [details, setDetails]     = useState({ medium: '', size: '', brief: '' });
  const [quote, setQuote]         = useState(null);
  const [error, setError]         = useState(null);
  const [busy, setBusy]           = useState(false);

  const painter = painters.find(p => String(p.id) === String(painterId));

  // Re-quote as they type. The server owns the arithmetic and the refusals, so
  // the form never has to reimplement the floor logic to show a number.
  useEffect(() => {
    const cents = Math.round(Number(price) * 100);
    if (!painterId || !Number.isFinite(cents) || cents <= 0) { setQuote(null); setError(null); return; }

    const timer = setTimeout(async () => {
      try {
        const { data } = await api.post('/commissions/quote', {
          photoId: photo.id, painterId: Number(painterId), priceCents: cents,
        });
        setQuote(data);
        setError(null);
      } catch (err) {
        setQuote(null);
        setError(err.message);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [painterId, price, photo.id]);

  async function commission(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post('/commissions', {
        photoId: photo.id,
        painterId: Number(painterId),
        priceCents: Math.round(Number(price) * 100),
        ...details,
      });
      // In a live deployment the buyer is sent to Stripe with the client secret
      // and returns here; the confirm step then re-checks with Stripe before
      // anything is treated as paid.
      await api.post(`/commissions/${data.commission.id}/confirm-payment`);
      navigate(`/commissions/${data.commission.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <div className="card p-6">
        <h2 className="font-display text-xl text-ink-900">Commission this image</h2>
        <p className="mt-2 text-sm text-ink-600">Sign in to pick a painter and price the work.</p>
        <Link className="btn-primary mt-4" to="/login">Sign in</Link>
      </div>
    );
  }

  return (
    <form onSubmit={commission} className="card space-y-4 p-6">
      <h2 className="font-display text-xl text-ink-900">Commission this image</h2>

      <div>
        <label className="label" htmlFor="painter">Painter</label>
        <select id="painter" className="input" value={painterId} required
                onChange={e => setPainterId(e.target.value)}>
          <option value="">Choose a painter</option>
          {painters.map(p => (
            <option key={p.id} value={p.id}>
              {p.name} - {p.mediums.join(', ') || 'any medium'} - from {money(p.minPriceCents)}
            </option>
          ))}
        </select>
        {painter && (
          <p className="mt-1 text-xs text-ink-400">
            Usually delivers in about {painter.turnaroundDays} days.
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="price">Your price (USD)</label>
        <input id="price" className="input" type="number" min="1" step="1" required
               value={price} onChange={e => setPrice(e.target.value)} placeholder="1200" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="medium">Medium</label>
          <input id="medium" className="input" placeholder="oil on linen"
                 value={details.medium} onChange={e => setDetails({ ...details, medium: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="size">Size</label>
          <input id="size" className="input" placeholder="24 x 30 in"
                 value={details.size} onChange={e => setDetails({ ...details, size: e.target.value })} />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="brief">Anything the painter should know</label>
        <textarea id="brief" className="input" rows={3}
                  value={details.brief} onChange={e => setDetails({ ...details, brief: e.target.value })} />
      </div>

      <ErrorNote error={error} />

      {quote && (
        <div className="rounded-md bg-paper-100 p-4">
          <p className="label mb-2">Where your money goes</p>
          <SplitTable quote={quote} />
        </div>
      )}

      <button className="btn-accent w-full" disabled={!quote || busy}>
        {busy ? 'Setting up escrow' : quote ? `Commission for ${money(quote.priceCents)}` : 'Pick a painter and a price'}
      </button>

      <p className="text-xs text-ink-400">
        Your payment is held until you confirm the painting arrived. Nothing is released to anyone before
        then, and the licence has to be signed by all three of you before the painter can even open the file.
      </p>
    </form>
  );
}
