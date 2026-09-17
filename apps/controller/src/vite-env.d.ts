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
declare module '*live-voice-client.mjs' {
  export type LiveVoiceEvent =
    | {type: 'state'; state: string; attempt?: number}
    | {type: 'error'; message: string}
    | {type: 'blocked'; reason: string}
    | {type: 'transcript'; role: string; text: string}
    | {type: 'barge_in'; droppedChunks: number}
    | {type: 'playback_overflow'; droppedSamples: number};
  export function createLiveVoiceClient(deps: {
    url: string;
    connect: (url: string) => EventTarget & {send(data: string): void; close(): void; readyState: number};
    doc?: Document; win?: Window;
    onEvent?: (event: LiveVoiceEvent) => void;
  }): {
    start(): Promise<void>;
    stop(reason?: string): void;
    setEmergencyStop(active: boolean): void;
    readonly state: {started: boolean; explicitlyStopped: boolean; emergencyStop: boolean; connectionEpoch: number; reconnectAttempt: number; queued: number};
  };
}
