'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      position="bottom-right"
      offset={24}
      gap={10}
      expand
      richColors={false}
      closeButton
      duration={4500}
      visibleToasts={5}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast pointer-events-auto flex w-full items-start gap-3 rounded-2xl border p-4 pr-10 text-sm shadow-[0_20px_50px_-25px_rgba(15,23,42,0.35)] backdrop-blur-md backdrop-saturate-150 transition-all group-[.toaster]:bg-card/95 group-[.toaster]:text-foreground group-[.toaster]:border-card-border/80',
          title: 'text-[13px] font-semibold leading-5 tracking-tight',
          description: 'mt-0.5 text-[12px] leading-5 text-muted-foreground',
          actionButton:
            'group-[.toast]:h-8 group-[.toast]:rounded-md group-[.toast]:bg-primary group-[.toast]:px-3 group-[.toast]:text-[11px] group-[.toast]:font-semibold group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:h-8 group-[.toast]:rounded-md group-[.toast]:border group-[.toast]:border-border group-[.toast]:bg-transparent group-[.toast]:px-3 group-[.toast]:text-[11px] group-[.toast]:font-semibold group-[.toast]:text-muted-foreground group-[.toast]:hover:bg-muted',
          closeButton:
            'group-[.toast]:!left-auto group-[.toast]:!right-2 group-[.toast]:!top-2 group-[.toast]:!bg-transparent group-[.toast]:!border-transparent group-[.toast]:!text-muted-foreground hover:group-[.toast]:!text-foreground',
          success:
            'group-[.toaster]:border-emerald-500/25 group-[.toaster]:bg-emerald-50/95 group-[.toaster]:text-emerald-900 dark:group-[.toaster]:bg-emerald-950/70 dark:group-[.toaster]:text-emerald-100 dark:group-[.toaster]:border-emerald-500/25',
          info: 'group-[.toaster]:border-primary/25',
          warning:
            'group-[.toaster]:border-amber-500/30 group-[.toaster]:bg-amber-50/95 group-[.toaster]:text-amber-900 dark:group-[.toaster]:bg-amber-950/70 dark:group-[.toaster]:text-amber-100 dark:group-[.toaster]:border-amber-500/30',
          error:
            'group-[.toaster]:border-destructive/40 group-[.toaster]:bg-destructive/5 group-[.toaster]:text-destructive dark:group-[.toaster]:bg-destructive/15',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
