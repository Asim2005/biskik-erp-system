import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Center, Loader, Stack, Text } from '@mantine/core';
import { useAuth } from './context/AuthContext';
import { AppLayout } from './components/AppLayout';

import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import RecipesPage from './pages/Recipes';
import RecipeEditorPage from './pages/RecipeEditor';
import ProductionPage from './pages/Production';
import ProductionDetailPage from './pages/ProductionDetail';
import CostingPage from './pages/Costing';
import ProcurementPage from './pages/Procurement';
import MaterialsPage from './pages/Materials';
import InventoryPage from './pages/Inventory';
import InvoicesPage from './pages/Invoices';
import PartiesPage from './pages/Parties';
import AccountsPage from './pages/Accounts';
import TaxPage from './pages/Tax';
import ReportsPage from './pages/Reports';
import UsersPage from './pages/Users';
import SettingsPage from './pages/Settings';

function Splash() {
  return (
    <Center h="100vh">
      <Stack align="center" gap="sm">
        <div style={{ fontSize: 42 }}>🍪</div>
        <Loader color="biscuit" type="dots" />
        <Text size="sm" c="dimmed">
          Starting the ERP
        </Text>
      </Stack>
    </Center>
  );
}

function Protected({ children, permission }) {
  const { user, loading, can } = useAuth();
  const location = useLocation();

  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (permission && !can(permission)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={loading ? <Splash /> : user ? <Navigate to="/" replace /> : <LoginPage />} />

      <Route
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="recipes" element={<RecipesPage />} />
        <Route path="recipes/new" element={<RecipeEditorPage />} />
        <Route path="recipes/:id" element={<RecipeEditorPage />} />
        <Route path="production" element={<ProductionPage />} />
        <Route path="production/:id" element={<ProductionDetailPage />} />
        <Route path="costing" element={<CostingPage />} />
        <Route path="procurement" element={<ProcurementPage />} />
        <Route path="materials" element={<MaterialsPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="parties" element={<PartiesPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="tax" element={<TaxPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
