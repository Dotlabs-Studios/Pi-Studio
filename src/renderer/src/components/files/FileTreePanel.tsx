/**
 * FileTreePanel - Complete file browser with lazy loading.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/primitives'
import { useProjectStore } from '@/stores/project-store'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  size?: number
  modified?: number
}

// File extension icons (simple color coding)
const EXT_COLORS: Record<string, string> = {
  ts: 'text-blue-400',
  tsx: 'text-blue-400',
  js: 'text-yellow-400',
  jsx: 'text-yellow-400',
  json: 'text-yellow-300',
  md: 'text-gray-400',
  css: 'text-purple-400',
  scss: 'text-purple-400',
  html: 'text-orange-400',
  py: 'text-green-400',
  rs: 'text-orange-500',
  go: 'text-cyan-400',
  toml: 'text-gray-300',
  yaml: 'text-red-300',
  yml: 'text-red-300',
  sh: 'text-green-300',
  bash: 'text-green-300',
}

function getFileColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_COLORS[ext] ?? 'text-muted-foreground'
}

function formatSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileTreePanel() {
  const { currentProject } = useProjectStore()
  const [tree, setTree] = useState<FileNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  const loadTree = useCallback(async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const result = await window.piStudio.files.tree(currentProject)
      setTree(result)
      // Auto-expand root level
      setExpanded(new Set(result.map((n: FileNode) => n.path)))
    } catch (err) {
      console.error('Failed to load file tree:', err)
    }
    setLoading(false)
  }, [currentProject])

  useEffect(() => {
    loadTree()
  }, [loadTree])

  const toggleExpand = (nodePath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(nodePath)) next.delete(nodePath)
      else next.add(nodePath)
      return next
    })
  }

  const loadChildren = async (nodePath: string) => {
    try {
      const children = await window.piStudio.files.readdir(nodePath)
      setTree((prev) => {
        const updateChildren = (nodes: FileNode[]): FileNode[] =>
          nodes.map((n) => {
            if (n.path === nodePath) return { ...n, children }
            if (n.children) return { ...n, children: updateChildren(n.children) }
            return n
          })
        return updateChildren(prev)
      })
    } catch {
      // Ignore
    }
  }

  if (!currentProject) {
    return (
      <div className="text-xs text-muted-foreground text-center py-4 px-3">
        Open a project to browse files
      </div>
    )
  }

  // Filter by search
  const filterTree = (nodes: FileNode[], query: string): FileNode[] => {
    if (!query) return nodes
    const q = query.toLowerCase()
    return nodes.reduce<FileNode[]>((acc, node) => {
      if (node.name.toLowerCase().includes(q)) {
        acc.push(node)
      } else if (node.children) {
        const filtered = filterTree(node.children, query)
        if (filtered.length > 0) {
          acc.push({ ...node, children: filtered })
        }
      }
      return acc
    }, [])
  }

  const displayTree = filterTree(tree, search)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 pb-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1">
          Files
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={loadTree}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      <div className="px-3 pb-2">
        <Input
          placeholder="Filter files..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 text-xs"
        />
      </div>

      <ScrollArea className="flex-1 px-1">
        {loading ? (
          <div className="text-xs text-muted-foreground text-center py-4">Loading...</div>
        ) : displayTree.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            {search ? 'No matching files' : 'Empty directory'}
          </div>
        ) : (
          <FileNodeList
            nodes={displayTree}
            depth={0}
            expanded={expanded}
            onToggle={toggleExpand}
            onLoadChildren={loadChildren}
          />
        )}
      </ScrollArea>
    </div>
  )
}

function FileNodeList({
  nodes,
  depth,
  expanded,
  onToggle,
  onLoadChildren,
}: {
  nodes: FileNode[]
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  onLoadChildren: (path: string) => void
}) {
  return (
    <>
      {nodes.map((node) => (
        <FileNodeItem
          key={node.path}
          node={node}
          depth={depth}
          isExpanded={expanded.has(node.path)}
          onToggle={onToggle}
          onLoadChildren={onLoadChildren}
        />
      ))}
    </>
  )
}

function FileNodeItem({
  node,
  depth,
  isExpanded,
  onToggle,
  onLoadChildren,
}: {
  node: FileNode
  depth: number
  isExpanded: boolean
  onToggle: (path: string) => void
  onLoadChildren: (path: string) => void
}) {
  const isDir = node.type === 'directory'

  const handleClick = () => {
    if (isDir) {
      onToggle(node.path)
      // Lazy load children on first expand
      if (!isExpanded && (!node.children || node.children.length === 0)) {
        onLoadChildren(node.path)
      }
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        className={cn(
          'flex items-center gap-1 w-full px-1 py-0.5 rounded text-left transition-colors',
          'hover:bg-secondary/50 group',
        )}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        title={`${node.name}${node.size ? ` (${formatSize(node.size)})` : ''}`}
      >
        {/* Chevron */}
        {isDir ? (
          isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
          )
        ) : (
          <span className="w-3.5" />
        )}

        {/* Icon */}
        {isDir ? (
          isExpanded ? (
            <FolderOpen className="w-4 h-4 text-primary/70 shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-primary/70 shrink-0" />
          )
        ) : (
          <File className={cn('w-4 h-4 shrink-0', getFileColor(node.name))} />
        )}

        {/* Name */}
        <span className="text-xs text-foreground/80 truncate flex-1">
          {node.name}
        </span>

        {/* Size */}
        {node.size && (
          <span className="text-[10px] text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            {formatSize(node.size)}
          </span>
        )}
      </button>

      {/* Children */}
      {isDir && isExpanded && node.children && node.children.length > 0 && (
        <FileNodeList
          nodes={node.children}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onLoadChildren={onLoadChildren}
        />
      )}
    </>
  )
}
