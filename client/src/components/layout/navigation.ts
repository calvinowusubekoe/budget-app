import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Briefcase,
  FileText,
  Receipt,
  UsersRound,
  Coins,
  CreditCard,
  FileBarChart,
  LayoutDashboard,
  PiggyBank,
  Settings,
  Sparkles,
  Target,
  Wallet,
} from 'lucide-react';
import type { WorkspaceType } from '@/types/api';

export interface NavItem {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  /** Build phase that ships it. Items without one are live. */
  phase?: number;
  only?: WorkspaceType;
}

export const NAV_SECTIONS: { title?: string; items: NavItem[] }[] = [
  { items: [{ label: 'Dashboard', to: '/', icon: LayoutDashboard }] },
  {
    title: 'Money in and out',
    items: [
      { label: 'Income', to: '/income', icon: ArrowDownLeft },
      { label: 'Expenses', to: '/expenses', icon: ArrowUpRight },
      { label: 'Transactions', to: '/transactions', icon: ArrowLeftRight },
      { label: 'Accounts', to: '/accounts', icon: Wallet },
    ],
  },
  {
    title: 'Plan and save',
    items: [
      { label: 'Budgets', to: '/budgets', icon: Target },
      { label: 'Savings', to: '/savings', icon: PiggyBank },
      { label: 'Susu', to: '/susu', icon: Coins },
      { label: 'Debts', to: '/debts', icon: CreditCard },
    ],
  },
  {
    title: 'Business',
    items: [
      { label: 'Overview', to: '/business', icon: Briefcase, only: 'business' },
      { label: 'Invoices', to: '/business/invoices', icon: FileText, only: 'business' },
      { label: 'Bills', to: '/business/bills', icon: Receipt, only: 'business' },
      { label: 'Customers and suppliers', to: '/business/contacts', icon: UsersRound, only: 'business' },
      { label: 'Business reports', to: '/business/reports', icon: FileBarChart, only: 'business' },
    ],
  },
  {
    title: 'Insight',
    items: [
      { label: 'Reports', to: '/reports', icon: FileBarChart },
      { label: 'AI Assistant', to: '/assistant', icon: Sparkles },
    ],
  },
  { items: [{ label: 'Settings', to: '/settings', icon: Settings }] },
];

/** Bottom bar on phones: the four destinations used most, plus settings. */
export const MOBILE_NAV: NavItem[] = [
  { label: 'Home', to: '/', icon: LayoutDashboard },
  { label: 'Activity', to: '/transactions', icon: ArrowLeftRight },
  { label: 'Susu', to: '/susu', icon: Coins },
  { label: 'Budgets', to: '/budgets', icon: Target },
  { label: 'Settings', to: '/settings', icon: Settings },
];
