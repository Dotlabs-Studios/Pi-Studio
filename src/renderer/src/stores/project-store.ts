/**
 * Project Store - Manages current project (CWD) state.
 */

import { create } from 'zustand'
import { useChatStore } from './chat-store'

interface ProjectState {
  currentProject: string | null
  recentProjects: string[]
  isLoading: boolean
  sessionListVersion: number

  setProject: (path: string) => void
  setRecentProjects: (projects: string[]) => void
  setLoading: (loading: boolean) => void
  clearProject: () => void
  bumpSessionList: () => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  currentProject: null,
  recentProjects: [],
  isLoading: false,
  sessionListVersion: 0,

  setProject: (path) => {
    // Close all chat tabs for the old project
    useChatStore.getState().closeAllTabs()

    set({ currentProject: path, isLoading: false, sessionListVersion: 0 })
  },

  setRecentProjects: (projects) =>
    set({ recentProjects: projects }),

  setLoading: (loading) =>
    set({ isLoading: loading }),

  clearProject: () =>
    set({ currentProject: null }),

  bumpSessionList: () =>
    set((s) => ({ sessionListVersion: s.sessionListVersion + 1 })),
}))
