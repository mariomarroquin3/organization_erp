'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Selector de año de servicio que guarda la elección en ?anio=. */
export function YearSelect({ value, options }: { value: number; options: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const all = options.includes(value) ? options : [value, ...options].sort((a, b) => b - a);
  return (
    <label className="inline">
      Año de servicio{' '}
      <select
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set('anio', e.target.value);
          router.push(`${pathname}?${next.toString()}`);
        }}
      >
        {all.map((y) => <option key={y} value={y}>{y} (sep {y - 1} – ago {y})</option>)}
      </select>
    </label>
  );
}
