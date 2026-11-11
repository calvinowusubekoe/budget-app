import { useState } from 'react';
import { Briefcase, Check, ChevronsUpDown, Plus, User } from 'lucide-react';
import { useNavigate } from 'react-router';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useActiveWorkspace, useSwitchWorkspace } from '@/features/workspaces/useWorkspaces';
import { CreateWorkspaceDialog } from '@/features/workspaces/CreateWorkspaceDialog';
import { Skeleton } from '@/components/ui/feedback';

export function WorkspaceSwitcher({ className }: { className?: string }) {
  const { workspace, workspaces, isLoading } = useActiveWorkspace();
  const switchTo = useSwitchWorkspace();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  if (isLoading || !workspace) return <Skeleton className={cn('h-12 w-full rounded-2xl', className)} />;
  const Icon = workspace.type === 'business' ? Briefcase : User;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'neu-raised-sm flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-xl', workspace.type === 'business' ? 'bg-gold-soft text-gold-ink' : 'bg-primary-soft text-primary')}>
            <Icon className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{workspace.name}</span>
            <span className="block text-xs text-subtle">
              {workspace.type === 'business' ? 'Business' : 'Personal'}, in {workspace.baseCurrency}
            </span>
          </span>
          <ChevronsUpDown className="size-4 text-subtle" aria-hidden />
          <span className="sr-only">Switch workspace</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-64">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onSelect={() => {
                switchTo(w.id);
                navigate('/');
              }}
            >
              {w.type === 'business' ? <Briefcase /> : <User />}
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {w.id === workspace.id && <Check className="text-primary!" aria-label="Current" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus />
            Create workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
