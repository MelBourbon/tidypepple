import { SORT_KEYS, type SortKey, type SortSpec } from '@/domain/sort';
import { t } from '@/i18n';

/**
 * Ein natives `<select>` statt eines eigenen Dropdowns: auf dem Handy bekommt man dadurch
 * das System-Picker-UI, volle Tastaturbedienung und Screenreader-Unterstützung gratis.
 */
export function SortMenu({ value, onChange }: { value: SortSpec; onChange: (spec: SortSpec) => void }): React.ReactNode {
  return (
    <div className="flex items-center gap-1">
      <label className="sr-only" htmlFor="sort-key">
        {t.list.sort}
      </label>
      <select
        id="sort-key"
        value={value.key}
        onChange={(e) => onChange({ ...value, key: e.target.value as SortKey })}
        className="h-8 rounded-md border border-line bg-surface px-2 text-xs text-muted outline-none hover:border-line-strong focus:border-accent"
      >
        {SORT_KEYS.map((key) => (
          <option key={key} value={key}>
            {t.sort[key]}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onChange({ ...value, dir: value.dir === 'asc' ? 'desc' : 'asc' })}
        aria-label={`${t.list.sort}: ${t.list.sortDir(value.dir === 'asc')}`}
        className="flex size-8 items-center justify-center rounded-md border border-line bg-surface text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
      >
        <span aria-hidden="true">{value.dir === 'asc' ? '↑' : '↓'}</span>
      </button>
    </div>
  );
}
