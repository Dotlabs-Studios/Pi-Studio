/**
 * Project Store - Manages current project (CWD) state.
 */

import { create } from 'zustand'

interface ProjectState {
  currentProject: string | null
  recentProjects: string[]
  isLoading: boolean

  setProject: (path: string) => void
  setRecentProjects: (projects: string[]) => void
  setLoading: (loading: boolean) => void
  clearProject: () => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  currentProject: null,
  recentProjects: [],
  isLoading: false,

  setProject: (path) =>
    set({ currentProject: path, isLoading: false }),

  setRecentProjects: (projects) =>
    set({ recentProjects: projects }),

  setLoading: (loading) =>
    set({ isLoading: loading }),

  clearProject: () =>
    set({ currentProject: null }),
}))
