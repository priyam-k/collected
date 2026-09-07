import { Route, Routes } from 'react-router';
import { DashboardPage } from '@/pages/DashboardPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { PaneProvider } from '@/panes/PaneContext';

export default function App() {
  return (
    <PaneProvider>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/settings/*" element={<SettingsPage />} />
      </Routes>
    </PaneProvider>
  );
}
