import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Camera, FileText, ScanLine, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { useWs } from '@/features/finance/hooks';
import { useAiMutations, useAiStatus } from '@/features/reports/hooks';
import { useOutbox } from '@/offline/sync';
import type { ReceiptScan } from '@/types/api';

const MAX_MB = 5;
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export function useScanReceipt() {
  const ws = useWs();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return ws.call<ReceiptScan>('/ai/receipts/scan', { method: 'POST', form });
    },
  });
}

/**
 * Pick a photo, screenshot or PDF of a receipt or payment message. The AI
 * reads it and returns suggested fields; the caller opens the normal form so
 * the person checks everything before anything is saved.
 */
export function ScanReceiptDialog({ open, onOpenChange, onRead }: { open: boolean; onOpenChange: (o: boolean) => void; onRead: (scan: ReceiptScan, file: File) => void }) {
  const status = useAiStatus();
  const { consent } = useAiMutations();
  const scan = useScanReceipt();
  const online = useOutbox((s) => s.online);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setError(null);
      scan.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const choose = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!ACCEPT.split(',').includes(f.type)) return setError('Use a JPG, PNG or WebP image, or a PDF.');
    if (f.size > MAX_MB * 1024 * 1024) return setError(`Files can be up to ${MAX_MB} MB. Try a screenshot instead of a full photo.`);
    setFile(f);
  };

  const read = () =>
    file &&
    scan.mutate(file, {
      onSuccess: (r) => {
        onOpenChange(false);
        onRead(r, file);
      },
      onError: (e) => setError(e.message),
    });

  const st = status.data;
  const scansLeft = st?.scans.limit == null ? null : Math.max(st.scans.limit - st.scans.used, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        <DialogTitle className="flex items-center gap-2">
          <ScanLine className="size-5 text-primary" aria-hidden /> Scan a receipt
        </DialogTitle>
        <DialogDescription>A photo of a receipt, or a screenshot of a MoMo message or bank alert. Kontaa reads it and fills in a new transaction for you to check.</DialogDescription>

        <div className="mt-4 grid gap-4">
          {status.isPending ? (
            <Skeleton className="h-28" />
          ) : !st?.configured ? (
            <Alert>Scanning uses the AI assistant, which isn’t set up on this server. You can still record the transaction and attach the receipt to it.</Alert>
          ) : !st.workspaceEnabled ? (
            <Alert tone="gold">The AI assistant is switched off for this workspace, so receipts can’t be scanned here.</Alert>
          ) : !st.consented ? (
            <div className="grid gap-3 rounded-2xl bg-primary-soft p-4 text-sm">
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>
                  To read it, the image is sent to {st.provider} with your category names. Kontaa keeps the image only if you save the transaction, as its attachment. You can withdraw this on the{' '}
                  <Link to="/assistant" className="text-primary underline" onClick={() => onOpenChange(false)}>
                    AI Assistant
                  </Link>{' '}
                  screen.
                </span>
              </p>
              <Button size="sm" className="w-fit" loading={consent.isPending} onClick={() => consent.mutate(undefined, { onError: (e) => toast.error(e.message) })}>
                Agree and continue
              </Button>
            </div>
          ) : (
            <>
              {!online && <Alert tone="gold">Scanning needs a connection. You can record the transaction now and attach the receipt later.</Alert>}
              <input ref={input} type="file" accept={ACCEPT} className="sr-only" aria-label="Receipt file" onChange={(e) => choose(e.target.files?.[0])} />
              <button
                type="button"
                onClick={() => input.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  choose(e.dataTransfer.files?.[0]);
                }}
                className="neu-inset grid min-h-44 place-items-center gap-2 rounded-3xl p-4 text-center text-sm text-muted transition hover:text-ink"
              >
                {preview ? (
                  <img src={preview} alt="Receipt to scan" className="max-h-64 rounded-xl object-contain" />
                ) : file ? (
                  <span className="flex items-center gap-2 text-ink">
                    <FileText className="size-5" aria-hidden /> {file.name}
                  </span>
                ) : (
                  <span className="grid justify-items-center gap-2">
                    <Camera className="size-7 text-primary" aria-hidden />
                    <span>
                      <span className="font-medium text-ink">Take a photo or choose a file</span>
                      <br />
                      JPG, PNG, WebP or PDF, up to {MAX_MB} MB
                    </span>
                  </span>
                )}
              </button>
              {file && (
                <Button variant="link" size="sm" className="w-fit" onClick={() => input.current?.click()}>
                  Choose a different file
                </Button>
              )}
              {error && <Alert tone="danger">{error}</Alert>}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted">{scansLeft === null ? '' : `${scansLeft} scan${scansLeft === 1 ? '' : 's'} left this month`}</span>
                <Button onClick={read} disabled={!file || !online || scansLeft === 0} loading={scan.isPending}>
                  {scan.isPending ? 'Reading…' : 'Read receipt'}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
