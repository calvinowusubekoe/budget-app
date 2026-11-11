import { Outlet } from 'react-router';
import { Briefcase } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { useActiveWorkspace } from '@/features/workspaces/useWorkspaces';

/** Business screens make sense only in a business workspace; elsewhere, explain how to get one. */
export function BusinessOnly() {
  const { workspace, isLoading } = useActiveWorkspace();
  if (isLoading || !workspace) return <Skeleton className="h-64 rounded-3xl" />;
  if (workspace.type !== 'business') {
    return (
      <Card>
        <EmptyState icon={Briefcase} title="Business tools live in business workspaces">
          {workspace.name} is a personal workspace. Create a business workspace from the workspace menu to send invoices, track bills and see profit and loss.
        </EmptyState>
      </Card>
    );
  }
  return <Outlet />;
}
