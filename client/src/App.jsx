import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './store/auth';
import AppLayout from './layouts/AppLayout';
import { Toaster } from './components/feedback';
import { Loading } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Rooms from './pages/Rooms';
import Reservations from './pages/Reservations';
import ReservationNew from './pages/ReservationNew';
import ReservationDetail from './pages/ReservationDetail';
import Guests from './pages/Guests';
import GuestProfile from './pages/GuestProfile';
import CheckInOut from './pages/CheckInOut';
import { Bills, BillDetail } from './pages/Bills';
import Complaints from './pages/Complaints';
import Approvals from './pages/Approvals';
import AuditLog from './pages/AuditLog';
import { UsersPage, RolesPage, PropertyPage } from './pages/Settings';
import { Forbidden, NotFound } from './pages/Misc';

/** Guard: requires login, and (optionally) any of the listed permissions. Backend enforces the same rules. */
function Guard({ perm, children }) {
  const user = useAuth((s) => s.user);
  if (perm && !perm.some((p) => user.permissions.includes(p))) return <Forbidden />;
  return children;
}
export const homeFor = (user) => (user.permissions.includes('dashboard.owner') || user.permissions.includes('dashboard.frontoffice') ? '/dashboard' : user.permissions.includes('rooms.view') ? '/rooms' : '/profile-none');

export default function App() {
  const { user, loading, init } = useAuth();
  useEffect(() => { init(); }, [init]);
  if (loading) return <div className="flex h-full items-center justify-center"><Loading label="Starting…" /></div>;
  return (
    <>
      <Toaster />
      <Routes>
        <Route path="/login" element={user ? <Navigate to={homeFor(user)} replace /> : <Login />} />
        {!user ? <Route path="*" element={<Navigate to="/login" replace />} /> : (
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to={homeFor(user)} replace />} />
            <Route path="dashboard" element={<Guard perm={['dashboard.owner', 'dashboard.frontoffice']}><Dashboard /></Guard>} />
            <Route path="rooms" element={<Guard perm={['rooms.view']}><Rooms /></Guard>} />
            <Route path="rooms/:id" element={<Guard perm={['rooms.view']}><Rooms /></Guard>} />
            <Route path="reservations" element={<Guard perm={['reservations.view']}><Reservations /></Guard>} />
            <Route path="reservations/new" element={<Guard perm={['reservations.create']}><ReservationNew /></Guard>} />
            <Route path="reservations/:id" element={<Guard perm={['reservations.view']}><ReservationDetail /></Guard>} />
            <Route path="guests" element={<Guard perm={['guests.view']}><Guests /></Guard>} />
            <Route path="guests/:id" element={<Guard perm={['guests.view']}><GuestProfile /></Guard>} />
            <Route path="check-in" element={<Guard perm={['reservations.checkin']}><CheckInOut mode="in" /></Guard>} />
            <Route path="check-out" element={<Guard perm={['reservations.checkout']}><CheckInOut mode="out" /></Guard>} />
            <Route path="bills" element={<Guard perm={['bills.view']}><Bills /></Guard>} />
            <Route path="bills/:id" element={<Guard perm={['bills.view']}><BillDetail /></Guard>} />
            <Route path="complaints" element={<Guard perm={['complaints.view']}><Complaints /></Guard>} />
            <Route path="complaints/:id" element={<Guard perm={['complaints.view']}><Complaints /></Guard>} />
            <Route path="approvals" element={<Guard perm={['approvals.view']}><Approvals /></Guard>} />
            <Route path="audit-log" element={<Guard perm={['audit.view']}><AuditLog /></Guard>} />
            <Route path="settings/users" element={<Guard perm={['users.view']}><UsersPage /></Guard>} />
            <Route path="settings/roles" element={<Guard perm={['roles.view']}><RolesPage /></Guard>} />
            <Route path="settings/property" element={<Guard perm={['property.view', 'property.edit']}><PropertyPage /></Guard>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        )}
      </Routes>
    </>
  );
}
