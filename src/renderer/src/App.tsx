/**
 * Pi Studio - Main Application Component
 */

import React, { useEffect, useState } from 'react'
import { TitleBar } from '@/components/layout/TitleBar'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChatView } from '@/components/chat/ChatView'
import { ChatTabBar } from '@/components/chat/ChatTabBar'
import { WelcomeScreen } from '@/components/welcome/WelcomeScreen'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { ToastContainer } from '@/components/ui/toast'
import { Footer } from '@/components/layout/Footer'
import { TerminalPanel } from '@/components/terminal/TerminalPanel'
import { useProjectStore } from '@/stores/project-store'
import { useChatStore } from '@/stores/chat-store'
import { useProviderStore } from '@/stores/provider-store'
import { useUIStore } from '@/stores/ui-store'
import { useToastStore } from '@/stores/toast-store'

export default function App() {
  const { currentProject, setProject, setRecentProjects } = useProjectStore()
  const { handleRuntimeEvent } = useChatStore()
  const { setProviders } = useProviderStore()
  const { terminalOpen, toggleTerminal } = useUIStore()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const unsubs: (() => void)[] = []
    let mounted = true

    // Register event listeners SYNCHRONOUSLY so cleanup works with React StrictMode
    unsubs.push(window.piStudio.pi.onEvent((event) => {
      handleRuntimeEvent(event)
    }))
    unsubs.push(window.piStudio.onGlobalShortcut((action) => {
      if (action === 'toggle-sidebar') useUIStore.getState().toggleSidebar()
      if (action === 'command-palette') useUIStore.getState().setSettingsOpen(true)
    }))
    unsubs.push(window.piStudio.project.onChange((cwd) => setProject(cwd)))
    unsubs.push(window.piStudio.notification.onNotify((msg, type) => {
      useToastStore.getState().addToast(msg, type as any)
    }))

    // Async initialization
    ;(async () => {
      try {
        const ui = await window.piStudio.settings.getUI()
        if (!mounted) return
        useUIStore.getState().setSidebarOpen(ui.sidebarOpen)
        useUIStore.getState().setSidebarWidth(ui.sidebarWidth)
        setRecentProjects(ui.recentProjects)
      } catch (err) { console.error('UI settings:', err) }

      // Restore last provider/model selection from PiSettings
      try {
        const settings = await window.piStudio.config.getSettings()
        if (!mounted) return
        if (settings.defaultProvider || settings.defaultModel) {
          useProviderStore.getState().restoreSelection(
            settings.defaultProvider ?? null,
            settings.defaultModel ?? null,
          )
        }
      } catch (err) { console.error('Restore selection:', err) }

      try {
        const providers = await window.piStudio.provider.list()
        if (!mounted) return
        setProviders(providers)
        // restoreSelection may have been called before providers loaded,
        // so re-apply now that we have the provider list
        try {
          const settings = await window.piStudio.config.getSettings()
          if (settings.defaultProvider || settings.defaultModel) {
            useProviderStore.getState().restoreSelection(
              settings.defaultProvider ?? null,
              settings.defaultModel ?? null,
            )
          }
        } catch { /* ignore */ }
      } catch (err) { console.error('Providers:', err) }

      if (mounted) setReady(true)
    })()

    return () => {
      mounted = false
      unsubs.forEach(fn => fn())
    }
  }, [])

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 animate-pulse">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
            <span className="text-lg font-bold text-white">π</span>
          </div>
          <span className="text-sm text-muted-foreground">Loading Pi Studio...</span>
        </div>
      </div>
    )
  }

  if (!currentProject) {
    return (
      <div className="flex flex-col h-screen bg-background">
        <TitleBar />
        <WelcomeScreen />
        <ToastContainer />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <TitleBar projectPath={currentProject} />
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <ChatTabBar />
          <ChatView />
          {terminalOpen && <TerminalPanel />}
        </div>
      </div>
      <Footer />
      <SettingsModal />
      <ToastContainer />
    </div>
  )
}
