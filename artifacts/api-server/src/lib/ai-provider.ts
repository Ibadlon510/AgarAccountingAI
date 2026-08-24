import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { aiProviderConfigsTable, db } from "@workspace/db";

export const AI_PROVIDERS = ["managed_openai", "openai", "anthropic"] as const;
export type AIProvider = typeof AI_PROVIDERS[number];
export type AICredentialStatus = "not_configured" | "configured" | "invalid" | "unavailable";

export const AI_PROVIDER_MODELS: Record<AIProvider, readonly string[]> = {
  managed_openai: ["gpt-5.6-luna"],
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
  anthropic: ["claude-3-5-sonnet-latest", "claude-3-7-sonnet-latest", "claude-sonnet-4-20250514"],
};

export type AIProviderConfig = {
  clientId: number;
  provider: AIProvider;
  model: string;
  credentialStatus: AICredentialStatus;
  credentialLast4: string | null;
  credentialUpdatedAt: Date | null;
  lastTestedAt: Date | null;
};

export type AIMessage = { role: "system" | "user" | "assistant"; content: string };

export class AIProviderError extends Error {
  constructor(
    readonly kind: "missing_credential" | "invalid_credential" | "unavailable",
    message: string,
    readonly status = kind === "missing_credential" ? 400 : 502,
  ) {
    super(message);
  }
}

function encryptionKey() {
  const secret = process.env.AI_CREDENTIAL_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret) throw new Error("AI credential encryption is not configured.");
  return createHash("sha256").update(secret).digest();
}

function encryptCredential(credential: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(credential, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

function decryptCredential(value: string) {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(":");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) throw new Error("Stored AI credential is unreadable.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function isAIProvider(value: unknown): value is AIProvider {
  return typeof value === "string" && AI_PROVIDERS.includes(value as AIProvider);
}

export function isAIModel(provider: AIProvider, model: unknown): model is string {
  return typeof model === "string" && AI_PROVIDER_MODELS[provider].includes(model);
}

function defaultConfig(clientId: number): AIProviderConfig {
  return {
    clientId,
    provider: "managed_openai",
    model: AI_PROVIDER_MODELS.managed_openai[0],
    credentialStatus: "not_configured",
    credentialLast4: null,
    credentialUpdatedAt: null,
    lastTestedAt: null,
  };
}

function recordToConfig(record: typeof aiProviderConfigsTable.$inferSelect): AIProviderConfig {
  return {
    clientId: record.clientId,
    provider: isAIProvider(record.provider) ? record.provider : "managed_openai",
    model: record.model,
    credentialStatus: record.credentialStatus as AICredentialStatus,
    credentialLast4: record.credentialLast4,
    credentialUpdatedAt: record.credentialUpdatedAt,
    lastTestedAt: record.lastTestedAt,
  };
}

export async function getAIProviderConfig(clientId: number) {
  const [record] = await db.select().from(aiProviderConfigsTable)
    .where(eq(aiProviderConfigsTable.clientId, clientId)).limit(1);
  return record ? recordToConfig(record) : defaultConfig(clientId);
}

export async function saveAIProviderConfig(
  clientId: number,
  provider: AIProvider,
  model: string,
  credential?: string,
) {
  const current = await db.select().from(aiProviderConfigsTable)
    .where(eq(aiProviderConfigsTable.clientId, clientId)).limit(1);
  const existing = current[0];
  const normalizedCredential = credential?.trim();
  const encryptedCredential = provider === "managed_openai"
    ? null
    : normalizedCredential
      ? encryptCredential(normalizedCredential)
      : existing?.encryptedCredential ?? null;
  const credentialLast4 = provider === "managed_openai"
    ? null
    : normalizedCredential
      ? normalizedCredential.slice(-4)
      : existing?.credentialLast4 ?? null;
  const credentialStatus: AICredentialStatus = provider === "managed_openai"
    ? "not_configured"
    : encryptedCredential
      ? "configured"
      : "not_configured";
  const values = {
    clientId,
    provider,
    model,
    credentialStatus,
    encryptedCredential,
    credentialLast4,
    credentialUpdatedAt: normalizedCredential ? new Date() : existing?.credentialUpdatedAt ?? null,
  };
  const [record] = existing
    ? await db.update(aiProviderConfigsTable).set(values)
      .where(eq(aiProviderConfigsTable.clientId, clientId)).returning()
    : await db.insert(aiProviderConfigsTable).values(values).returning();
  return recordToConfig(record);
}

export async function removeAIProviderCredential(clientId: number) {
  const [record] = await db.update(aiProviderConfigsTable).set({
    provider: "managed_openai",
    model: AI_PROVIDER_MODELS.managed_openai[0],
    credentialStatus: "not_configured",
    encryptedCredential: null,
    credentialLast4: null,
    credentialUpdatedAt: null,
    lastTestedAt: null,
  }).where(eq(aiProviderConfigsTable.clientId, clientId)).returning();
  return record ? recordToConfig(record) : defaultConfig(clientId);
}

async function configCredential(config: AIProviderConfig) {
  if (config.provider === "managed_openai") {
    const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!key) throw new AIProviderError("missing_credential", "Replit-managed OpenAI is not available in this environment.");
    return key;
  }
  const [record] = await db.select({ encryptedCredential: aiProviderConfigsTable.encryptedCredential })
    .from(aiProviderConfigsTable).where(eq(aiProviderConfigsTable.clientId, config.clientId)).limit(1);
  if (!record?.encryptedCredential) {
    throw new AIProviderError("missing_credential", `Add a ${config.provider === "anthropic" ? "Anthropic" : "OpenAI"} API key in AI settings before using this provider.`);
  }
  try {
    return decryptCredential(record.encryptedCredential);
  } catch {
    throw new AIProviderError("unavailable", "The saved AI credential could not be read. Replace it in AI settings.");
  }
}

function providerBaseUrl(provider: AIProvider) {
  if (provider === "managed_openai") {
    return process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "";
  }
  if (provider === "openai") {
    return process.env.LEDGERFLOW_OPENAI_BASE_URL || "https://api.openai.com/v1";
  }
  return process.env.LEDGERFLOW_ANTHROPIC_BASE_URL || "https://api.anthropic.com";
}

function providerError(error: unknown) {
  const status = typeof error === "object" && error && "status" in error
    ? Number((error as { status?: unknown }).status) : 0;
  if (status === 401 || status === 403) {
    return new AIProviderError("invalid_credential", "The saved AI credential was rejected. Replace it in AI settings.");
  }
  return new AIProviderError("unavailable", "The selected AI provider is temporarily unavailable. Try again shortly.");
}

async function completeOpenAI(config: AIProviderConfig, messages: AIMessage[], json: boolean, maxTokens: number) {
  const key = await configCredential(config);
  if (!providerBaseUrl(config.provider)) {
    throw new AIProviderError("unavailable", "Replit-managed OpenAI is not configured in this environment.");
  }
  try {
    const client = new OpenAI({ apiKey: key, baseURL: providerBaseUrl(config.provider) });
    const response = await client.chat.completions.create({
      model: config.model,
      max_completion_tokens: maxTokens,
      ...(json ? { response_format: { type: "json_object" as const } } : {}),
      messages,
    });
    return response.choices[0]?.message?.content ?? "";
  } catch (error) {
    throw providerError(error);
  }
}

async function completeAnthropic(config: AIProviderConfig, messages: AIMessage[], maxTokens: number) {
  const key = await configCredential(config);
  const system = messages.find((message) => message.role === "system")?.content;
  const conversation = messages.filter((message) => message.role !== "system").map(({ role, content }) => ({ role, content }));
  try {
    const response = await fetch(`${providerBaseUrl(config.provider)}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: config.model, max_tokens: maxTokens, ...(system ? { system } : {}), messages: conversation }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AIProviderError("invalid_credential", "The saved AI credential was rejected. Replace it in AI settings.");
      }
      throw new AIProviderError("unavailable", "The selected AI provider is temporarily unavailable. Try again shortly.");
    }
    const body = await response.json() as { content?: Array<{ type?: string; text?: string }> };
    return body.content?.find((item) => item.type === "text")?.text ?? "";
  } catch (error) {
    if (error instanceof AIProviderError) throw error;
    throw new AIProviderError("unavailable", "The selected AI provider is temporarily unavailable. Try again shortly.");
  }
}

export async function completeAI(clientId: number, messages: AIMessage[], options?: { json?: boolean; maxTokens?: number }) {
  const config = await getAIProviderConfig(clientId);
  try {
    const content = config.provider === "anthropic"
      ? await completeAnthropic(config, messages, options?.maxTokens ?? 8192)
      : await completeOpenAI(config, messages, options?.json ?? false, options?.maxTokens ?? 8192);
    if (!content) throw new AIProviderError("unavailable", "The selected AI provider returned an empty response. Try again shortly.");
    return content;
  } catch (error) {
    if (error instanceof AIProviderError && config.provider !== "managed_openai") {
      await db.update(aiProviderConfigsTable).set({
        credentialStatus: error.kind === "invalid_credential" ? "invalid" : error.kind === "unavailable" ? "unavailable" : "not_configured",
      }).where(eq(aiProviderConfigsTable.clientId, clientId)).catch(() => undefined);
    }
    throw error;
  }
}

export async function testAIProvider(clientId: number) {
  const config = await getAIProviderConfig(clientId);
  await completeAI(clientId, [{ role: "user", content: "Respond with the single word OK." }], { maxTokens: 8 });
  const [record] = await db.update(aiProviderConfigsTable).set({
    credentialStatus: config.provider === "managed_openai" ? "not_configured" : "configured",
    lastTestedAt: new Date(),
  }).where(eq(aiProviderConfigsTable.clientId, clientId)).returning();
  return record ? recordToConfig(record) : { ...config, lastTestedAt: new Date() };
}