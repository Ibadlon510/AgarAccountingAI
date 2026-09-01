import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

export type SearchableSelectOption = {
  value: string;
  label: string;
  searchText?: string;
};

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches',
  disabled = false,
  testId,
  ariaLabel,
  ariaBusy,
  className,
  triggerClassName,
  fallbackLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  testId?: string;
  ariaLabel?: string;
  ariaBusy?: boolean;
  className?: string;
  triggerClassName?: string;
  fallbackLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = useMemo(() => options.find((option) => option.value === value), [options, value]);
  const display = selected?.label || fallbackLabel || (value || placeholder);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      `${option.value} ${option.label} ${option.searchText ?? ''}`.toLowerCase().includes(needle),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const selectedIndex = filtered.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setActiveIndex((current) => {
      if (!filtered.length) return 0;
      return Math.min(current, filtered.length - 1);
    });
  }, [filtered]);

  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const choose = (next: string) => {
    onValueChange(next);
    setOpen(false);
  };

  const stopRowToggle = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  return (
    <PopoverPrimitive.Root
      modal
      open={open}
      onOpenChange={(next) => {
        if (!disabled) setOpen(next);
      }}
    >
      <div
        className={cn('min-w-0', className)}
        onMouseDown={stopRowToggle}
        onClick={stopRowToggle}
      >
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            data-testid={testId}
            role="combobox"
            aria-label={ariaLabel}
            aria-busy={ariaBusy}
            aria-expanded={open}
            aria-haspopup="listbox"
            disabled={disabled}
            className={cn(
              'flex w-full items-center justify-between gap-1 rounded-md border border-input bg-background text-left outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50',
              triggerClassName,
            )}
          >
            <span className="min-w-0 truncate">{display}</span>
            <ChevronDown size={12} className="shrink-0 opacity-60" aria-hidden="true" />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            side="bottom"
            sideOffset={4}
            collisionPadding={16}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              inputRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => event.preventDefault()}
            className="z-[200] w-[var(--radix-popover-trigger-width)] min-w-[22rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg outline-none"
          >
            <div className="flex items-center gap-2 border-b px-2.5">
              <Search size={14} className="shrink-0 opacity-50" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setActiveIndex((current) => Math.min(current + 1, Math.max(filtered.length - 1, 0)));
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setActiveIndex((current) => Math.max(current - 1, 0));
                  } else if (event.key === 'Enter') {
                    event.preventDefault();
                    const option = filtered[activeIndex];
                    if (option) choose(option.value);
                  }
                }}
              />
            </div>
            <div role="listbox" className="max-h-64 overflow-y-auto overscroll-contain p-1">
              {filtered.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
              ) : (
                filtered.map((option, index) => (
                  <button
                    key={`${option.value}::${option.label}`}
                    ref={(node) => {
                      optionRefs.current[index] = node;
                    }}
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none',
                      index === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                    )}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(option.value)}
                  >
                    <Check size={14} className={cn('shrink-0', option.value === value ? 'opacity-100' : 'opacity-0')} />
                    <span className="min-w-0 truncate">{option.label}</span>
                  </button>
                ))
              )}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </div>
    </PopoverPrimitive.Root>
  );
}
