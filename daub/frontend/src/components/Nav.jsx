import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function Item({ to, children }) {
  return (
    <NavLink to={to} className={({ isActive }) =>
      `rounded-md px-3 py-1.5 text-sm transition ${isActive ? 'bg-paper-200 text-ink-900' : 'text-ink-600 hover:text-ink-900'}`}>
      {children}
    </NavLink>
  );
}

export default function Nav() {
  const { user, logout, is } = useAuth();
  const navigate = useNavigate();

  return (
    <nav className="border-b border-paper-200 bg-paper-100/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-5 py-3">
        <Link to="/" className="mr-4 font-display text-xl tracking-tight text-ink-900">Daub</Link>

        <Item to="/browse">Library</Item>
        <Item to="/painters">Painters</Item>
        {user && <Item to="/commissions">Commissions</Item>}
        {is('photographer') && <Item to="/studio">My images</Item>}
        {is('painter') && <Item to="/studio/painter">My profile</Item>}
        <Item to="/verify">Verify</Item>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              {(is('painter') || is('photographer')) && <Item to="/earnings">Earnings</Item>}
              <span className="hidden text-sm text-ink-400 sm:inline">{user.name}</span>
              <button className="btn-ghost" onClick={() => { logout(); navigate('/'); }}>Sign out</button>
            </>
          ) : (
            <>
              <Link className="btn-ghost" to="/login">Sign in</Link>
              <Link className="btn-primary" to="/login?register=1">Join</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
