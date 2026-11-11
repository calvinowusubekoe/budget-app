import { LogOut, Settings as SettingsIcon, UserRound } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';
import { cn, initials } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useLogout } from '@/features/auth/useAuthActions';
import { useActiveWorkspace } from '@/features/workspaces/useWorkspaces';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Backdrop, Logo, ThemeToggle } from './Brand';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { NotificationBell } from './NotificationBell';
import { OfflineBanner, SyncIndicator } from '@/offline/OfflineUi';
import { unsentCount, useOutbox } from '@/offline/sync';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Suspense, useState } from 'react';
import { Spinner } from '@/components/ui/feedback';
import { MOBILE_NAV, NAV_SECTIONS, type NavItem } from './navigation';

function NavEntry({ item, compact = false }: { item: NavItem; compact?: boolean }) {
  const Icon = item.icon;
  if (item.phase) {
    // Not built yet: visible so people can see what is coming, but inert.
    return (
      <span
        aria-disabled="true"
        title={`${item.label} is planned for a later release`}
        className={cn(
          'flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2 text-sm text-subtle/70',
          compact && 'flex-col gap-1 px-2 py-1.5 text-[11px]',
        )}
      >
        <Icon className="size-4.5 shrink-0 opacity-60" aria-hidden />
        <span className="flex-1">{item.label}</span>
        {!compact && <span className="text-[11px] text-subtle">Soon</span>}
      </span>
    );
  }
  return (
    <NavLink
      to={item.to}
      end={item.to === '/' || item.to === '/business'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition',
          compact && 'flex-col gap-1 px-2 py-1.5 text-[11px]',
          isActive ? 'neu-pressed text-primary' : 'text-muted hover:text-ink',
        )
      }
    >
      <Icon className="size-4.5 shrink-0" aria-hidden />
      <span>{item.label}</span>
    </NavLink>
  );
}

function UserMenu() {
  const user = useAuth((s) => s.user);
  const logout = useLogout();
  const unsent = useOutbox((s) => unsentCount(s.items));
  const [confirm, setConfirm] = useState(false);
  if (!user) return null;
  // Signing out deletes records still waiting on this device, so say so first.
  const signOut = () => (unsent ? setConfirm(true) : logout.mutate(false));
  return (
    <>
    <Dialog open={confirm} onOpenChange={setConfirm}>
      <DialogContent>
        <DialogTitle>Sign out with unsynced records?</DialogTitle>
        <DialogDescription>
          {unsent} record{unsent > 1 ? 's' : ''} on this device haven't reached BudgetFlow yet. Signing out deletes {unsent > 1 ? 'them' : 'it'} from this device, so nobody else using it can see {unsent > 1 ? 'them' : 'it'}.
        </DialogDescription>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="neu" onClick={() => setConfirm(false)}>Stay signed in</Button>
          <Button variant="danger" loading={logout.isPending} onClick={() => logout.mutate(false)}>Delete and sign out</Button>
        </div>
      </DialogContent>
    </Dialog>
    <DropdownMenu>
      <DropdownMenuTrigger className="neu-raised-sm grid size-10 place-items-center rounded-full text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {initials(user.name)}
        <span className="sr-only">Account menu</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block truncate text-sm font-medium text-ink">{user.name}</span>
          <span className="block truncate">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <UserRound /> Profile and security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings/workspace">
            <SettingsIcon /> Workspace settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
}

export function AppShell() {
  const { workspace } = useActiveWorkspace();
  const visible = (item: NavItem) => !item.only || item.only === workspace?.type;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      <Backdrop />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      <aside className="glass sticky top-0 hidden h-dvh flex-col gap-5 rounded-none border-y-0 border-l-0 p-4 lg:flex">
        <Link to="/" className="px-2 pt-1">
          <Logo />
        </Link>
        <WorkspaceSwitcher />
        <nav aria-label="Main" className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1 pb-2 [scrollbar-color:var(--line)_transparent] scrollbar-thin">
          {NAV_SECTIONS.map((section, i) => {
            const items = section.items.filter(visible);
            if (!items.length) return null;
            return (
              <div key={i}>
                {section.title && <p className="px-3 pb-1.5 text-xs text-subtle">{section.title}</p>}
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <NavEntry key={item.to} item={item} />
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <p className="px-3 text-[11px] leading-snug text-subtle">BudgetFlow keeps records of your money. It never holds or moves it.</p>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="glass sticky top-0 z-30 flex items-center gap-3 rounded-none border-x-0 border-t-0 px-4 py-3 sm:px-6">
          <Link to="/" className="lg:hidden" aria-label="BudgetFlow home">
            <Logo className="[&>span]:hidden sm:[&>span]:inline" />
          </Link>
          <WorkspaceSwitcher className="max-w-60 lg:hidden" />
          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle className="hidden sm:inline-flex" />
            <SyncIndicator />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 sm:px-6 lg:pb-12">
          <OfflineBanner />
          <Suspense fallback={<div className="grid min-h-[40vh] place-items-center"><Spinner label="Loading" /></div>}>
            <Outlet />
          </Suspense>
 00009       </main>
      </div>

      <nav aria-label="Main" className="glass-strong fixed inset-x-3 bottom-3 z-30 flex justify-around rounded-2xl p-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] lg:hidden">
        {MOBILE_NAV.map((item) => (
          <NavEntry key={item.to} item={item} compact />
        ))}
      </nav>
    </div>
  );
}
