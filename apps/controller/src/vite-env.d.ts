/// <reference types="vite/client" />
declare module '*studio-view.mjs' {
  export function createStudioView(options: {
    root: HTMLElement;
    api: (path: string, body?: Record<string, unknown>, options?: {raw?: boolean}) => Promise<any>;
    notify?: (message: string) => void;
    onJobCreated?: (job: any) => void;
    storage?: {getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; flush?(): Promise<void>};
    storageKey?: string;
    saveFile?: (file: {blob: Blob; filename: string; sha256: string | null}) => Promise<void>;
  }): {refresh(): Promise<void>; setState(state: unknown): void; reset(): void; readonly sending: boolean};
}
declare module '*world-view.mjs' {
  export function createWorldView(options: {load: () => Promise<unknown>; submit: () => Promise<void>}): {update(overview: unknown, canRun: boolean): Promise<void>; reset(): void};
}
