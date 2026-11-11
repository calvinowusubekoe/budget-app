import { create } from 'zustand';
import type { User } from '@/types/api';

/** 'unreachable': the session couldn't be checked because BudgetFlow couldn't be reached (e.g. offline at startup). */
type Status = 'loading' | 'authenticated' | 'guest' | 'unreachable';

interface AuthState {
  status: Status;
  user: User | null;
  /** Held in memory only, never in localStorage, so other users of a shared device cannot read it. */
  accessToken: string | null;
  activeWorkspaceId: string | null;
  setSession: (user: User, accessToken: string) => void;
  setUser: (user: User) => void;
  setActiveWorkspace: (id: string) => void;
  clear: () => void;
  setUnreachable: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  accessToken: null,
  activeWorkspaceId: null,
  setSession: (user, accessToken) =>
    set((s) => ({
      status: 'authenticated',
      user,
      accessToken,
      activeWorkspaceId: s.user?.id === user.id ? s.activeWorkspaceId : user.lastWorkspaceId,
    })),
  setUser: (user) => set({ user }),
  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
  clear: () => set({ status: 'guest', user: null, accessToken: null, activeWorkspaceId: null }),
  setUnreachable: () => set({ status: 'unreachable' }),
}));
