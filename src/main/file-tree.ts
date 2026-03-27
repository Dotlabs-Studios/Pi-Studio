/**
 * File Tree Browser - IPC handlers for reading directories.
 */
import { ipcMain, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
  size?: number
  modified?: number
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'out', 'build', '__pycache__',
  '.venv', 'venv', 'target', '.gradle', '.cache', '.turbo'
])
const IGNORED_FILES = new Set([
  '.DS_Store', 'Thumbs.db', '.gitkeep'
])
const MAX_DEPTH = 6
const MAX_CHILDREN_PER_DIR = 200

function isIgnored(name: string, isDir: boolean): boolean {
  if (isDir) return IGNORED_DIRS.has(name)
  return IGNORED_FILES.has(name)
}

function buildTree(dirPath: string, depth: number = 0): FileTreeNode[] {
  if (depth > MAX_DEPTH) return []

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => !isIgnored(e.name, e.isDirectory()))
      .sort((a, b) => {
        // Directories first
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      })
      .slice(0, MAX_CHILDREN_PER_DIR)

    const nodes: FileTreeNode[] = []

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      try {
        const stat = fs.statSync(fullPath)
        const node: FileTreeNode = {
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: entry.isFile() ? stat.size : undefined,
          modified: stat.mtimeMs,
        }
        if (entry.isDirectory()) {
          node.children = buildTree(fullPath, depth + 1)
        }
        nodes.push(node)
      } catch {
        // Skip files we can't read
      }
    }

    return nodes
  } catch {
    return []
  }
}

/**
 * Read the immediate children of a directory (lazy loading).
 */
function readDir(dirPath: string): FileTreeNode[] {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => !isIgnored(e.name, e.isDirectory()))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      })
      .slice(0, MAX_CHILDREN_PER_DIR)

    return entries.map(entry => {
      const fullPath = path.join(dirPath, entry.name)
      try {
        const stat = fs.statSync(fullPath)
        return {
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory() ? 'directory' : 'file',
          children: entry.isDirectory() ? [] as FileTreeNode[] : undefined,
          size: entry.isFile() ? stat.size : undefined,
          modified: stat.mtimeMs,
        } as FileTreeNode
      } catch {
        return null
      }
    }).filter(Boolean) as FileTreeNode[]
  } catch {
    return []
  }
}

/**
 * Read file content.
 */
function readFile(filePath: string): { content: string; encoding: string } | null {
  try {
    const buffer = fs.readFileSync(filePath)
    // Try to detect encoding
    const isBinary = buffer.some((byte, i) => i < 8000 && byte === 0)
    if (isBinary) return null
    return { content: buffer.toString('utf-8'), encoding: 'utf-8' }
  } catch {
    return null
  }
}

export function registerFileTreeHandlers(): void {
  ipcMain.handle('files:tree', async (_event, cwd: string) => {
    return buildTree(cwd, 0)
  })

  ipcMain.handle('files:readdir', async (_event, dirPath: string) => {
    return readDir(dirPath)
  })

  ipcMain.handle('files:read', async (_event, filePath: string) => {
    return readFile(filePath)
  })

  ipcMain.handle('files:stat', async (_event, filePath: string) => {
    try {
      const stat = fs.statSync(filePath)
      return {
        name: path.basename(filePath),
        path: filePath,
        type: stat.isDirectory() ? 'directory' : 'file',
        size: stat.size,
        modified: stat.mtimeMs,
        created: stat.birthtimeMs,
      }
    } catch {
      return null
    }
  })

  console.log('[IPC] File tree handlers registered')
}
