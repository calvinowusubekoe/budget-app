import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export function formatDate(value: string | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) {
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(value));
}

export function currencyName(code: string) {
  try {
    return new Intl.DisplayNames(undefined, { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Size classes for a headline money figure: it shrinks with the screen and with its
 * own length, so "GH₵1,234,567.89" still fits a 360 px phone on one line.
 */
export function figureSize(text: string, size: 'xl' | 'lg' = 'xl') {
  const n = text.length;
  if (size === 'lg') return n <= 11 ? 'text-[clamp(1.875rem,9vw,2.25rem)]' : n <= 14 ? 'text-[clamp(1.5rem,7.5vw,2.25rem)]' : 'text-[clamp(1.25rem,6.2vw,2rem)]';
  return n <= 11 ? 'text-[clamp(2rem,11vw,3rem)] sm:text-6xl' : n <= 14 ? 'text-[clamp(1.75rem,8.6vw,3rem)] sm:text-6xl' : 'text-[clamp(1.4rem,7vw,2.75rem)] sm:text-5xl';
}
