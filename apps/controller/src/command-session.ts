/** Durable command identity. No Tauri dependency, so failure cases run in Node. */
export type PendingCommand = { text: string; requestId: string };
export type CommandReceipt = PendingCommand & { receivedAt: string; payload: unknown };
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class HttpFailure extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class PendingCommandConflict extends Error {
  constructor() {
    super('이전 명령의 접수 여부가 아직 불확실합니다. 대기 명령을 확인하고 같은 명령으로 재시도하세요.');
  }
}

export function isDefinitiveRejection(error: unknown): boolean {
  // Authentication can fail before the server checks an earlier accepted ID.
  // An expired receipt (410) still identifies accepted work. Preserve its ID
  // until its outcome is reconciled; all 5xx, including capacity507, also stay.
  return error instanceof HttpFailure && error.status >= 400 && error.status < 500 && ![401, 403, 408, 410].includes(error.status);
}

export class CommandSession {
  private storage: StoragePort;
  private pendingKey: string;
  private receiptKey: string;
  private createId: () => string;
  private send: (command: PendingCommand) => Promise<unknown>;
  private inFlight: { text: string; promise: Promise<CommandReceipt> } | null = null;

  constructor(options: {
    origin: string;
    deviceId: string;
    storage: StoragePort;
    createId: () => string;
    send: (command: PendingCommand) => Promise<unknown>;
  }) {
    const scope = encodeURIComponent(JSON.stringify([new URL(options.origin).origin, options.deviceId]));
    this.pendingKey = `yeno.command.v2:${scope}:pending`;
    this.receiptKey = `yeno.command.v2:${scope}:receipt`;
    this.storage = options.storage;
    this.createId = options.createId;
    this.send = options.send;
  }

  get pending(): PendingCommand | null {
    const raw = this.storage.getItem(this.pendingKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingCommand;
    if (!value || typeof value.text !== 'string' || !value.text || typeof value.requestId !== 'string' || !value.requestId) {
      throw new Error('저장된 대기 명령을 읽을 수 없습니다. 새 명령을 보내기 전에 연결 기록을 확인하세요.');
    }
    return value;
  }

  get receipt(): CommandReceipt | null {
    const raw = this.storage.getItem(this.receiptKey);
    return raw ? JSON.parse(raw) as CommandReceipt : null;
  }

  submit(input: string): Promise<CommandReceipt> {
    const text = input.trim();
    if (!text) return Promise.reject(new Error('명령을 입력하세요.'));
    if (this.inFlight) {
      return text === this.inFlight.text ? this.inFlight.promise : Promise.reject(new PendingCommandConflict());
    }
    let command: PendingCommand;
    try {
      const pending = this.pending;
      if (pending && pending.text !== text) throw new PendingCommandConflict();
      command = pending ?? { text, requestId: this.createId() };
      // A storage failure must prevent transmission. The server may execute immediately.
      this.storage.setItem(this.pendingKey, JSON.stringify(command));
    } catch (error) {
      return Promise.reject(error);
    }
    const promise = this.deliver(command).finally(() => { this.inFlight = null; });
    this.inFlight = { text, promise };
    return promise;
  }

  private async deliver(command: PendingCommand): Promise<CommandReceipt> {
    let payload: unknown;
    try {
      payload = await this.send(Object.freeze({ ...command }));
    } catch (error) {
      if (isDefinitiveRejection(error)) this.storage.removeItem(this.pendingKey);
      throw error;
    }
    const receipt = { ...command, receivedAt: new Date().toISOString(), payload };
    // Keep the request retryable if saving its result fails after server acceptance.
    this.storage.setItem(this.receiptKey, JSON.stringify(receipt));
    this.storage.removeItem(this.pendingKey);
    return receipt;
  }

  clearLocal(): void {
    if (this.inFlight) throw new Error('명령 접수 확인이 끝난 뒤 연결을 해제하세요.');
    this.storage.removeItem(this.pendingKey);
    this.storage.removeItem(this.receiptKey);
  }
}
