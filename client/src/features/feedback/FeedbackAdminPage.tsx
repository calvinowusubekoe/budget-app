import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import { toast } from 'sonner';
import { Star } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/segmented';
import { apiEnvelope, api } from '@/services/api';
import { queryClient } from '@/app/queryClient';
import { cn, formatDate } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { MessageSquare } from 'lucide-react';

type Status = 'new' | 'seen' | 'done';
interface FeedbackItem {
  id: string;
  category: 'bug' | 'idea' | 'confusing' | 'praise' | 'other';
  message: string;
  rating: number | null;
  page: string;
  workspaceType: 'personal' | 'business' | null;
  userAgent: string;
  viewport: string;
  status: Status;
  adminNote: string;
  createdAt: string;
  from: { name: string; email: string } | null;
}

const CATEGORY_TEXT: Record<FeedbackItem['category'], string> = { bug: 'Something’s wrong', confusing: 'Confusing', idea: 'Idea', praise: 'Likes', other: 'Other' };
const CATEGORY_TONE: Record<FeedbackItem['category'], string> = { bug: 'bg-danger-soft text-danger', confusing: 'bg-gold-soft text-gold-ink', idea: 'bg-primary-soft text-primary', praise: 'bg-primary text-primary-fg', other: 'neu-pressed text-muted' };

/** Tester feedback inbox. The server only answers for ADMIN_EMAILS; others are sent home. */
export function FeedbackAdminPage() {
  const isAdmin = useAuth((s) => s.user?.isAdmin);
  const [status, setStatus] = useState<Status | 'all'>('new');
  const q = useQuery({
    queryKey: ['feedback', status],
    queryFn: () => apiEnvelope<FeedbackItem[]>(`/feedback${status === 'all' ? '' : `?status=${status}`}`),
    enabled: Boolean(isAdmin),
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status: Status }) => api(`/feedback/${id}`, { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feedback'] }),
    onError: (e) => toast.error(e.message),
  });
  if (!isAdmin) return <Navigate to="/" replace />;
  const counts = (q.data?.meta?.counts ?? {}) as Partial<Record<Status, number>>;

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="text-[28px] font-semibold">Tester feedback</h1>
        <p className="text-muted">Everything people sent with the feedback button, newest first.</p>
      </header>
      <Segmented
        label="Show"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'new', text: `New${counts.new ? ` (${counts.new})` : ''}` },
          { value: 'seen', text: `Seen${counts.seen ? ` (${counts.seen})` : ''}` },
          { value: 'done', text: `Done${counts.done ? ` (${counts.done})` : ''}` },
          { value: 'all', text: 'All' },
        ]}
      />
      {q.isPending ? (
        <Skeleton className="h-40 rounded-3xl" />
      ) : q.isError ? (
        <Alert tone="danger">{q.error.message}</Alert>
      ) : q.data.data.length === 0 ? (
        <EmptyState icon={MessageSquare} title="Nothing here yet">
          New feedback appears here as soon as a tester sends it.
        </EmptyState>
      ) : (
        <ul className="grid gap-3">
          {q.data.data.map((f) => (
            <li key={f.id}>
              <Card className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', CATEGORY_TONE[f.category])}>{CATEGORY_TEXT[f.category]}</span>
                  <span className="font-medium">{f.from?.name ?? 'Former user'}</span>
                  <span className="text-muted">{f.from?.email}</span>
                  <span className="ml-auto text-xs text-subtle">{formatDate(f.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{f.message}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span>Page: {f.page || 'unknown'}</span>
                  {f.workspaceType && <span>{f.workspaceType === 'business' ? 'Business' : 'Personal'} workspace</span>}
                  {f.viewport && <span>Screen {f.viewport}</span>}
                  {f.rating && (
                    <span className="inline-flex items-center gap-0.5" aria-label={`Rated ${f.rating} out of 5`}>
                      {Array.from({ length: f.rating }, (_, i) => (
                        <Star key={i} className="size-3.5 fill-current text-gold" aria-hidden />
                      ))}
                    </span>
                  )}
                  <span className="truncate" title={f.userAgent}>
                    {f.userAgent}
                  </span>
                </div>
                <div className="flex gap-2">
                  {(['new', 'seen', 'done'] as Status[])
                    .filter((s) => s !== f.status)
                    .map((s) => (
                      <Button key={s} size="sm" variant="neu" loading={update.isPending && update.variables?.id === f.id && update.variables.status === s} onClick={() => update.mutate({ id: f.id, status: s })}>
                        Mark {s}
                      </Button>
                    ))}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
