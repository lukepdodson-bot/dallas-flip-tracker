import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Nav from './components/Nav';
import { useAuth } from './contexts/AuthContext';
import { Loading } from './components/ui';

import Home              from './pages/Home';
import Login             from './pages/Login';
import Browse            from './pages/Browse';
import PhotoDetail       from './pages/PhotoDetail';
import Painters          from './pages/Painters';
import Commissions       from './pages/Commissions';
import CommissionDetail  from './pages/CommissionDetail';
import PhotographerStudio from './pages/PhotographerStudio';
import PainterStudio     from './pages/PainterStudio';
import Earnings          from './pages/Earnings';
import Verify            from './pages/Verify';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading label="Checking your session" />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export default function App() {
  return (
    <div className="min-h-screen">
      <Nav />
      <Routes>
        <Route path="/"                    element={<Home />} />
        <Route path="/login"               element={<Login />} />
        <Route path="/browse"              element={<Browse />} />
        <Route path="/photos/:id"          element={<PhotoDetail />} />
        <Route path="/painters"            element={<Painters />} />
        <Route path="/verify"              element={<Verify />} />
        <Route path="/verify/:publicId"    element={<Verify />} />

        <Route path="/commissions"         element={<RequireAuth><Commissions /></RequireAuth>} />
        <Route path="/commissions/:id"     element={<RequireAuth><CommissionDetail /></RequireAuth>} />
        <Route path="/studio"              element={<RequireAuth><PhotographerStudio /></RequireAuth>} />
        <Route path="/studio/painter"      element={<RequireAuth><PainterStudio /></RequireAuth>} />
        <Route path="/earnings"            element={<RequireAuth><Earnings /></RequireAuth>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
