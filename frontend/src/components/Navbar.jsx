import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const navLink = (to, label) => (
    <Link
      to={to}
      className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
        location.pathname === to
          ? 'bg-brand-700 text-white'
          : 'text-brand-100 hover:bg-brand-700 hover:text-white'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <nav className="bg-brand-900 shadow-lg">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <span className="text-2xl">🏚</span>
            <span className="text-white font-bold text-lg hidden sm:block">
              Dallas Foreclosure Tracker
            </span>
            <span className="text-white font-bold text-lg sm:hidden">DFW Flips</span>
          </Link>

          {/* Nav links */}
          <div className="flex items-center gap-1">
            {navLink('/', 'Listings')}
            {navLink('/saved', 'Saved')}
            <div className="ml-3 flex items-center gap-2 border-l border-brand-700 pl-3">
              <span className="text-brand-200 text-sm hidden sm:block">
                {user?.username}
              </span>
              <button
                onClick={logout}
                className="text-brand-200 hover:text-white text-sm px-2 py-1 rounded hover:bg-brand-700 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
