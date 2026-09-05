import { Link } from 'react-router-dom';
import { Page } from '../components/ui';

const STEPS = [
  ['Pick an image', 'Every photograph in the library is cleared for commission work, with terms the photographer set themselves.'],
  ['Pick a painter', 'Medium, price range and turnaround up front. You are buying a commission, not bidding on finished work.'],
  ['Pay once', 'The money is held until you confirm the painting arrived. The painter starts knowing the sale is already made.'],
  ['Get the certificate', 'Both creators, the licence and the provenance, signed and checkable by anyone you show it to.'],
];

export default function Home() {
  return (
    <>
      <section className="border-b border-paper-200 bg-paper-100">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <p className="text-xs font-medium uppercase tracking-widest text-clay-500">Commission a painting</p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl leading-tight text-ink-900 sm:text-5xl">
            A painting made from a photograph you are actually allowed to use.
          </h1>
          <p className="mt-5 max-w-2xl text-ink-600">
            A painting made from someone else's photograph is a derivative work, and the room for fair
            use in commercial derivative art is narrower than most people assume. Every image here
            arrives with the licence already attached, so the painter can start and you can hang it
            without a question hanging over it.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="btn-accent" to="/browse">Browse the library</Link>
            <Link className="btn-ghost" to="/painters">See the painters</Link>
          </div>
        </div>
      </section>

      <Page>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([title, body], index) => (
            <div key={title} className="card p-5">
              <span className="font-display text-2xl text-clay-400">{index + 1}</span>
              <h2 className="mt-2 font-display text-lg text-ink-900">{title}</h2>
              <p className="mt-2 text-sm text-ink-600">{body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          <div className="card p-5">
            <h3 className="font-display text-lg text-ink-900">For photographers</h3>
            <p className="mt-2 text-sm text-ink-600">
              You decide image by image what may be licensed and what it floors at. An image you are
              precious about stays off. You are paid automatically when the commission settles, and you
              never invoice anyone.
            </p>
          </div>
          <div className="card p-5">
            <h3 className="font-display text-lg text-ink-900">For painters</h3>
            <p className="mt-2 text-sm text-ink-600">
              The sale is guaranteed before you start. You get a full-resolution file with no visible
              watermark, a licence naming exactly what you may do with it, and payment released on
              delivery.
            </p>
          </div>
          <div className="card p-5">
            <h3 className="font-display text-lg text-ink-900">What we do not do</h3>
            <p className="mt-2 text-sm text-ink-600">
              No tokens, no resale royalties dressed up as smart contracts, and no RAW files. The
              certificate is a record of provenance, not an investment product.
            </p>
          </div>
        </div>
      </Page>
    </>
  );
}
