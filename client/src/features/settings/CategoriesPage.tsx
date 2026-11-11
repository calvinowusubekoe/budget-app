import { useState } from 'react';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, Check, Pencil, Plus, X } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { can } from '@/features/workspaces/useWorkspaces';
import type { Category } from '@/types/api';
import { useCategories, useSaveCategory, useWs } from '@/features/finance/hooks';
import { CategoryIcon, PICKABLE_ICONS } from '@/features/finance/icons';

export function CategoriesPage() {
  const ws = useWs();
  const writable = can(ws.workspace, 'records.write');
  const cats = useCategories(true);
  return (
    <div className="grid gap-6">
      <header>
        <h1 className="text-[28px] font-semibold">Categories</h1>
        <p className="max-w-xl text-muted">Group income and spending your way. Archiving a category hides it from new records; past records keep it.</p>
      </header>
      {cats.isPending ? <Skeleton className="h-80 rounded-3xl" /> : cats.error ? <Alert tone="danger">{cats.error.message}</Alert> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Column kind="expense" title="Spending" items={cats.data!.filter((c) => c.kind === 'expense')} writable={writable} />
          <Column kind="income" title="Income" items={cats.data!.filter((c) => c.kind === 'income')} writable={writable} />
        </div>
      )}
    </div>
  );
}

function Column({ kind, title, items, writable }: { kind: Category['kind']; title: string; items: Category[]; writable: boolean }) {
  const save = useSaveCategory();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('tag');
  const active = items.filter((c) => !c.archived);
  const archived = items.filter((c) => c.archived);

  const add = () => {
    if (!name.trim()) return;
    save.mutate({ kind, name: name.trim(), icon }, { onSuccess: (c) => { setName(''); toast.success(`${c.name} added`); }, onError: (e) => toast.error(e.message) });
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{active.length} in use{archived.length ? `, ${archived.length} archived` : ''}</CardDescription>
        </div>
      </CardHeader>
      <ul className="grid gap-1">
        {active.map((c) => <Row key={c.id} c={c} writable={writable} />)}
      </ul>
      {writable && (
        <form onSubmit={(e) => { e.preventDefault(); add(); }} className="neu-inset mt-4 grid gap-3 rounded-2xl p-3">
          <div className="flex gap-2">
            <Input aria-label={`New ${title.toLowerCase()} category`} placeholder={kind === 'expense' ? 'e.g. School fees' : 'e.g. Kente sales'} value={name} onChange={(e) => setName(e.target.value)} className="glass shadow-none" maxLength={60} />
            <Button type="submit" loading={save.isPending && !save.variables?.id} disabled={!name.trim()}><Plus /> Add</Button>
          </div>
          <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-1">
            {PICKABLE_ICONS.map((i) => (
              <button key={i} type="button" role="radio" aria-checked={icon === i} aria-label={i} onClick={() => setIcon(i)} className={cn('grid size-8 place-items-center rounded-lg text-muted', icon === i ? 'neu-raised-sm text-primary' : 'hover:text-ink')}>
                <CategoryIcon icon={i} className="size-4" />
              </button>
            ))}
          </div>
        </form>
      )}
      {archived.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted">Archived</summary>
          <ul className="mt-2 grid gap-1">
            {archived.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-muted">
                <CategoryIcon icon={c.icon} className="size-4" />
                <span className="flex-1">{c.name}</span>
                {writable && <Button size="sm" variant="ghost" onClick={() => save.mutate({ id: c.id, archived: false }, { onError: (e) => toast.error(e.message) })}><ArchiveRestore /> Restore</Button>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function Row({ c, writable }: { c: Category; writable: boolean }) {
  const save = useSaveCategory();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  return (
    <li className="flex items-center gap-3 rounded-xl px-2 py-1.5">
      <span className="neu-raised-sm grid size-8 place-items-center rounded-lg text-primary"><CategoryIcon icon={c.icon} className="size-4" /></span>
      {editing ? (
        <form className="flex flex-1 gap-1" onSubmit={(e) => { e.preventDefault(); save.mutate({ id: c.id, name }, { onSuccess: () => setEditing(false), onError: (err) => toast.error(err.message) }); }}>
          <Input aria-label="Category name" value={name} onChange={(e) => setName(e.target.value)} className="h-9" autoFocus maxLength={60} />
          <Button size="icon" variant="ghost" type="submit" aria-label="Save name" className="size-9"><Check /></Button>
          <Button size="icon" variant="ghost" type="button" aria-label="Cancel" className="size-9" onClick={() => { setName(c.name); setEditing(false); }}><X /></Button>
        </form>
      ) : (
        <>
          <span className="flex-1 text-sm">{c.name}</span>
          {writable && (
            <span className="flex">
              <Button size="icon" variant="ghost" className="size-8" aria-label={`Rename ${c.name}`} onClick={() => setEditing(true)}><Pencil /></Button>
              <Button size="icon" variant="ghost" className="size-8" aria-label={`Archive ${c.name}`} onClick={() => save.mutate({ id: c.id, archived: true }, { onSuccess: () => toast.success(`${c.name} archived`), onError: (e) => toast.error(e.message) })}><Archive /></Button>
            </span>
          )}
        </>
      )}
    </li>
  );
}
