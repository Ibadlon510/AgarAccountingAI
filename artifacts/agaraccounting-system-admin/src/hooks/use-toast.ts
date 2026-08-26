import { toast as sonnerToast } from "sonner";

export const useToast = () => {
  return {
    toast: (opts: { title: string; description?: string; variant?: "default" | "destructive" }) => {
      if (opts.variant === "destructive") {
        sonnerToast.error(opts.title, { description: opts.description });
      } else {
        sonnerToast.success(opts.title, { description: opts.description });
      }
    }
  };
};

export const toast = (opts: { title: string; description?: string; variant?: "default" | "destructive" }) => {
  if (opts.variant === "destructive") {
    sonnerToast.error(opts.title, { description: opts.description });
  } else {
    sonnerToast.success(opts.title, { description: opts.description });
  }
};
