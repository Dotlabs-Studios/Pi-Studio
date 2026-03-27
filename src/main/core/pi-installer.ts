/**
 * Pi Installer - Check, install, and update the pi CLI binary.
 *
 * Uses `which`/`where` to detect, `npm view` for latest version.
 */

import { execSync } from 'node:child_process'
import { promisify } from 'node:util'
import { exec } from 'node:child_process'

const execAsync = promisify(exec)

interface UpdateInfo {
  currentVersion: string
  latestVersion: string
}

class PiInstaller {
  /**
   * Check if pi CLI is installed and accessible.
   */
  async isInstalled(): Promise<boolean> {
    try {
      const cmd = process.platform === 'win32' ? 'where pi' : 'which pi'
      await execAsync(cmd, { timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the installed pi version.
   */
  async getInstalledVersion(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('pi --version', { timeout: 5000 })
      const version = stdout.trim()
      // pi --version returns something like "pi v1.2.3" or "1.2.3"
      return version.replace(/^pi\s*/i, '').replace(/^v/i, '')
    } catch {
      return null
    }
  }

  /**
   * Get the latest available version from npm.
   */
  async getLatestVersion(): Promise<string | null> {
    try {
      const { stdout } = await execAsync(
        'npm view @mariozechner/pi-coding-agent version',
        { timeout: 15000 }
      )
      return stdout.trim()
    } catch {
      return null
    }
  }

  /**
   * Check for updates.
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    const [current, latest] = await Promise.all([
      this.getInstalledVersion(),
      this.getLatestVersion(),
    ])

    if (!current || !latest) return null
    if (current === latest) return null

    return { currentVersion: current, latestVersion: latest }
  }

  /**
   * Install pi CLI globally via npm.
   */
  async install(): Promise<void> {
    await execAsync('npm install -g @mariozechner/pi-coding-agent', {
      timeout: 120000,
    })
  }

  /**
   * Update pi CLI to latest version.
   */
  async update(): Promise<void> {
    await execAsync('npm update -g @mariozechner/pi-coding-agent', {
      timeout: 120000,
    })
  }

  /**
   * Validate the installation by running a simple command.
   */
  async validateInstallation(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('pi --help', { timeout: 5000 })
      return stdout.length > 0
    } catch {
      return false
    }
  }
}

// Singleton
export const piInstaller = new PiInstaller()
