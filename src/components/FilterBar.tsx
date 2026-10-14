import { FilterMenu } from './FilterMenu';
import { PriorityFlag } from './PriorityFlag';
import { OPEN_STATUSES, type Context, type TaskStatus } from '@/domain/types';
import { t } from '@/i18n';

/**
 * Priorität, Kontexte, Tags und Status als sichtbare Chips: Recognition over Recall – man sieht
 * auf einen Blick, welcher Filter gerade aktiv ist und warum die Liste kurz ist. Kontexte
 * und Status klappen ihre Auswahl auf, statt je eine eigene Chipzeile zu belegen.
 */
export function FilterBar({
  contexts,
  activeContexts,
  onContextsChange,
  tags,
  activeTags,
  onTagsChange,
  highPriorityOnly,
  onToggleHighPriority,
  statusFilter,
  search,
  onSearch,
}: {
  contexts: readonly Context[];
  activeContexts: readonly string[];
  onContextsChange: (ids: string[]) => void;
  /** Alle vorhandenen Tags; ohne Tags bleibt der Chip weg. */
  tags: readonly string[];
  activeTags: readonly string[];
  onTagsChange: (names: string[]) => void;
  highPriorityOnly: boolean;
  onToggleHighPriority: () => void;
  /** Nur in "All"; ohne bleibt der Status-Chip weg. */
  statusFilter?: { selected: readonly TaskStatus[]; onChange: (statuses: TaskStatus[]) => void };
  search: string;
  onSearch: (value: string) => void;
}): React.ReactNode {
  return (
    <div className="px-4 pb-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onToggleHighPriority}
          aria-pressed={highPriorityOnly}
          className={[
            'inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap',
            highPriorityOnly ? 'border-danger-line bg-danger-soft text-danger' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
          ].join(' ')}
        >
          <PriorityFlag className="size-3" />
          {t.list.highPriorityOnly}
        </button>
        {contexts.length > 0 && (
          <FilterMenu
            name={t.list.context}
            options={contexts.map((c) => ({ value: c.id, label: `@${c.name}` }))}
            selected={activeContexts}
            onChange={onContextsChange}
            countLabel={t.list.contextCount}
            resetLabel={t.list.contextReset}
          />
        )}
        {tags.length > 0 && (
          <FilterMenu
            name={t.list.tag}
            options={tags.map((tag) => ({ value: tag, label: `#${tag}` }))}
            selected={activeTags}
            onChange={onTagsChange}
            countLabel={t.list.tagCount}
            resetLabel={t.list.tagReset}
          />
        )}
        {statusFilter !== undefined && (
          <FilterMenu
            name={t.list.status}
            options={OPEN_STATUSES.map((status) => ({ value: status, label: t.status[status] }))}
            selected={statusFilter.selected}
            onChange={statusFilter.onChange}
            countLabel={t.list.statusCount}
            resetLabel={t.list.statusReset}
            align="end"
          />
        )}
      </div>
      <input
        type="search"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={t.list.searchPlaceholder}
        aria-label={t.list.searchPlaceholder}
        className="mt-2 h-10 w-full rounded-md border border-line bg-surface px-3 text-sm outline-none placeholder:text-subtle hover:border-line-strong focus:border-accent"
      />
    </div>
  );
}
