import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';

const variantIcon = {
  success: <CircleCheck size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />,
  destructive: <CircleAlert size={16} className="mt-0.5 shrink-0 text-destructive" />,
  warning: <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />,
  info: <Info size={16} className="mt-0.5 shrink-0 text-primary" />,
  default: null,
} as const;

type Variant = keyof typeof variantIcon;

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        const key = (variant ?? 'default') as Variant;
        const icon = variantIcon[key] ?? null;
        return (
          <Toast key={id} variant={variant} {...props}>
            {icon}
            <div className="grid min-w-0 flex-1 gap-0.5">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
