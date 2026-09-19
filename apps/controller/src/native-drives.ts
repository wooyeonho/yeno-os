// BLACKHOLE native Drive Orbit overlay (Seven Drives UI, issue #25). Kept
// separate from main.ts (which imports Tauri plugin APIs and cannot be
// unit-tested directly) exactly like native-projects.ts/native-home.ts
// already are. Mounts the exact same shared runtime/public/
// drive-orbit-view.mjs the web cockpit uses, and reuses the same shared
// drive-orbit-model.mjs view-model builder - never a second scoring engine,
// never a second divergent implementation. This is a real overlay/panel
// reached only from the Home drive chip (see native-home.ts), never a
// permanent bottom-nav tab.
import { createDriveOrbitView } from '../../../runtime/public/drive-orbit-view.mjs';
import { driveOrbitModel } from '../../../runtime/public/drive-orbit-model.mjs';

type DriveStatus = Parameters<typeof driveOrbitModel>[0];
type Core = Parameters<typeof driveOrbitModel>[1];

export function createNativeDrives({
  root,
  api,
  onOpenProject,
  onClose = () => {},
}: {
  root: HTMLElement;
  api: <T>(path: string) => Promise<T>;
  onOpenProject: (projectId: string) => void;
  onClose?: () => void;
}) {
  let epoch = 0;

  const view = createDriveOrbitView({
    root,
    onOpenProject: id => onOpenProject(id),
    onClose: () => onClose(),
  });

  // One bounded GET /api/drives/status per open - no per-drive requests, no
  // polling for animation. Combined with the same real core summary
  // living-core-view.mjs already renders, so isMissionCausal never depends
  // on this view re-deriving anything itself.
  async function open(core: Core | undefined) {
    const current = ++epoch;
    view.reset();
    view.updateState({screen: 'orbit', loading: true, notice: null});
    try {
      const status = await api<DriveStatus>('/drives/status');
      if (current !== epoch) return;
      view.updateState({screen: 'orbit', ...driveOrbitModel(status, core ?? null), loading: false, notice: null});
    } catch (error) {
      if (current !== epoch) return;
      view.updateState({screen: 'orbit', loading: false, notice: error instanceof Error ? error.message : String(error)});
    }
  }

  return {
    open,
    reset() { epoch++; view.reset(); },
    destroy() { view.destroy(); },
  };
}
