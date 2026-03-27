/**
 * UI Store - Manages sidebar, theme, and general UI state.
 */

import { create } from 'zustand'

interface UIState {
  sidebarOpen: boolean
  sidebarTab: 'sessions' | 'skills' | 'config'
  sidebarWidth: number
  settingsOpen: boolean

  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setSidebarTab: (tab: 'sessions' | 'skills' | 'config') => void
  setSidebarWidth: (width: number) => void
  setSettingsOpen: (open: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  sidebarTab: 'sessions',
  sidebarWidth: 280,
  settingsOpen: false,

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}))
