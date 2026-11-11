import { Bell, CalendarClock, Target } from 'lucide-react';
import { useNavigate } from 'react-router';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn, formatDate } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useActiveWorkspace } from '@/features/workspaces/useWorkspaces';
import { useNotificationMutations, useNotifications } from '@/features/planning/hooks';

export function NotificationBell() {
  const q = useNotifications();
  const { read, readAll } = useNotificationMutations();
  const navigate = useNavigate();
  const { workspaces } = useActiveWorkspace();
  const setActive = useAuth((s) => s.setActiveWorkspace);
  const unread = q.data?.unread ?? 0;
  const items = q.data?.items ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="neu-raised-sm relative grid size-10 place-items-center rounded-full text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
        <Bell className="size-[18px]" />
        {unread > 0 && <span className="absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-semibold text-white">{unread > 9 ? '9+' : unread}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))]">
        <div className="flex items-center justify-between">
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
          {unread > 0 && <button type="button" className="px-2.5 text-xs font-medium text-primary hover:underline" onClick={() => readAll.mutate()}>Mark all read</button>}
        </div>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted">You’re all caught up.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {items.map((n) => {
              const Icon = n.type.startsWith('budget') ? Target : CalendarClock;
              const wsName = workspaces.length > 1 ? workspaces.find((w) => w.id === n.workspaceId)?.name : null;
              return (
                <DropdownMenuItem
                  key={n.id}
                  className="items-start"
                  onSelect={() => {
                    if (!n.read) read.mutate(n.id);
                    if (n.workspaceId) setActive(n.workspaceId);
                    if (n.link) navigate(n.link);
                  }}
                >
                  <Icon className={cn('mt-0.5', n.type === 'budget_exceeded' || n.type === 'recurring_failed' ? '!text-danger' : n.type === 'budget_warning' ? '!text-gold-ink' : '!text-primary')} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm', !n.read && 'font-semibold')}>{n.title}</span>
                    {n.body && <span className="block text-xs text-muted">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-subtle">{wsName ? `${wsName}, ` : ''}{formatDate(n.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </span>
                  {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                </DropdownMenuItem>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
