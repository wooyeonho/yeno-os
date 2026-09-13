import test from "node:test";
import assert from "node:assert/strict";
import { checkProviderConnection, getProviderStatus, providerStatuses } from "../src/providers.js";

test("provider status never exposes secret values", () => {
  const env = { OPENAI_API_KEY: "do-not-print-this", OPENAI_MODEL: "test-model" };
  const status = getProviderStatus("openai", env);
  assert.equal(status.configured, true);
  assert.equal(Object.values(status).includes("do-not-print-this"), false);
  assert.equal(providerStatuses({}).length, 3);
});

test("provider connection checks use a bounded, provider-specific request", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response("{}", { status: 200 });
  };
  const result = await checkProviderConnection("openai", {
    env: { OPENAI_API_KEY: "secret", OPENAI_MODEL: "test-model" },
    fetchImpl,
    timeoutMs: 1_000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "connected");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /responses$/);
  assert.match(calls[0].init.headers.authorization, /^Bearer /);
});
