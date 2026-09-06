import { PageTitle } from './ui';

export function TodoistPage() {
  return (
    <div>
      <PageTitle sub="One-way push of assignments into Todoist. Arrives in M6 with a dry-run preview before anything is created.">Todoist sync</PageTitle>
      <p className="text-sm text-muted-foreground">Enter the Todoist API token under Sources first.</p>
    </div>
  );
}
