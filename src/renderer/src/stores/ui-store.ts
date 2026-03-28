/**
 * UI Store - Manages sidebar, theme, and general UI state.
 */

import { create } from 'zustand'

interface UIState {
  sidebarOpen: boolean
  sidebarTab: 'sessions' | 'skills' | 'config'
  sidebarWidth: number
  settingsOpen: boolean
  terminalOpen: boolean
  terminalHeight: number

  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setSidebarTab: (tab: 'sessions' | 'skills' | 'config') => void
  setSidebarWidth: (width: number) => void
  setSettingsOpen: (open: boolean) => void
  toggleTerminal: () => void
  setTerminalOpen: (open: boolean) => void
  setTerminalHeight: (height: number) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  sidebarTab: 'sessions',
  sidebarWidth: 280,
  settingsOpen: false,
  terminalOpen: false,
  terminalHeight: 220,

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),
  setTerminalOpen: (open) => set({ terminalOpen: open }),
  setTerminalHeight: (height) => set({ terminalHeight: height }),
}))
