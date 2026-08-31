import { toast as sonnerToast } from 'sonner';
import { toast as shadcnToast } from '@/hooks/use-toast';
import type { ToastActionElement } from '@/components/ui/toast';

// AgarAccounting AI unified notification API.
//
// Guidance:
//   notify.success/info/warning   → lightweight, stackable, auto-dismiss (sonner).
//   notify.error                  → sonner error toast; use `action` for retry hooks.
//   notify.promise                → sonner promise (loading → success/error).
//   notify.actionable             → shadcn/radix Toast with a rich action button
//                                   (kept for cases where the user must acknowledge
//                                   or trigger a follow-up like "Open entry").
//
// Extract a human-friendly message from arbitrary mutation/error shapes.
export function readErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (typeof data === 'object' && data !== null && 'error' in data && typeof (data as { error?: unknown }).error === 'string') {
      return (data as { error: string }).error;
    }
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (!message || /<!DOCTYPE|<html[\s>]|Internal Server Error/i.test(message)) return fallback;
    if (/^HTTP \d{3}\b/.test(message) && message.length > 180) return fallback;
    return message;
  }
  if (typeof error === 'string') return error;
  return fallback;
}

type BaseOptions = {
  description?: string;
  duration?: number;
  id?: string | number;
};

type ErrorOptions = BaseOptions & {
  title?: string;
  fallback?: string;
  action?: { label: string; onClick: () => void };
};

function success(title: string, opts: BaseOptions = {}) {
  return sonnerToast.success(title, opts);
}

function info(title: string, opts: BaseOptions = {}) {
  return sonnerToast.info(title, opts);
}

function warning(title: string, opts: BaseOptions = {}) {
  return sonnerToast.warning(title, opts);
}

function error(err: unknown, opts: ErrorOptions = {}) {
  const { fallback, action, title, description, duration, id } = opts;
  const body = description ?? readErrorMessage(err, fallback);
  return sonnerToast.error(title ?? 'Something went wrong', {
    description: body,
    duration: duration ?? 6500,
    id,
    action: action ? { label: action.label, onClick: action.onClick } : undefined,
  });
}

type PromiseMessages<T> = {
  loading: string;
  success: string | ((value: T) => string);
  error: string | ((err: unknown) => string);
};

function promise<T>(work: Promise<T>, messages: PromiseMessages<T>) {
  return sonnerToast.promise(work, {
    loading: messages.loading,
    success: (value) =>
      typeof messages.success === 'function' ? messages.success(value) : messages.success,
    error: (err) =>
      typeof messages.error === 'function' ? messages.error(err) : messages.error,
  });
}

type ActionableOptions = {
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'info' | 'warning' | 'destructive';
  action?: ToastActionElement;
};

function actionable(opts: ActionableOptions) {
  return shadcnToast({
    title: opts.title,
    description: opts.description,
    variant: opts.variant,
    action: opts.action,
  });
}

export const notify = {
  success,
  info,
  warning,
  error,
  promise,
  actionable,
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
};

export default notify;
