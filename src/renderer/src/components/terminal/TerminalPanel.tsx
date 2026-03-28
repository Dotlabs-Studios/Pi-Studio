/**
 * TerminalPanel - Tabbed integrated terminal using xterm.js.
 *
 * Supports multiple terminal tabs, each with its own pty session.
 * Switching tabs preserves terminal state (scrollback, running processes).
 */

import React, { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/stores/project-store'
import { useUIStore } from '@/stores/ui-store'
import { useToastStore } from '@/stores/toast-store'

const TERMINAL_MIN_HEIGHT = 120
const TERMINAL_MAX_HEIGHT = 600

// Shared xterm options for all instances
const XTERM_OPTIONS: Partial<typeof Terminal.prototype.options> = {
  cursorBlink: true,
  fontSize: 13,
  fontFamily: 'Cascadia Code, Fira Code, JetBrains Mono, Menlo, Monaco, Consolas, monospace',
  theme: {
    background: '#0d0d1a',
    foreground: '#d4d4d4',
    cursor: '#a0a0ff',
    cursorAccent: '#0d0d1a',
    selectionBackground: '#264f78',
    selectionForeground: '#ffffff',
    black: '#0c0c0c',
    red: '#c50f1f',
    green: '#13a10e',
    yellow: '#c19c00',
    blue: '#0037da',
    magenta: '#881798',
    cyan: '#3a96dd',
    white: '#cccccc',
    brightBlack: '#767676',
    brightRed: '#e74856',
    brightGreen: '#16c60c',
    brightYellow: '#f9f1a5',
    brightBlue: '#3b78ff',
    brightMagenta: '#b4009e',
    brightCyan: '#61d6d6',
    brightWhite: '#f2f2f2',
  },
  allowTransparency: false,
  scrollback: 5000,
  convertEol: false,
}

interface TabSession {
  id: string           // UI tab id
  ptyId: string        // pty session id
  term: Terminal       // xterm instance
  fitAddon: FitAddon
  container: HTMLDivElement
  inputDisposable: { dispose(): void }
  unsubPtyData: () => void
  label: string
}

let tabCounter = 0

export function TerminalPanel() {
  const { currentProject } = useProjectStore()
  const { terminalHeight, setTerminalHeight } = useUIStore()
  const { addToast } = useToastStore()

  const tabsRef = useRef<Map<string, TabSession>>(new Map())
  const activeTabIdRef = useRef<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const resizingRef = useRef(false)
  const startYRef = useRef(0)
  const startHeightRef = useRef(0)

  // Force re-render for tab list
  const [tabs, setTabs] = useState<string[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  const notifyTabsChanged = useCallback(() => {
    setTabs([...tabsRef.current.keys()])
    setActiveTabId(activeTabIdRef.current)
  }, [])

  // ── Create a new tab & pty session ──
  const createTab = useCallback(async () => {
    if (!currentProject || !containerRef.current) return null

    tabCounter++
    const tabId = `tab_${Date.now()}_${tabCounter}`

    // Create DOM container for this tab's xterm
    const el = document.createElement('div')
    el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;padding:2px 4px;'
    el.style.display = 'none'
    containerRef.current.appendChild(el)

    // Create xterm instance
    const term = new Terminal(XTERM_OPTIONS)
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(el)

    // Create pty session
    let ptyId: string
    try {
      ptyId = await window.piStudio.terminal.create(currentProject)
    } catch (err: any) {
      term.writeln(`\x1b[91mFailed to start terminal: ${err.message}\x1b[0m`)
      el.remove()
      term.dispose()
      addToast('Failed to start terminal', 'error')
      return null
    }

    // Listen for pty output → write to xterm
    const unsubPtyData = window.piStudio.terminal.onData((pid, data) => {
      const tab = tabsRef.current.get(tabId)
      if (tab && pid === tab.ptyId) {
        tab.term.write(data)
      }
    })

    // User input → pty
    const inputDisposable = term.onData((data) => {
      const tab = tabsRef.current.get(tabId)
      if (tab) {
        window.piStudio.terminal.write(tab.ptyId, data)
      }
    })

    // Update tab label when title changes (e.g. shell sets window title)
    term.onTitleChange((title: string) => {
      const tab = tabsRef.current.get(tabId)
      if (tab) {
        tab.label = title || `Terminal ${tabCounter}`
        notifyTabsChanged()
      }
    })

    const label = `Terminal ${tabCounter}`

    tabsRef.current.set(tabId, {
      id: tabId,
      ptyId,
      term,
      fitAddon,
      container: el,
      inputDisposable,
      unsubPtyData,
      label,
    })

    // Activate the new tab
    activateTab(tabId)
    notifyTabsChanged()

    return tabId
  }, [currentProject, addToast, notifyTabsChanged])

  // ── Activate a tab (show its xterm, hide others) ──
  const activateTab = useCallback((tabId: string) => {
    const target = tabsRef.current.get(tabId)
    if (!target) return

    // Hide all
    for (const [, tab] of tabsRef.current) {
      tab.container.style.display = 'none'
    }

    // Show target
    target.container.style.display = ''
    activeTabIdRef.current = tabId

    // Fit after paint
    requestAnimationFrame(() => {
      try {
        target.fitAddon.fit()
      } catch { /* ignore */ }
      target.term.focus()
    })

    notifyTabsChanged()
  }, [notifyTabsChanged])

  // ── Close a tab ──
  const closeTab = useCallback((tabId: string) => {
    const tab = tabsRef.current.get(tabId)
    if (!tab) return

    // Cleanup
    tab.inputDisposable.dispose()
    tab.unsubPtyData()
    window.piStudio.terminal.kill(tab.ptyId)
    tab.term.dispose()
    tab.container.remove()
    tabsRef.current.delete(tabId)

    // If we closed the active tab, activate another
    if (activeTabIdRef.current === tabId) {
      const remaining = [...tabsRef.current.keys()]
      if (remaining.length > 0) {
        activateTab(remaining[remaining.length - 1])
      } else {
        activeTabIdRef.current = null
      }
    }

    notifyTabsChanged()
  }, [activateTab, notifyTabsChanged])

  // ── Create first tab on mount or project change ──
  useEffect(() => {
    if (!currentProject) return

    // Kill all existing tabs when project changes
    for (const [tid] of tabsRef.current) {
      closeTab(tid)
    }

    // Create initial tab
    createTab()

    return () => {
      // Cleanup all tabs on unmount
      for (const [, tab] of tabsRef.current) {
        tab.inputDisposable.dispose()
        tab.unsubPtyData()
        window.piStudio.terminal.kill(tab.ptyId)
        tab.term.dispose()
        tab.container.remove()
      }
      tabsRef.current.clear()
      activeTabIdRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject])

  // ── Window resize → fit active tab ──
  useEffect(() => {
    const handleResize = () => {
      setTimeout(() => {
        if (activeTabIdRef.current) {
          const tab = tabsRef.current.get(activeTabIdRef.current)
          if (tab) try { tab.fitAddon.fit() } catch { /* ignore */ }
        }
      }, 100)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // ── Resize handle ──
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    startYRef.current = e.clientY
    startHeightRef.current = terminalHeight

    const handleMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const delta = startYRef.current - ev.clientY
      const newHeight = Math.min(TERMINAL_MAX_HEIGHT, Math.max(TERMINAL_MIN_HEIGHT, startHeightRef.current + delta))
      setTerminalHeight(newHeight)
    }

    const handleUp = () => {
      resizingRef.current = false
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      setTimeout(() => {
        if (activeTabIdRef.current) {
          const tab = tabsRef.current.get(activeTabIdRef.current)
          if (tab) try { tab.fitAddon.fit() } catch { /* ignore */ }
        }
      }, 50)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [terminalHeight, setTerminalHeight])

  return (
    <div
      className="flex flex-col border-t border-border bg-[#0d0d1a] relative"
      style={{ height: terminalHeight }}
    >
      {/* Resize handle */}
      <div
        className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize z-10 hover:bg-primary/20 transition-colors"
        onMouseDown={handleResizeStart}
      />

      {/* Tab bar */}
      <div className="flex items-center h-8 border-b border-border/50 bg-[#0d0d1a] shrink-0 overflow-x-auto">
        <div className="flex items-center gap-0 flex-1 min-w-0">
          {tabs.map((tabId) => {
            const tab = tabsRef.current.get(tabId)
            if (!tab) return null
            const isActive = tabId === activeTabId
            return (
              <div
                key={tabId}
                className={cn(
                  'group flex items-center gap-1.5 h-full px-3 cursor-pointer border-r border-border/30 select-none shrink-0',
                  isActive
                    ? 'bg-[#14142a] text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-[#12122a]'
                )}
                onClick={() => activateTab(tabId)}
              >
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    isActive ? 'bg-green-400' : 'bg-muted-foreground/40'
                  )}
                />
                <span className="text-[11px] font-medium truncate max-w-[140px]">
                  {tab.label}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tabId)
                  }}
                  className="h-4 w-4 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-all shrink-0"
                  title="Close tab"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            )
          })}
        </div>

        {/* New tab button */}
        <button
          onClick={() => createTab()}
          className="h-8 w-8 flex items-center justify-center hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="New Terminal (Tab)"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Terminal containers — all positioned absolute, only active one is visible */}
      <div ref={containerRef} className="flex-1 overflow-hidden relative" />
    </div>
  )
}
