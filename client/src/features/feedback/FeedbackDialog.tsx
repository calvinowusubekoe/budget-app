import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import { toast } from 'sonner';
import { MessageSquarePlus, Star } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useWs } from '@/features/finance/hooks';

type Category = 'bug' | 'idea' | 'confusing' | 'praise' | 'other';
const CATEGORIES: { value: Category; text: string; hint: string }[] = [
  { value: 'bug', text: 'Something’s wrong', hint: 'What did you do, what happened, and what did you expect?' },
  { value: 'confusing', text: 'Something’s confusing', hint: 'Which screen or word was unclear, and what did you think it meant?' },
  { value: 'idea', text: 'An idea', hint: 'What would make Kontaa more useful for you?' },
  { value: 'praise', text: 'Something I like', hint: 'What works well?' },
  { value: 'other', text: 'Something else', hint: 'Anything else you’d like to say.' },
];

export function FeedbackButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Send feedback" title="Send feedback" className={cn('neu-raised-sm grid size-10 place-items-center rounded-full text-muted hover:text-primary', className)}>
        <MessageSquarePlus className="size-[18px]" aria-hidden />
      </button>
      <FeedbackDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const ws = useWs();
  const location = useLocation();
  const [category, setCategory] = useState<Category>('bug');
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const send = useMutation({
    mutationFn: () => ws.call('/feedback', { method: 'POST', body: { category, message: message.trim(), rating, page: location.pathname, viewport: `${window.innerWidth}x${window.innerHeight}` } }),
    onSuccess: () => {
      toast.success('Thank you! Your feedback was sent.');
      setMessage('');
      setRating(null);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const hint = CATEGORIES.find((c) => c.value === category)!.hint;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Send feedback</DialogTitle>
        <DialogDescription>It goes straight to the Kontaa team, with the page you’re on ({location.pathname}). Please don’t include passwords or real account numbers.</DialogDescription>
        <form
          className="mt-4 grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (message.trim().length >= 3) send.mutate();
          }}
        >
          <Field label="What is it about?" htmlFor="fb-category">
            <Select id="fb-category" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.text}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Your feedback" htmlFor="fb-message" hint={hint}>
            <textarea id="fb-message" rows={5} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} className="neu-inset w-full resize-y rounded-2xl bg-transparent px-4 py-3 text-sm focus:outline-2 focus:outline-primary" />
          </Field>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">How is Kontaa so far? (optional)</span>
            <div role="radiogroup" aria-label="Rating out of 5" className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} out of 5`} onClick={() => setRating(rating === n ? null : n)} className="rounded-lg p-1 text-gold transition hover:scale-110">
                  <Star className={cn('size-6', rating !== null && n <= rating ? 'fill-current' : 'opacity-40')} aria-hidden />
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={send.isPending} disabled={message.trim().length < 3}>
              Send feedback
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
