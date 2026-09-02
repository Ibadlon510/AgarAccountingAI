import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  getGetFirmBrandingQueryKey,
  useGetFirmBranding,
  useUpdateFirmBranding,
  useUploadFirmBrandingLogo,
} from "@workspace/api-client-react";
import { notify } from "@/lib/notify";
import { firmSlugError, publicFirmHost } from "@/lib/firm-landing";

async function fileAsBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 0x6000;
  let base64 = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    base64 += btoa(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return base64;
}

const MAX_FIRM_LOGO_BYTES = 2 * 1024 * 1024;

function logoContentType(file: File) {
  const declared = file.type.toLowerCase().split(";")[0]?.trim() ?? "";
  if (declared === "image/jpeg" || declared === "image/png" || declared === "image/webp") return declared;
  const extension = file.name.trim().toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "";
}

export function FirmWhiteLabelCard() {
  const branding = useGetFirmBranding();
  const save = useUpdateFirmBranding();
  const uploadLogo = useUploadFirmBrandingLogo();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    slug: "",
    landingHeadline: "",
    landingTagline: "",
    landingEnabled: true,
  });
  useEffect(() => {
    if (!branding.data) return;
    setForm({
      slug: branding.data.slug ?? "",
      landingHeadline: branding.data.landingHeadline ?? "",
      landingTagline: branding.data.landingTagline ?? "",
      landingEnabled: branding.data.landingEnabled,
    });
  }, [branding.data]);
  const available = branding.data?.available ?? false;
  const canManage = branding.data?.canManage ?? false;
  const editable = available && canManage;
  const publicUrl = form.slug ? `https://${publicFirmHost(form.slug)}` : null;
  const fallbackPath = form.slug ? `/f/${form.slug}` : null;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const slugError = firmSlugError(form.slug.trim().toLowerCase());
    if (slugError) {
      notify.error(slugError, { title: "Choose a valid address" });
      return;
    }
    save.mutate({
      slug: form.slug.trim().toLowerCase(),
      landingHeadline: form.landingHeadline || null,
      landingTagline: form.landingTagline || null,
      landingEnabled: form.landingEnabled,
    }, {
      onSuccess: () => {
        notify.success("White-label landing saved");
        void queryClient.invalidateQueries({ queryKey: getGetFirmBrandingQueryKey() });
      },
      onError: (error) => notify.error(error, { title: "White-label landing could not be saved" }),
    });
  };
  const onLogo = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FIRM_LOGO_BYTES) {
      notify.error("Firm logos must be 2 MB or smaller.");
      return;
    }
    const contentType = logoContentType(file);
    if (!contentType) {
      notify.error("Firm logos must be JPEG, PNG, or WebP.");
      return;
    }
    try {
      await uploadLogo.mutateAsync({
        fileName: file.name,
        contentType,
        fileBase64: await fileAsBase64(file),
      });
      notify.success("Firm logo uploaded");
    } catch (error) {
      notify.error(error, { title: "Firm logo could not be uploaded" });
    }
  };
  const removeLogo = () => {
    save.mutate({ logoObjectPath: null }, {
      onSuccess: () => notify.success("Firm logo removed"),
      onError: (error) => notify.error(error, { title: "Firm logo could not be removed" }),
    });
  };
  const copyPublicUrl = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      notify.success("Landing address copied");
    } catch {
      notify.error("The landing address could not be copied.");
    }
  };
  if (branding.isLoading) {
    return (
      <section data-testid="card-firm-white-label" className="rounded-lg border border-card-border bg-card p-5 md:p-6">
        <p className="text-xs text-muted-foreground">Loading white-label landing…</p>
      </section>
    );
  }
  if (branding.isError || !branding.data) {
    return (
      <section data-testid="card-firm-white-label" className="rounded-lg border border-card-border bg-card p-5 md:p-6">
        <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">White-label landing</div>
        <h2 className="mt-2 text-base font-semibold">Your firm’s public page</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">White-label settings are available after an accounting firm is linked to this account.</p>
      </section>
    );
  }
  return (
    <section data-testid="card-firm-white-label" className="rounded-lg border border-card-border bg-card p-5 md:p-6">
      <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">White-label landing</div>
      <h2 className="mt-2 text-base font-semibold">Your firm’s public page</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Clients can open your branded landing at {publicUrl ?? "firmname.agaraccounting.com"} while Firm Pro or the firm trial is active.
        Until wildcard DNS is in place, the same page is at {fallbackPath ?? "/f/your-slug"}.
      </p>
      {!available && (
        <p className="mt-3 text-xs text-destructive">
          Subscribe to Firm Pro to publish this landing. It stays hidden after the trial lapses.{" "}
          <Link href="/billing/firm" className="font-semibold underline underline-offset-2">Open Firm Pro billing</Link>
        </p>
      )}
      {available && !canManage && (
        <p className="mt-3 text-xs text-muted-foreground">Only firm owners or admins can edit this landing.</p>
      )}
      {branding.data.logoUrl && (
        <div className="mt-4 flex items-center gap-3">
          <img src={`${branding.data.logoUrl}?t=${branding.dataUpdatedAt}`} alt="Firm logo" className="size-14 rounded-lg border border-border object-cover" />
          {editable && (
            <button type="button" data-testid="button-remove-firm-logo" onClick={removeLogo} disabled={save.isPending} className="text-[11px] font-semibold text-destructive">
              Remove logo
            </button>
          )}
        </div>
      )}
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-medium sm:col-span-2">
          Address
          <span className="mt-1.5 flex h-10 items-center rounded-md border border-input bg-background px-3 text-sm">
            <input
              data-testid="input-firm-slug"
              required
              disabled={!editable}
              value={form.slug}
              onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })}
              className="min-w-0 flex-1 bg-transparent outline-none disabled:opacity-60"
            />
            <span className="shrink-0 text-muted-foreground">.agaraccounting.com</span>
          </span>
        </label>
        <label className="text-xs font-medium sm:col-span-2">
          Headline
          <input
            data-testid="input-firm-landing-headline"
            maxLength={120}
            disabled={!editable}
            value={form.landingHeadline}
            onChange={(event) => setForm({ ...form, landingHeadline: event.target.value })}
            placeholder="Your close, ready for review."
            className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
          />
        </label>
        <label className="text-xs font-medium sm:col-span-2">
          Tagline
          <textarea
            data-testid="input-firm-landing-tagline"
            maxLength={280}
            disabled={!editable}
            value={form.landingTagline}
            onChange={(event) => setForm({ ...form, landingTagline: event.target.value })}
            rows={3}
            className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
          />
        </label>
        <label className={`inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[11px] font-semibold ${editable ? "cursor-pointer hover:bg-muted" : "cursor-not-allowed opacity-60"}`}>
          Upload logo
          <input
            data-testid="input-firm-logo"
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            disabled={!editable || uploadLogo.isPending}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              void onLogo(file);
            }}
          />
        </label>
        <label className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3 text-xs sm:col-span-2">
          <input
            data-testid="checkbox-firm-landing-enabled"
            type="checkbox"
            disabled={!editable}
            checked={form.landingEnabled}
            onChange={(event) => setForm({ ...form, landingEnabled: event.target.checked })}
            className="mt-0.5"
          />
          <span>
            <strong>Publish this landing</strong>
            <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">Unpublished pages return 404. The footer still names AgarAccounting AI.</span>
          </span>
        </label>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-2">
          {publicUrl && (
            <button type="button" data-testid="button-copy-firm-landing" onClick={() => void copyPublicUrl()} className="rounded-md border border-border px-4 py-2.5 text-xs font-semibold">
              Copy address
            </button>
          )}
          {fallbackPath && form.landingEnabled && available && (
            <a
              data-testid="link-preview-firm-landing"
              href={fallbackPath}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-border px-4 py-2.5 text-xs font-semibold"
            >
              Preview
            </a>
          )}
          <button
            data-testid="button-save-firm-branding"
            disabled={!editable || save.isPending}
            className="rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save landing"}
          </button>
        </div>
      </form>
    </section>
  );
}
