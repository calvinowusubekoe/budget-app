import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { Meta } from '@/types/api';

const FALLBACK: Meta = {
  currencies: { featured: ['GHS', 'USD', 'EUR', 'GBP', 'NGN', 'CAD'], all: ['GHS', 'USD', 'EUR', 'GBP', 'NGN', 'CAD'] },
  legal: { termsVersion: '', privacyVersion: '' },
};

export function useMeta() {
  const q = useQuery({ queryKey: ['meta'], queryFn: () => api<Meta>('/meta'), staleTime: Infinity });
  return q.data ?? FALLBACK;
}
