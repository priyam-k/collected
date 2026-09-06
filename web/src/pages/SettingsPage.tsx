import { Link } from 'react-router';

export function SettingsPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <Link to="/" className="text-sm underline-offset-4 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-2 text-sm text-muted-foreground">Sources, courses, and layout settings land in M2.</p>
    </main>
  );
}
