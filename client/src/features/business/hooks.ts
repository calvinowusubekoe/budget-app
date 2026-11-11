import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { apiBlob, saveBlob } from '@/services/api';
import type { Aging, BizDocument, BusinessOverview, CashFlow, DocKind, Party, ProfitLoss } from '@/types/api';
import { invalidateMoney, toQuery, useWs } from '@/features/finance/hooks';

const docPath = (kind: DocKind) => (kind === 'invoice' ? 'invoices' : 'bills');
export type PartyKind = 'customer' | 'supplier';
const partyPath = (kind: PartyKind) => (kind === 'customer' ? 'customers' : 'suppliers');

export function useParties(kind: PartyKind, includeArchived = false) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('business', kind, { includeArchived }), queryFn: () => ws.call<Party[]>(`/business/${partyPath(kind)}${toQuery({ includeArchived })}`), enabled: Boolean(ws.id) });
}

export function usePartyMutations(kind: PartyKind) {
  const ws = useWs();
  const done = () => invalidateMoney(ws.id);
  return {
    save: useMutation({
      mutationFn: ({ id, ...body }: Partial<Party> & { id?: string }) =>
        id ? ws.call<Party>(`/business/${partyPath(kind)}/${id}`, { method: 'PATCH', body }) : ws.call<Party>(`/business/${partyPath(kind)}`, { method: 'POST', body }),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => ws.call(`/business/${partyPath(kind)}/${id}`, { method: 'DELETE' }), onSuccess: done }),
  };
}

export function useDocuments(kind: DocKind, filters: { status?: string; partyId?: string } = {}) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('business', kind, 'list', filters), queryFn: () => ws.call<BizDocument[]>(`/business/${docPath(kind)}${toQuery(filters)}`), enabled: Boolean(ws.id), placeholderData: keepPreviousData });
}

export function useDocument(kind: DocKind, id: string | undefined) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('business', kind, id), queryFn: () => ws.call<BizDocument>(`/business/${docPath(kind)}/${id}`), enabled: Boolean(ws.id && id) });
}

export interface LineInput {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

/** Totals for the editor come from the server; the client never adds money up. */
export function useLinePreview(lines: LineInput[], currency: string, enabled: boolean) {
  const ws = useWs();
  return useQuery({
    queryKey: ws.key('business', 'preview', lines, currency),
    queryFn: () => ws.call<{ subtotal: string; taxTotal: string; total: string; lines: { amount: string; tax: string }[] }>('/business/documents/preview', { method: 'POST', body: { lines: lines.map((l) => ({ ...l, taxRate: l.taxRate || null })), currency } }),
    enabled: Boolean(ws.id) && enabled,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 60_000,
  });
}

export function useDocumentMutations(kind: DocKind) {
  const ws = useWs();
  const done = () => invalidateMoney(ws.id);
  const base = `/business/${docPath(kind)}`;
  return {
    save: useMutation({
      mutationFn: ({ id, ...body }: Record<string, unknown> & { id?: string }) => (id ? ws.call<BizDocument>(`${base}/${id}`, { method: 'PATCH', body }) : ws.call<BizDocument>(base, { method: 'POST', body })),
      onSuccess: done,
    }),
    issue: useMutation({ mutationFn: (id: string) => ws.call<BizDocument>(`${base}/${id}/issue`, { method: 'POST' }), onSuccess: done }),
    void: useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => ws.call<BizDocument>(`${base}/${id}/void`, { method: 'POST', body: { reason } }), onSuccess: done }),
    pay: useMutation({
      mutationFn: ({ id, idempotencyKey, ...body }: { id: string; amount: string; date: string; accountId: string; categoryId?: string; exchangeRate?: string; notes?: string; idempotencyKey: string }) =>
        ws.call<BizDocument>(`${base}/${id}/payments`, { method: 'POST', body, idempotencyKey }),
      onSuccess: done,
    }),
    removePayment: useMutation({
      mutationFn: ({ id, paymentId, reason }: { id: string; paymentId: string; reason: string }) => ws.call<BizDocument>(`${base}/${id}/payments/${paymentId}`, { method: 'DELETE', body: { reason } }),
      onSuccess: done,
    }),
  };
}

export async function downloadDocumentPdf(workspaceId: string | null, kind: DocKind, doc: BizDocument) {
  saveBlob(await apiBlob(`/business/${docPath(kind)}/${doc.id}/pdf`, { workspaceId }), `${doc.number}.pdf`);
}

export function useBusinessOverview(range: { from: string; to: string }) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('business', 'overview', range), queryFn: () => ws.call<BusinessOverview>(`/business/overview${toQuery(range)}`), enabled: Boolean(ws.id) });
}

export function useProfitLoss(range: { from: string; to: string }) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('business', 'pl', range), queryFn: () => ws.call<ProfitLoss>(`/business/reports/profit-loss${toQuery(range)}`), enabled: Boolean(ws.id), placeholderData: keepPreviousData });
}

export function useCashFlow(range: { from: string; to: string }) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('business', 'cf', range), queryFn: () => ws.call<CashFlow>(`/business/reports/cash-flow${toQuery(range)}`), enabled: Boolean(ws.id), placeholderData: keepPreviousData });
}

export function useAging(kind: 'receivables' | 'payables') {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('business', kind), queryFn: () => ws.call<Aging>(`/business/reports/${kind}`), enabled: Boolean(ws.id) });
}

export async function downloadReport(workspaceId: string | null, report: 'profit-loss' | 'cash-flow', range: { from: string; to: string }, format: 'csv' | 'pdf') {
  saveBlob(await apiBlob(`/business/reports/${report}${toQuery({ ...range, format })}`, { workspaceId }), `${report}-${range.from}-to-${range.to}.${format}`);
}

export const STATUS_TEXT: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  overdue: 'Overdue',
  partially_paid: 'Part paid',
  paid: 'Paid',
  void: 'Void',
};

export const STATUS_TONE: Record<string, string> = {
  draft: 'neu-pressed text-muted',
  open: 'bg-primary-soft text-primary',
  overdue: 'bg-danger-soft text-danger',
  partially_paid: 'bg-gold-soft text-gold-ink',
  paid: 'bg-primary text-primary-fg',
  void: 'neu-pressed text-subtle line-through',
};
