/**
 * Welcome Screen - Shown when no project is open.
 */

import React, { useEffect, useState } from 'react'
import {
  FolderOpen, FolderPlus, Clock, ArrowRight,
  RefreshCw, Download,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useProjectStore } from '@/stores/project-store'
import { useToastStore } from '@/stores/toast-store'

export function WelcomeScreen() {
  const { setProject, setRecentProjects } = useProjectStore()
  const [recentProjects, setLocalRecent] = useState<string[]>([])
  const [piVersion, setPiVersion] = useState<string | null>(null)
  const [piInstalled, setPiInstalled] = useState(false)
  const { addToast } = useToastStore()

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      const recent = await window.piStudio.project.getRecent()
      setLocalRecent(recent)
      setRecentProjects(recent)
      const installed = await window.piStudio.installer.isInstalled()
      setPiInstalled(installed)
      if (installed) setPiVersion(await window.piStudio.installer.getVersion())
    } catch (err) { console.error(err) }
  }

  const handleOpenFolder = async () => {
    const cwd = await window.piStudio.project.open()
    if (cwd) { setProject(cwd); addToast(`Opened: ${cwd.split(/[\\/]/).pop()}`, 'success') }
  }

  const handleSelectProject = (path: string) => {
    setProject(path)
    addToast(`Opened: ${path.split(/[\\/]/).pop()}`, 'info')
  }

  const handleCreateProject = async () => {
    const name = prompt('Enter project name:')
    if (!name) return
    const cwd = await window.piStudio.project.create(name)
    setProject(cwd)
    addToast('Project created', 'success')
  }

  const handleInstallPi = async () => {
    addToast('Installing pi CLI...', 'info', 10000)
    try {
      await window.piStudio.installer.install()
      addToast('pi CLI installed!', 'success')
      loadData()
    } catch (err: any) {
      addToast(`Install failed: ${err.message}`, 'error')
    }
  }

  const handleUpdatePi = async () => {
    addToast('Updating pi CLI...', 'info', 10000)
    try {
      await window.piStudio.installer.update()
      addToast('pi CLI updated!', 'success')
      loadData()
    } catch (err: any) {
      addToast(`Update failed: ${err.message}`, 'error')
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="w-full max-w-lg px-8">
        <div className="flex flex-col items-center mb-10 animate-fade-in">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center mb-4 shadow-lg shadow-primary/20">
            <span className="text-2xl font-bold text-white">π</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Pi Studio</h1>
          <p className="text-sm text-muted-foreground mt-1">Desktop GUI for pi coding agent</p>
        </div>

        <div className="space-y-3 animate-slide-up">
          <Button variant="default" className="w-full h-12 justify-start gap-3 text-base" onClick={handleOpenFolder}>
            <FolderOpen className="w-5 h-5" />
            Open Folder
            <span className="text-xs text-primary-foreground/40 ml-auto">Ctrl+O</span>
          </Button>
          <Button variant="secondary" className="w-full h-12 justify-start gap-3 text-base" onClick={handleCreateProject}>
            <FolderPlus className="w-5 h-5" />
            New Project
          </Button>
        </div>

        {recentProjects.length > 0 && (
          <div className="mt-8 animate-fade-in">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent</span>
            </div>
            <div className="space-y-1">
              {recentProjects.slice(0, 5).map(project => (
                <button key={project} onClick={() => handleSelectProject(project)}
                  className="flex items-center gap-3 w-full px-4 py-3 rounded-lg hover:bg-secondary/50 transition-colors text-left group">
                  <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm text-foreground truncate flex-1">{project}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-border">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div className={cn('w-2 h-2 rounded-full', piInstalled ? 'bg-green-400' : 'bg-destructive')} />
              <span className="text-muted-foreground">
                {piInstalled ? `pi v${piVersion}` : 'pi CLI not found'}
              </span>
            </div>
            {!piInstalled ? (
              <Button variant="link" size="sm" className="text-xs h-auto p-0" onClick={handleInstallPi}>
                Install pi
              </Button>
            ) : (
              <Button variant="link" size="sm" className="text-xs h-auto p-0" onClick={handleUpdatePi}>
                <RefreshCw className="w-3 h-3 mr-1" />Check updates
              </Button>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-center gap-6 text-[10px] text-muted-foreground/30">
          <span>Ctrl+B Toggle sidebar</span>
          <span>Ctrl+, Settings</span>
          <span>Ctrl+Shift+N New chat</span>
        </div>
      </div>
    </div>
  )
}
