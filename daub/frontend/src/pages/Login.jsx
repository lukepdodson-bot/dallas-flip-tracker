import { useState } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ErrorNote } from '../components/ui';

const ROLES = [
  ['buyer',        'Commission a painting'],
  ['painter',      'Paint commissions'],
  ['photographer', 'License my photographs'],
];

export default function Login() {
  const [params]   = useSearchParams();
  const [mode, setMode] = useState(params.get('register') ? 'register' : 'login');
  const [form, setForm] = useState({ email: '', password: '', name: '', legalName: '', roles: ['buyer'] });
  const [error, setError]   = useState(null);
  const [busy, setBusy]     = useState(false);

  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const toggleRole = role => set('roles',
    form.roles.includes(role) ? form.roles.filter(r => r !== role) : [...form.roles, role]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register(form);
      navigate(location.state?.from?.pathname || '/browse', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <h1 className="font-display text-3xl text-ink-900">
        {mode === 'login' ? 'Sign in' : 'Create an account'}
      </h1>

      <form onSubmit={submit} className="card mt-6 space-y-4 p-6">
        {mode === 'register' && (
          <>
            <div>
              <label className="label" htmlFor="name">Display name</label>
              <input id="name" className="input" value={form.name} required
                     onChange={e => set('name', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="legalName">Legal name</label>
              <input id="legalName" className="input" value={form.legalName}
                     onChange={e => set('legalName', e.target.value)} />
              <p className="mt-1 text-xs text-ink-400">Used on licences and payout records. Optional now, needed before you get paid.</p>
            </div>
            <fieldset>
              <legend className="label">What are you here to do?</legend>
              <div className="mt-2 space-y-2">
                {ROLES.map(([role, description]) => (
                  <label key={role} className="flex items-center gap-2 text-sm text-ink-600">
                    <input type="checkbox" checked={form.roles.includes(role)} onChange={() => toggleRole(role)} />
                    {description}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}

        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" className="input" value={form.email} required
                 onChange={e => set('email', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" className="input" value={form.password} required minLength={8}
                 onChange={e => set('password', e.target.value)} />
        </div>

        <ErrorNote error={error} />

        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Working' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        <p className="text-center text-sm text-ink-400">
          {mode === 'login' ? 'No account yet? ' : 'Already have one? '}
          <button type="button" className="underline"
                  onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
            {mode === 'login' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </form>

      <p className="mt-6 text-center text-xs text-ink-400">
        Looking around a demo install? Try <code>sam@example.com</code>, <code>marcus@example.com</code> or{' '}
        <code>ada@example.com</code> with <code>DaubDemo2026!</code>.{' '}
        <Link className="underline" to="/browse">Or just browse.</Link>
      </p>
    </div>
  );
}
