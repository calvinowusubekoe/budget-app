import { useState } from 'react';
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Table2, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/money';

/*
 * Charts plot the server's decimal strings. Number() is used for geometry
 * only; every value a person reads is the original string, formatted.
 * Colours come from --series-1/2 (validated for colour-blind separation);
 * text stays in ink tokens, and every chart has a legend and a table view.
 */

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const axisTick = { fill: 'var(--muted)', fontSize: 12 };

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  /** "bar" for magnitudes, "line" for a running or derived value. */
  mark: 'bar' | 'line';
  dashed?: boolean;
}

function Legend({ series }: { series: SeriesDef[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted" aria-label="Legend">
      {series.map((s) => (
        <li key={s.key} className="inline-flex items-center gap-1.5">
          {s.mark === 'bar' ? (
            <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} aria-hidden />
          ) : (
            <span className="h-0.5 w-4 rounded-full" style={{ background: s.dashed ? `repeating-linear-gradient(90deg, ${s.color} 0 4px, transparent 4px 7px)` : s.color }} aria-hidden />
          )}
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color: string }[] }) {
  return (
    <div className="glass-strong rounded-xl px-3 py-2 text-sm shadow-lg">
      <p className="mb-1 font-medium">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-6">
          <span className="inline-flex items-center gap-1.5 text-muted">
            <span className="size-2 rounded-full" style={{ background: r.color }} aria-hidden />
            {r.label}
          </span>
          <span className="tabular-nums">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Chart card chrome: title, legend, and a chart/table switch. */
export function ChartFrame({ title, description, series, table, children, actions }: { title: string; description?: string; series: SeriesDef[]; table: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="glass grid gap-4 rounded-3xl p-5 sm:p-6" aria-label={title}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            className="neu-raised-sm inline-flex size-9 items-center justify-center rounded-xl text-muted hover:text-ink"
            aria-label={asTable ? `Show ${title} as a chart` : `Show ${title} as a table`}
            title={asTable ? 'Show chart' : 'Show table'}
          >
            {asTable ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
          </button>
        </div>
      </header>
      {!asTable && <Legend series={series} />}
      {asTable ? <div className="-mx-2 overflow-x-auto">{table}</div> : children}
    </section>
  );
}

export function DataTable({ columns, rows }: { columns: { key: string; label: string; numeric?: boolean }[]; rows: Record<string, string>[] }) {
  return (
    <table className="w-full min-w-[28rem] text-sm">
      <thead className="text-left text-muted">
        <tr>
          {columns.map((c) => (
            <th key={c.key} className={cn('px-2 py-2 font-medium', c.numeric && 'text-right')}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-[var(--line)]">
            {columns.map((c) => (
              <td key={c.key} className={cn('px-2 py-2', c.numeric && 'text-right tabular-nums')}>
                {r[c.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Bars for magnitudes and an optional line, on one shared money axis.
 * `data` rows hold the server's strings under each series key.
 */
export function BarsWithLine({ data, series, currency, height = 260 }: { data: Record<string, string>[]; series: SeriesDef[]; currency: string; height?: number }) {
  const plot = data.map((d) => ({ ...d, ...Object.fromEntries(series.map((s) => [`__${s.key}`, Number(d[s.key])])) }));
  return (
    <div style={{ height }} className="-ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={plot} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => compact.format(v)} />
          <ReferenceLine y={0} stroke="var(--muted)" strokeOpacity={0.5} />
          <Tooltip
            cursor={{ fill: 'var(--line)', opacity: 0.5 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipBox title={String(label)} rows={series.map((s) => ({ label: s.label, color: s.color, value: formatMoney((payload[0]!.payload as Record<string, string>)[s.key], currency) }))} />
              ) : null
            }
          />
          {series.map((s) =>
            s.mark === 'bar' ? (
              <Bar key={s.key} dataKey={`__${s.key}`} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            ) : (
              <Line key={s.key} dataKey={`__${s.key}`} name={s.label} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} dot={{ r: 4, strokeWidth: 2, fill: 'var(--surface)' }} activeDot={{ r: 5 }} isAnimationActive={false} />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** One running total as a line with a soft fill. */
export function RunningTotal({ data, valueKey, label, currency, height = 220 }: { data: Record<string, string>[]; valueKey: string; label: string; currency: string; height?: number }) {
  const plot = data.map((d) => ({ ...d, __v: Number(d[valueKey]) }));
  return (
    <div style={{ height }} className="-ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={plot} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="rt-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => compact.format(v)} />
          <ReferenceLine y={0} stroke="var(--muted)" strokeOpacity={0.5} />
          <Tooltip
            cursor={{ stroke: 'var(--muted)', strokeDasharray: '3 3' }}
            content={({ active, payload, label: l }) =>
              active && payload?.length ? <TooltipBox title={String(l)} rows={[{ label, color: 'var(--series-1)', value: formatMoney((payload[0]!.payload as Record<string, string>)[valueKey], currency) }]} /> : null
            }
          />
          <Area dataKey="__v" name={label} stroke="var(--series-1)" strokeWidth={2} fill="url(#rt-fill)" dot={{ r: 4, strokeWidth: 2, fill: 'var(--surface)' }} activeDot={{ r: 5 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
