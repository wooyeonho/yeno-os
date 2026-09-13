const PROVIDER_DEFINITIONS = Object.freeze({
  openai: {
    id: "openai",
    label: "OpenAI-compatible",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_BASE_URL",
    modelEnv: "OPENAI_MODEL",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    protocol: "responses",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    baseUrlEnv: "ANTHROPIC_BASE_URL",
    modelEnv: "ANTHROPIC_MODEL",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModel: "claude-3-5-haiku-latest",
    protocol: "messages",
  },
  "code-astra": {
    id: "code-astra",
    label: "Code Astra (OpenAI-compatible endpoint)",
    apiKeyEnv: "CODE_ASTRA_API_KEY",
    baseUrlEnv: "CODE_ASTRA_BASE_URL",
    modelEnv: "CODE_ASTRA_MODEL",
    defaultBaseUrl: "",
    defaultModel: "",
    protocol: "responses",
  },
});

function getDefinition(providerId) {
  const definition = PROVIDER_DEFINITIONS[providerId];
  if (!definition) throw new Error(`Unknown provider: ${providerId}`);
  return definition;
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function safeError(responseText, status) {
  let detail = String(responseText || "").replace(/\s+/g, " ").trim();
  if (detail.length > 240) detail = `${detail.slice(0, 240)}…`;
  return `provider returned HTTP ${status}${detail ? `: ${detail}` : ""}`;
}

export function providerIds() {
  return Object.keys(PROVIDER_DEFINITIONS);
}

export function getProviderStatus(providerId, env = process.env) {
  const definition = getDefinition(providerId);
  const apiKey = String(env[definition.apiKeyEnv] || "").trim();
  const baseUrl = String(env[definition.baseUrlEnv] || definition.defaultBaseUrl).trim();
  const model = String(env[definition.modelEnv] || definition.defaultModel).trim();
  const requiresBaseUrl = providerId === "code-astra";
  const configured = Boolean(apiKey && baseUrl && model && (!requiresBaseUrl || env[definition.baseUrlEnv]));
  return {
    id: definition.id,
    label: definition.label,
    configured,
    ready: configured,
    apiKeyEnv: definition.apiKeyEnv,
    baseUrl: baseUrl || null,
    model: model || null,
    protocol: definition.protocol,
    status: configured ? "configured_not_tested" : "not_configured",
  };
}

export function providerStatuses(env = process.env) {
  return providerIds().map((id) => getProviderStatus(id, env));
}

export async function checkProviderConnection(providerId, options = {}) {
  const env = options.env || process.env;
  const status = getProviderStatus(providerId, env);
  if (!status.configured) {
    return { ...status, status: "not_configured", ok: false, checkedAt: new Date().toISOString() };
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this Node runtime");
  const definition = getDefinition(providerId);
  const apiKey = String(env[definition.apiKeyEnv]);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15_000);
  try {
    const response = await fetchImpl(connectionUrl(status), {
      method: "POST",
      headers: connectionHeaders(definition, apiKey),
      body: JSON.stringify(connectionBody(definition, status.model)),
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) {
      return { ...status, status: "failed", ok: false, error: safeError(responseText, response.status), checkedAt: new Date().toISOString() };
    }
    return { ...status, status: "connected", ok: true, checkedAt: new Date().toISOString() };
  } catch (error) {
    return {
      ...status,
      status: "failed",
      ok: false,
      error: error.name === "AbortError" ? "connection check timed out" : String(error.message || error),
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function connectionUrl(status) {
  if (status.protocol === "messages") return `${stripTrailingSlash(status.baseUrl)}/v1/messages`;
  return `${stripTrailingSlash(status.baseUrl)}/responses`;
}

function connectionHeaders(definition, apiKey) {
  if (definition.protocol === "messages") {
    return {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
}

function connectionBody(definition, model) {
  if (definition.protocol === "messages") {
    return {
      model,
      max_tokens: 8,
      messages: [{ role: "user", content: "Reply with OK only. This is a Black Hole connection check." }],
    };
  }
  return {
    model,
    input: "Reply with OK only. This is a Black Hole connection check.",
    max_output_tokens: 8,
  };
}

export async function liveProviderChecks(options = {}) {
  const ids = options.providerIds || providerIds();
  const results = [];
  for (const id of ids) {
    results.push(await checkProviderConnection(id, options));
  }
  return results;
}
