import { useEffect, useState } from 'react';
import { api, money } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { Page, Loading, ErrorNote, Empty } from '../components/ui';
import PayoutStatus from '../components/PayoutStatus';

export default function PhotographerStudio() {
  const { is } = useAuth();
  const [photos, setPhotos] = useState(null);
  const [error, setError]   = useState(null);

  const load = () => api.get('/photos/mine')
    .then(({ data }) => setPhotos(data))
    .catch(err => setError(err.message));

  useEffect(() => { if (is('photographer')) load(); }, [is]);

  if (!is('photographer')) {
    return <Page title="My images"><Empty title="This area is for photographer accounts" /></Page>;
  }

  return (
    <Page
      title="My images"
      lede="You decide, image by image, what may be licensed and what it floors at. Anything you are precious
            about simply stays off."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr,1.4fr]">
        <div className="space-y-6">
          <PayoutStatus />
          <Upload onDone={load} />
          <Trace />
        </div>

        <div className="space-y-4">
          <ErrorNote error={error} />
          {!photos ? <Loading />
            : photos.length === 0 ? <Empty title="No images yet">Upload one to get started.</Empty>
            : photos.map(photo => <PhotoRow key={photo.id} photo={photo} onChange={load} />)}
        </div>
      </div>
    </Page>
  );
}

function Upload({ onDone }) {
  const [error, setError]   = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy]     = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data } = await api.post('/photos', new FormData(event.target));
      setNotice(data.notice || `"${data.photo.title}" uploaded as a draft.`);
      event.target.reset();
      await onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <h2 className="font-display text-lg text-ink-900">Add an image</h2>

      <div>
        <label className="label" htmlFor="file">Full-resolution file</label>
        <input id="file" name="file" type="file" required className="input"
               accept=".jpg,.jpeg,.tif,.tiff,.png" />
        <p className="mt-1 text-xs text-ink-400">
          JPEG, TIFF or PNG. RAW is refused - a painter does not need your negative, and a full-resolution
          export already carries your colour and tonal decisions.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="display">Web copy</label>
        <input id="display" name="display" type="file" className="input" accept=".jpg,.jpeg,.png" />
        <p className="mt-1 text-xs text-ink-400">
          This is what the library shows. If this install has no image pipeline, supply it yourself - the
          full-resolution file is never shown publicly.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="title">Title</label>
        <input id="title" name="title" className="input" required />
      </div>

      <div>
        <label className="label" htmlFor="tags">Tags</label>
        <input id="tags" name="tags" className="input" placeholder="landscape, water, golden hour" />
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-600">
        <input type="checkbox" name="shotForPainting" value="true" />
        Shot for painting - even light, readable value structure, room to recompose
      </label>

      <ErrorNote error={error} />
      {notice && <p className="rounded-md bg-paper-100 px-3 py-2 text-sm text-ink-600">{notice}</p>}

      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Uploading' : 'Upload'}</button>
    </form>
  );
}

function PhotoRow({ photo, onChange }) {
  const commission = photo.skus.find(sku => sku.sku === 'commission');
  const [floor, setFloor] = useState((commission?.floorPriceCents ?? 0) / 100);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  async function save(patch) {
    setError(null);
    try {
      await api.put(`/photos/${photo.id}/skus`, patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      await onChange();
    } catch (err) { setError(err.message); }
  }

  async function setStatus(status) {
    setError(null);
    try {
      await api.patch(`/photos/${photo.id}`, { status });
      await onChange();
    } catch (err) { setError(err.message); }
  }

  async function uploadDisplay(event) {
    const form = new FormData();
    form.append('display', event.target.files[0]);
    try {
      await api.post(`/photos/${photo.id}/display`, form);
      await onChange();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="card p-4">
      <div className="flex gap-4">
        <div className="h-20 w-24 shrink-0 overflow-hidden rounded bg-paper-200">
          {photo.thumbUrl && <img src={photo.thumbUrl} alt="" className="h-full w-full object-cover" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-display text-lg text-ink-900">{photo.title}</h3>
            <span className="shrink-0 rounded-full bg-paper-200 px-2 py-0.5 text-xs text-ink-600">{photo.status}</span>
          </div>
          <p className="text-xs text-ink-400">
            {photo.width && photo.height ? `${photo.width} x ${photo.height}` : 'dimensions unknown'}
            {photo.tags.length > 0 && ` - ${photo.tags.join(', ')}`}
          </p>

          {photo.needsDisplayRendition && (
            <div className="mt-2 rounded-md bg-clay-100 p-2 text-xs text-clay-600">
              No web copy yet, so this cannot be published.
              <input type="file" accept=".jpg,.jpeg,.png" className="mt-1 block text-xs" onChange={uploadDisplay} />
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-paper-200 pt-4">
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input type="checkbox" checked={Boolean(commission?.enabled)}
                 onChange={e => save({ commission: { enabled: e.target.checked, floorPriceCents: Math.round(floor * 100) } })} />
          Available for commissions
        </label>

        <div>
          <label className="label" htmlFor={`floor-${photo.id}`}>Floor price</label>
          <div className="flex gap-2">
            <input id={`floor-${photo.id}`} type="number" min="0" step="5" className="input w-28"
                   value={floor} onChange={e => setFloor(e.target.value)} />
            <button className="btn-ghost"
                    onClick={() => save({ commission: { enabled: Boolean(commission?.enabled), floorPriceCents: Math.round(floor * 100) } })}>
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-400">
            Your minimum on this image. It beats the percentage whenever it is higher.
          </p>
        </div>

        <div className="ml-auto flex gap-2">
          {photo.status !== 'published'
            ? <button className="btn-primary" disabled={photo.needsDisplayRendition} onClick={() => setStatus('published')}>Publish</button>
            : <button className="btn-ghost" onClick={() => setStatus('withdrawn')}>Withdraw</button>}
        </div>
      </div>

      <ErrorNote error={error} className="mt-3" />
    </div>
  );
}

/** Upload a file found in the wild and see which account it was delivered to. */
function Trace() {
  const [result, setResult] = useState(null);
  const [error, setError]   = useState(null);
  const [busy, setBusy]     = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await api.post('/registry/trace', new FormData(event.target));
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-5">
      <h2 className="font-display text-lg text-ink-900">Trace a file</h2>
      <p className="text-sm text-ink-600">
        Found one of your images somewhere it should not be? Upload the copy and see which licence it was
        delivered under.
      </p>
      <input name="file" type="file" required className="input" />

      <ErrorNote error={error} />
      <button className="btn-ghost w-full" disabled={busy}>{busy ? 'Checking' : 'Trace it'}</button>

      {result && (
        <div className="rounded-md bg-paper-100 p-3 text-sm">
          {!result.found ? (
            <p className="text-ink-600">{result.note}</p>
          ) : (
            <>
              <p className="text-ink-800">
                Delivered to <strong>{result.licensee?.name}</strong> ({result.licensee?.email}) under licence
                #{result.licence?.id} for "{result.photo?.title}".
              </p>
              {result.download && (
                <p className="mt-1 text-xs text-ink-400">
                  Downloaded {new Date(result.download.at).toLocaleString()} from {result.download.ip || 'an unrecorded address'}.
                </p>
              )}
              {result.warning && <p className="mt-2 text-clay-600">{result.warning}</p>}
            </>
          )}
        </div>
      )}
    </form>
  );
}
