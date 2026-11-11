import * as React from 'react';
import { useMeta } from '@/hooks/useMeta';
import { currencyName } from '@/lib/utils';
import { Select } from './input';

/** Featured currencies first (GHS leads), then every other ISO 4217 code. */
export const CurrencySelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function CurrencySelect(props, ref) {
    const { currencies } = useMeta();
    const rest = currencies.all.filter((c) => !currencies.featured.includes(c));
    return (
      <Select ref={ref} {...props}>
        <optgroup label="Common">
          {currencies.featured.map((c) => (
            <option key={c} value={c}>
              {c} · {currencyName(c)}
            </option>
          ))}
        </optgroup>
        <optgroup label="All currencies">
          {rest.map((c) => (
            <option key={c} value={c}>
              {c} · {currencyName(c)}
            </option>
          ))}
        </optgroup>
      </Select>
    );
  },
);
