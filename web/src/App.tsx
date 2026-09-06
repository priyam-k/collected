import { Route, Routes } from 'react-router';
import { DashboardPage } from '@/pages/DashboardPage';
import { SettingsPage } from '@/pages/SettingsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/settings/*" element={<SettingsPage />} />
    </Routes>
  );
}
