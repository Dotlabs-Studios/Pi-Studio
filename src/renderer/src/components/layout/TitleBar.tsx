/**
 * Title Bar - Custom frameless window title bar.
 */

import React from 'react'
import { cn } from '@/lib/utils'

interface TitleBarProps {
  projectPath?: string | null
}

export function TitleBar({ projectPath }: TitleBarProps) {
  return (
    <div className="titlebar-drag flex h-9 items-center justify-between px-4 border-b border-border bg-card/50 select-none">
      {/* Left: App name + project */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 titlebar-no-drag">
          <div className="w-5 h-5 rounded-md bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
            <span className="text-[10px] font-bold text-white">π</span>
          </div>
          <span className="text-sm font-semibold text-foreground">Pi Studio</span>
        </div>
        {projectPath && (
          <>
            <span className="text-muted-foreground/40">—</span>
            <span className="text-xs text-muted-foreground truncate max-w-[300px]">
              {projectPath.split(/[\\/]/).pop()}
            </span>
          </>
        )}
      </div>

      {/* Center: empty (drag area) */}
      <div className="flex-1" />

      {/* Right: Window controls */}
      <div className="titlebar-no-drag flex items-center gap-1 -mr-2">
        <WindowControl
          icon={
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect y="4.5" width="10" height="1" fill="currentColor" />
            </svg>
          }
          onClick={() => window.piStudio.window.minimize()}
          hoverClass="hover:bg-secondary"
        />
        <WindowControl
          icon={
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          }
          onClick={() => window.piStudio.window.maximize()}
          hoverClass="hover:bg-secondary"
        />
        <WindowControl
          icon={
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          }
          onClick={() => window.piStudio.window.close()}
          hoverClass="hover:bg-destructive hover:text-destructive-foreground"
        />
      </div>
    </div>
  )
}

function WindowControl({
  icon,
  onClick,
  hoverClass,
}: {
  icon: React.ReactNode
  onClick: () => void
  hoverClass: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center justify-center w-11 h-9 text-muted-foreground transition-colors',
        hoverClass
      )}
    >
      {icon}
    </button>
  )
}
