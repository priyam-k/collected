import { Dashboard } from '@/dashboard/Dashboard';
import { EditModeProvider } from '@/dashboard/EditMode';

export function DashboardPage() {
  return (
    <EditModeProvider>
      <Dashboard />
    </EditModeProvider>
  );
}
