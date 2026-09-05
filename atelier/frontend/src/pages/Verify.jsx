import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, shortDate } from '../api/client';
import { Page, ErrorNote, Loading } from '../components/ui';

/**
 * Public certificate check. No account needed - a certificate only a member can
 * verify is not provenance, it is a claim.
 */
export default function Verify() {
  const { publicId } = useParams();
  const navigate = useNavigate();

  const [query, setQuery]   = useState(publicId || '');
  const [result, setResult] = useState(null);
  const [error, setError]   = useState(null);
  const [busy, setBusy]     = useState(false);

  useEffect(() => {
    if (!publicId) { setResult(null); return; }
    setBusy(true);
    api.get(`/registry/${publicId}`)
      .then(({ data }) => { setResult(data); setError(null); })
      .catch(err => { setResult(null); setError(err.message); })
      .finally(() => setBusy(false));
  }, [publicId]);

  return (
    <Page
      title="Verify a certificate"
      lede="Every painting commissioned here carries a signed registry entry naming both creators, the licence
            it was made under, and its provenance. Anyone holding the number can check it."
    >
      <form className="card flex flex-wrap gap-3 p-5"
            onSubmit={event => { event.preventDefault(); navigate(`/verify/${query.trim().toUpperCase()}`); }}>
        <input className="input mt-0 flex-1" placeholder="ATL-2026-XXXX-XX" value={query}
               onChange={e => setQuery(e.target.value)} required />
        <button className="btn-primary">Check it</button>
      </form>

      {busy && <Loading label="Checking the registry" />}
      <ErrorNote error={error} className="mt-4" />

      {result && <Result result={result} />}

      <section className="mt-10 text-sm text-ink-400">
        <h2 className="font-display text-lg text-ink-600">How this works</h2>
        <p className="mt-2 max-w-2xl">
          Each entry is signed with the registry's Ed25519 key over the canonical form of its contents. The
          check recomputes the digest from the stored record rather than trusting the stored digest, so an
          altered record fails even if the database itself was edited. The{' '}
          <a className="underline" href="/api/registry/key" target="_blank" rel="noreferrer">public key</a>{' '}
          is published so you can do the arithmetic yourself.
        </p>
        <p className="mt-3 max-w-2xl">
          An entry is a record of authorship and provenance. It is not a security, an investment instrument,
          or a claim on any future sale of the work.
        </p>
      </section>
    </Page>
  );
}

function Result({ result }) {
  if (!result.valid) {
    return (
      <div className="card mt-6 border-clay-400/50 bg-clay-100 p-6">
        <h2 className="font-display text-xl text-clay-600">This does not check out</h2>
        <p className="mt-2 text-sm text-clay-600">{result.reason}</p>
      </div>
    );
  }

  const { content } = result;

  return (
    <div className="card mt-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-emerald-700">Verified</p>
          <h2 className="mt-1 font-display text-2xl text-ink-900">{content.artwork.title}</h2>
          <p className="text-ink-400">
            {[content.artwork.medium, content.artwork.size].filter(Boolean).join(', ') || 'Original painting'}
          </p>
        </div>
        <a className="btn-ghost" href={result.certificateUrl} target="_blank" rel="noreferrer">Certificate PDF</a>
      </div>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <Fact label="Painted by" value={content.creators.painter.name} />
        <Fact label="After a photograph by" value={content.creators.photographer.name} />
        <Fact label="Completed" value={shortDate(content.artwork.completedAt)} />
        <Fact label="Certificate" value={result.publicId} mono />
        {content.license && (
          <>
            <Fact label="Licence" value={`${content.license.number} - ${content.license.tier.replace('_', '-')}`} />
            <Fact label="Signed by all parties" value={shortDate(content.license.executedAt)} />
          </>
        )}
      </dl>

      <div className="mt-6 border-t border-paper-200 pt-4">
        <p className="label">Signature</p>
        <p className="mt-1 break-all font-mono text-xs text-ink-400">{result.signature}</p>
        <p className="mt-2 text-xs text-ink-400">Registry key {result.keyId}</p>
      </div>

      {result.provenance?.length > 1 && (
        <div className="mt-6 border-t border-paper-200 pt-4">
          <p className="label mb-2">Provenance</p>
          <ol className="space-y-2 text-sm text-ink-600">
            {result.provenance.map(entry => (
              <li key={entry.publicId}>
                <span className="capitalize">{entry.kind}</span> - {entry.publicId} - {shortDate(entry.createdAt)}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, mono }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className={`mt-0.5 text-ink-800 ${mono ? 'font-mono text-sm' : ''}`}>{value}</dd>
    </div>
  );
}
