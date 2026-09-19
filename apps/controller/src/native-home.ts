// BLACKHOLE Living Core Home navigation (FINAL UI Slice 1 correction, issue
// #25): the small piece of native-only wiring around the shared
// runtime/public/living-core-view.mjs, kept separate from main.ts (which
// cannot be unit tested directly - it imports Tauri plugin APIs) exactly
// like native-live-voice-view.ts/native-studio.ts already are.
//
// This never builds a second voice system: the voice CTA activates the
// EXISTING native Live Voice toggle button by dispatching a real click on
// it, so every safety check native-live-voice-view.ts already enforces
// (online/emergencyStop/busy/disabled) still applies unchanged.
//
// UI Slice 2 (issue #25): Project Orbit/mission taps now open the real
// native Projects destination (showProjectsView) instead of falling back
// to the advanced-tools drawer - the owner must never have to open 고급
// 도구 to reach Project Universe. quests/memory taps still open the
// advanced-tools drawer until their own drill-down screens (Slice 5+) land.
export function createNativeHomeNavigation({
  liveVoiceRoot,
  toolsDrawerSelector = '.tools-drawer',
  doc = document,
  showJobsView,
  showProjectsView,
}: {
  liveVoiceRoot: HTMLElement;
  toolsDrawerSelector?: string;
  doc?: Document;
  showJobsView: () => void;
  showProjectsView: (projectId?: string) => void;
}) {
  function activateVoice() {
    liveVoiceRoot.scrollIntoView({block: 'center', behavior: 'smooth'});
    const toggle = liveVoiceRoot.querySelector<HTMLButtonElement>('[data-live-toggle]');
    if (toggle && !toggle.disabled) toggle.click();
  }
  function openAdvancedTools() {
    const details = doc.querySelector<HTMLDetailsElement>(toolsDrawerSelector);
    if (!details) return;
    details.open = true;
    details.scrollIntoView({block: 'start', behavior: 'smooth'});
  }
  function navigate(id: string, projectId?: string | null) {
    if (id === 'voice') { activateVoice(); return; }
    if (id === 'project-universe') { showProjectsView(projectId ?? undefined); return; }
    if (id === 'quests' || id === 'memory') { openAdvancedTools(); return; }
    if (id === 'control') { showJobsView(); return; }
  }
  return {navigate, activateVoice, openAdvancedTools};
}
