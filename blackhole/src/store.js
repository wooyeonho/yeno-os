import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInitialState, normalizeState, nowIso, recoverState } from "./core.js";

async function pathExists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export class BlackHoleStore {
  constructor(dataDir = "data") {
    this.dataDir = dataDir;
    this.statePath = join(dataDir, "black-hole.state.json");
    this.eventsPath = join(dataDir, "black-hole.events.jsonl");
    this.state = null;
    this.lock = Promise.resolve();
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    if (await pathExists(this.statePath)) {
      const raw = JSON.parse(await readFile(this.statePath, "utf8"));
      const recovered = recoverState(raw);
      this.state = recovered.state;
      if (recovered.interruptedRunIds.length) {
        await this.#writeState();
        await this.#appendEvent("runtime.recovered", { runIds: recovered.interruptedRunIds });
      }
    } else {
      this.state = createInitialState();
      await this.#writeState();
      await this.#appendEvent("runtime.initialized", { version: this.state.system.version });
    }
    return this;
  }

  snapshot() {
    if (!this.state) throw new Error("Store is not initialized");
    return JSON.parse(JSON.stringify(this.state));
  }

  async transact(eventType, mutator, metadata = {}) {
    if (!this.state) throw new Error("Store is not initialized");
    const operation = async () => {
      const working = this.snapshot();
      const result = await mutator(working);
      working.system.updatedAt = nowIso();
      this.state = normalizeState(working);
      await this.#writeState();
      await this.#appendEvent(eventType, { ...metadata, result: result ?? null });
      return { result, state: this.snapshot() };
    };
    const pending = this.lock.then(operation, operation);
    this.lock = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async #writeState() {
    const tempPath = `${this.statePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.statePath);
  }

  async #appendEvent(type, payload) {
    const event = {
      id: `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      at: nowIso(),
      payload,
    };
    await appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, "utf8");
  }

  paths() {
    return { dataDir: this.dataDir, statePath: this.statePath, eventsPath: this.eventsPath };
  }
}

export async function openStore(dataDir = "data") {
  return new BlackHoleStore(dataDir).init();
}
