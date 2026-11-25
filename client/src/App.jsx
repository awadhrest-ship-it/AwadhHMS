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
import InvOverview from './pages/inventory/Overview';
import InvItems from './pages/inventory/Items';
import InvStock from './pages/inventory/Stock';
import InvMovements from './pages/inventory/Movements';
import InvStocktakes from './pages/inventory/Stocktakes';
import InvAlerts from './pages/inventory/Alerts';
import InvSetup from './pages/inventory/Setup';
import HkBoard from './pages/housekeeping/Board';
import HkMyTasks from './pages/housekeeping/MyTasks';
import HkTaskDetail from './pages/housekeeping/TaskDetail';
import HkInspections from './pages/housekeeping/Inspections';
import HkSupplies from './pages/housekeeping/Supplies';
import HkReports from './pages/housekeeping/Reports';
import HkPerformance from './pages/housekeeping/Performance';
import HkSettings from './pages/housekeeping/Settings';
import RestOverview from './pages/restaurant/Overview';
import RestPos from './pages/restaurant/Pos';
import RestOrders from './pages/restaurant/Orders';
import RestFloor from './pages/restaurant/Floor';
import RestMenu from './pages/restaurant/Menu';
import { RestaurantBills as RestBills, RestaurantBillDetail as RestBillDetail, RestaurantApprovals as RestApprovals } from './pages/restaurant/Bills';
import RestClosing from './pages/restaurant/Closing';
import RestSettings from './pages/restaurant/Settings';
import KitchenOverview from './pages/kitchen/Overview';
import KitchenDisplay from './pages/kitchen/Display';
import KitchenRecipes from './pages/kitchen/Recipes';
import KitchenRecipeEditor from './pages/kitchen/RecipeEditor';
import KitchenConsumption from './pages/kitchen/Consumption';
import KitchenWastage from './pages/kitchen/Wastage';
import KitchenPrep from './pages/kitchen/Prep';
import KitchenPerformance from './pages/kitchen/Performance';
import KitchenSettings from './pages/kitchen/Settings';
import BarOverview from './pages/bar/Overview';
import BarMenu from './pages/bar/Menu';
import BarOrders from './pages/bar/Orders';
import BarInventory from './pages/bar/Inventory';
import BarVariance from './pages/bar/Variance';
import BarComplimentary from './pages/bar/Complimentary';
import BarLosses from './pages/bar/Losses';
import BarShifts from './pages/bar/Shifts';
import BarReports from './pages/bar/Reports';
import BarSettings from './pages/bar/Settings';

/** Guard: requires login, and (optionally) any of the listed permissions. Backend enforces the same rules. */
function Guard({ perm, children }) {
  const user = useAuth((s) => s.user);
  if (perm && !perm.some((p) => user.permissions.includes(p))) return <Forbidden />;
  return children;
}
export const homeFor = (user) => {
  const has = (p) => user.permissions.includes(p);
  if (has('dashboard.owner') || has('dashboard.frontoffice')) return '/dashboard';
  if (has('kitchen.view') && !has('restaurant.orders')) return '/kitchen/display';              // kitchen staff land on the kitchen display
  if (has('restaurant.orders') || has('restaurant.kitchen')) return '/restaurant';        // restaurant / kitchen staff land on the restaurant workspace
  if (has('bar.orders') && !has('rooms.view') && !has('restaurant.view')) return '/bar';          // bar staff land on the bar workspace
  if (has('rooms.view')) return '/rooms';
  if (has('housekeeping.work') && !has('housekeeping.view')) return '/housekeeping/my-tasks';   // housekeepers land on their own work list (phone first)
  if (has('housekeeping.view') || has('housekeeping.inspect')) return '/housekeeping';
  if (has('inventory.view')) return '/inventory';
  if (has('restaurant.view')) return '/restaurant';
  return '/profile-none';
};

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
            <Route path="inventory" element={<Guard perm={['inventory.view']}><InvOverview /></Guard>} />
            <Route path="inventory/items" element={<Guard perm={['inventory.view']}><InvItems /></Guard>} />
            <Route path="inventory/items/:id" element={<Guard perm={['inventory.view']}><InvItems /></Guard>} />
            <Route path="inventory/stock" element={<Guard perm={['inventory.view']}><InvStock /></Guard>} />
            <Route path="inventory/movements" element={<Guard perm={['inventory.view']}><InvMovements /></Guard>} />
            <Route path="inventory/stocktakes" element={<Guard perm={['inventory.stocktake', 'inventory.view']}><InvStocktakes /></Guard>} />
            <Route path="inventory/stocktakes/:id" element={<Guard perm={['inventory.stocktake', 'inventory.view']}><InvStocktakes /></Guard>} />
            <Route path="inventory/alerts" element={<Guard perm={['inventory.view']}><InvAlerts /></Guard>} />
            <Route path="inventory/setup" element={<Guard perm={['inventory.view']}><InvSetup /></Guard>} />
            <Route path="housekeeping" element={<Guard perm={['housekeeping.view']}><HkBoard /></Guard>} />
            <Route path="housekeeping/my-tasks" element={<Guard perm={['housekeeping.work']}><HkMyTasks /></Guard>} />
            <Route path="housekeeping/tasks/:id" element={<Guard perm={['housekeeping.view', 'housekeeping.work']}><HkTaskDetail /></Guard>} />
            <Route path="housekeeping/inspections" element={<Guard perm={['housekeeping.inspect', 'housekeeping.view']}><HkInspections /></Guard>} />
            <Route path="housekeeping/supplies" element={<Guard perm={['housekeeping.work', 'housekeeping.stock', 'housekeeping.view']}><HkSupplies /></Guard>} />
            <Route path="housekeeping/reports" element={<Guard perm={['housekeeping.work', 'housekeeping.view']}><HkReports /></Guard>} />
            <Route path="housekeeping/performance" element={<Guard perm={['housekeeping.performance', 'housekeeping.work']}><HkPerformance /></Guard>} />
            <Route path="housekeeping/settings" element={<Guard perm={['housekeeping.configure']}><HkSettings /></Guard>} />
            <Route path="restaurant" element={<Guard perm={['restaurant.view']}><RestOverview /></Guard>} />
            <Route path="restaurant/pos" element={<Guard perm={['restaurant.orders']}><RestPos /></Guard>} />
            <Route path="restaurant/orders" element={<Guard perm={['restaurant.view']}><RestOrders /></Guard>} />
            <Route path="restaurant/floor" element={<Guard perm={['restaurant.view']}><RestFloor /></Guard>} />
            <Route path="restaurant/menu" element={<Guard perm={['restaurant.view']}><RestMenu /></Guard>} />
            <Route path="restaurant/bills" element={<Guard perm={['restaurant.view']}><RestBills /></Guard>} />
            <Route path="restaurant/bills/:id" element={<Guard perm={['restaurant.view']}><RestBillDetail /></Guard>} />
            <Route path="restaurant/approvals" element={<Guard perm={['restaurant.view']}><RestApprovals /></Guard>} />
            <Route path="restaurant/closing" element={<Guard perm={['restaurant.close']}><RestClosing /></Guard>} />
            <Route path="restaurant/settings" element={<Guard perm={['restaurant.configure']}><RestSettings /></Guard>} />
            <Route path="kitchen" element={<Guard perm={['kitchen.view']}><KitchenOverview /></Guard>} />
            <Route path="kitchen/display" element={<Guard perm={['kitchen.view']}><KitchenDisplay /></Guard>} />
            <Route path="kitchen/recipes" element={<Guard perm={['kitchen.recipes.view']}><KitchenRecipes /></Guard>} />
            <Route path="kitchen/recipes/:id" element={<Guard perm={['kitchen.recipes.view']}><KitchenRecipeEditor /></Guard>} />
            <Route path="kitchen/consumption" element={<Guard perm={['kitchen.consumption.view']}><KitchenConsumption /></Guard>} />
            <Route path="kitchen/wastage" element={<Guard perm={['kitchen.wastage.record', 'kitchen.wastage.view']}><KitchenWastage /></Guard>} />
            <Route path="kitchen/prep" element={<Guard perm={['kitchen.prep.work', 'kitchen.prep.manage']}><KitchenPrep /></Guard>} />
            <Route path="kitchen/performance" element={<Guard perm={['kitchen.performance.view']}><KitchenPerformance /></Guard>} />
            <Route path="kitchen/settings" element={<Guard perm={['kitchen.view']}><KitchenSettings /></Guard>} />
            <Route path="bar" element={<Guard perm={['bar.view']}><BarOverview /></Guard>} />
            <Route path="bar/orders" element={<Guard perm={['bar.view']}><BarOrders /></Guard>} />
            <Route path="bar/menu" element={<Guard perm={['bar.view']}><BarMenu /></Guard>} />
            <Route path="bar/inventory" element={<Guard perm={['bar.view']}><BarInventory /></Guard>} />
            <Route path="bar/variance" element={<Guard perm={['bar.variance.view', 'bar.variance.record']}><BarVariance /></Guard>} />
            <Route path="bar/complimentary" element={<Guard perm={['bar.comp.view', 'bar.comp.request', 'bar.comp.issue']}><BarComplimentary /></Guard>} />
            <Route path="bar/losses" element={<Guard perm={['bar.loss.view', 'bar.loss.record']}><BarLosses /></Guard>} />
            <Route path="bar/shifts" element={<Guard perm={['bar.shift.work', 'bar.shift.manage']}><BarShifts /></Guard>} />
            <Route path="bar/reports" element={<Guard perm={['bar.reports', 'bar.shift.work']}><BarReports /></Guard>} />
            <Route path="bar/settings" element={<Guard perm={['bar.view']}><BarSettings /></Guard>} />
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
