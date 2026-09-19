// BLACKHOLE native Projects destination (UI Slice 2, issue #25). Kept
// separate from main.ts (which imports Tauri plugin APIs and cannot be
// unit-tested directly) exactly like native-home.ts/native-studio.ts
// already are. Mounts the exact same shared runtime/public/
// project-universe-view.mjs the web cockpit uses, and reuses the same
// shared project-universe-model.mjs view-model builders - never a second
// divergent implementation.
import { createProjectUniverseView } from '../../../runtime/public/project-universe-view.mjs';
import { projectUniverseListModel, projectUniverseDetailModel } from '../../../runtime/public/project-universe-model.mjs';

type Project = { id: string; name: string; status: string; version: number; summary?: string; nextAction?: string; milestones?: unknown[] };
type Job = { id: string; projectId?: string; status: string; pauseReason?: string };
type Universe = Parameters<typeof projectUniverseDetailModel>[1];

export function createNativeProjects({
  root,
  api,
  requestId,
  onNavigate = () => {},
}: {
  root: HTMLElement;
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
  requestId: () => string;
  onNavigate?: (target: string) => void;
}) {
  let openId: string | null = null;
  let projects: Project[] = [];
  let jobs: Job[] = [];

  const view = createProjectUniverseView({
    root,
    onOpenProject: id => { void openProject(id); },
    onBack: () => { openId = null; view.updateState(projectUniverseListModel(projects, jobs)); },
    onNavigate: target => onNavigate(target),
    onMilestoneAction: (action, payload) => milestoneAction(action, payload as {projectId: string; text?: string; milestoneId?: string; completed?: boolean}),
  });

  async function openProject(projectId: string) {
    openId = projectId;
    view.updateState({screen: 'detail', detail: null, loading: true, notice: null});
    try {
      const project = projects.find(p => p.id === projectId);
      if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');
      const universe = await api<Universe>(`/projects/${encodeURIComponent(projectId)}/universe`);
      if (openId !== projectId) return;
      view.updateState({screen: 'detail', detail: projectUniverseDetailModel(project, universe), loading: false, notice: null});
    } catch (error) {
      if (openId !== projectId) return;
      view.updateState({screen: 'detail', detail: null, loading: false, notice: error instanceof Error ? error.message : String(error)});
    }
  }

  function replaceCachedProject(next: Project) {
    const index = projects.findIndex(p => p.id === next.id);
    projects = index >= 0 ? [...projects.slice(0, index), next, ...projects.slice(index + 1)] : [...projects, next];
  }

  async function reloadDetail(projectId: string) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return null;
    const universe = await api<Universe>(`/projects/${encodeURIComponent(projectId)}/universe`);
    return projectUniverseDetailModel(project, universe);
  }

  async function milestoneAction(action: string, payload: {projectId: string; text?: string; milestoneId?: string; completed?: boolean}) {
    const project = projects.find(p => p.id === payload.projectId);
    if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');
    const revision = project.version;
    try {
      let response: {project: Project};
      if (action === 'add') {
        response = await api(`/projects/${encodeURIComponent(payload.projectId)}/milestones`, {method: 'POST', body: JSON.stringify({requestId: requestId(), revision, text: payload.text})});
      } else if (action === 'toggle') {
        response = await api(`/projects/${encodeURIComponent(payload.projectId)}/milestones/${encodeURIComponent(payload.milestoneId!)}`, {method: 'POST', body: JSON.stringify({requestId: requestId(), revision, action: 'toggle', completed: payload.completed})});
      } else {
        response = await api(`/projects/${encodeURIComponent(payload.projectId)}/milestones/${encodeURIComponent(payload.milestoneId!)}`, {method: 'POST', body: JSON.stringify({requestId: requestId(), revision, action: 'remove'})});
      }
      // The server's response already carries the real, post-mutation
      // project record (bumped version, real milestone list) - the local
      // cache must reflect that immediately, not wait for the next
      // ~3s state poll from main.ts, or the just-made change would appear
      // to silently revert until then.
      replaceCachedProject(response.project);
      return {detail: await reloadDetail(payload.projectId)};
    } catch (error) {
      // A 409 revision conflict never silently overwrites: refetch the
      // real canonical project list (never keep serving the stale cached
      // project alongside a freshly-fetched universe), replace the cache,
      // then tell the owner it changed - exactly like the web cockpit's
      // own projectMilestoneAction, which gets the same real refresh via
      // its full /api/state reload.
      if ((error as {status?: number})?.status === 409) {
        const latest = await api<{projects: Project[]}>('/projects');
        projects = latest.projects ?? [];
        return {detail: await reloadDetail(payload.projectId), notice: '프로젝트가 변경되어 최신 정보를 다시 불러왔습니다.'};
      }
      throw error;
    }
  }

  return {
    updateProjects(nextProjects: Project[] | undefined, nextJobs: Job[] | undefined) {
      projects = nextProjects ?? []; jobs = nextJobs ?? [];
      if (!openId) view.updateState(projectUniverseListModel(projects, jobs));
    },
    openProject(projectId: string) { void openProject(projectId); },
    // Returns to the list using whatever projects/jobs are already cached -
    // for a plain nav-tab click, never a jarring empty flash while the next
    // poll refetches.
    showList() { openId = null; view.updateState(projectUniverseListModel(projects, jobs)); },
    reset() { openId = null; projects = []; jobs = []; view.reset(); },
    destroy() { view.destroy(); },
  };
}
