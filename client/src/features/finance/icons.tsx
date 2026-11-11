import {
  ArrowLeftRight,
  Banknote,
  Briefcase,
  Bus,
  CalendarClock,
  CircleMinus,
  CirclePlus,
  Clapperboard,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Landmark,
  Laptop,
  PiggyBank,
  Smartphone,
  Store,
  Tag,
  TrendingUp,
  Utensils,
  Wallet,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AccountType, TxType } from '@/types/api';

const CATEGORY_ICONS: Record<string, typeof Tag> = {
  briefcase: Briefcase,
  store: Store,
  laptop: Laptop,
  house: House,
  'trending-up': TrendingUp,
  gift: Gift,
  'circle-plus': CirclePlus,
  'circle-minus': CircleMinus,
  utensils: Utensils,
  bus: Bus,
  zap: Zap,
  'graduation-cap': GraduationCap,
  'heart-pulse': HeartPulse,
  clapperboard: Clapperboard,
  repeat: CalendarClock,
  'calendar-clock': CalendarClock,
  tag: Tag,
};

// 'repeat' is a legacy alias kept so older categories still render.
export const PICKABLE_ICONS = Object.keys(CATEGORY_ICONS).filter((k) => k !== 'repeat');

export function CategoryIcon({ icon, className }: { icon?: string | null; className?: string }) {
  const Icon = CATEGORY_ICONS[icon ?? 'tag'] ?? Tag;
  return <Icon className={className} aria-hidden />;
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  cash: 'Cash',
  bank: 'Bank account',
  mobile_money: 'Mobile money',
  savings: 'Savings account',
  other: 'Other',
};

const ACCOUNT_ICONS: Record<AccountType, typeof Tag> = {
  cash: Banknote,
  bank: Landmark,
  mobile_money: Smartphone,
  savings: PiggyBank,
  other: Wallet,
};

export function AccountIcon({ type, className }: { type?: AccountType; className?: string }) {
  const Icon = ACCOUNT_ICONS[type ?? 'other'];
  return <Icon className={className} aria-hidden />;
}

/** The round badge at the start of a transaction row. Colour encodes direction. */
export function TxBadge({ type, icon, className }: { type: TxType; icon?: string | null; className?: string }) {
  return (
    <span
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-xl',
        type === 'income' && 'bg-primary-soft text-primary',
        type === 'expense' && 'neu-raised-sm text-muted',
        type === 'transfer' && 'bg-gold-soft text-gold-ink',
        className,
      )}
    >
      {type === 'transfer' ? <ArrowLeftRight className="size-4" aria-hidden /> : <CategoryIcon icon={icon} className="size-4" />}
    </span>
  );
}
