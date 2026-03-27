/**
 * Event Bus - Central event system for decoupled communication.
 *
 * Used by all core modules to emit and subscribe to events.
 * The main process EventBus forwards events to the renderer via IPC.
 */

import type { RuntimeEvent } from '../shared/types'

type EventHandler<T = unknown> = (event: T) => void

class EventBus {
  private handlers = new Map<string, Set<EventHandler>>()
  private onceHandlers = new Map<string, Set<EventHandler>>()

  /**
   * Emit an event to all listeners.
   */
  emit<T extends RuntimeEvent>(event: T): void {
    const type = event.type
    const handlers = this.handlers.get(type)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event)
        } catch (err) {
          console.error(`[EventBus] Error in handler for "${type}":`, err)
        }
      }
    }
    // Handle once handlers
    const once = this.onceHandlers.get(type)
    if (once) {
      for (const handler of once) {
        try {
          handler(event)
        } catch (err) {
          console.error(`[EventBus] Error in once handler for "${type}":`, err)
        }
      }
      this.onceHandlers.delete(type)
    }

    // Wildcard handlers
    const wildcard = this.handlers.get('*')
    if (wildcard) {
      for (const handler of wildcard) {
        try {
          handler(event)
        } catch (err) {
          console.error(`[EventBus] Error in wildcard handler:`, err)
        }
      }
    }
  }

  /**
   * Subscribe to events of a specific type.
   * Returns an unsubscribe function.
   */
  on<T extends RuntimeEvent['type']>(
    type: T | '*',
    handler: EventHandler
  ): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler)
    return () => {
      this.handlers.get(type)?.delete(handler)
    }
  }

  /**
   * Subscribe to the next occurrence of an event, then auto-unsubscribe.
   */
  once<T extends RuntimeEvent['type']>(
    type: T,
    handler: EventHandler
  ): () => void {
    if (!this.onceHandlers.has(type)) {
      this.onceHandlers.set(type, new Set())
    }
    this.onceHandlers.get(type)!.add(handler)
    return () => {
      this.onceHandlers.get(type)?.delete(handler)
    }
  }

  /**
   * Remove all handlers for a specific type (or all if no type).
   */
  off(type?: string): void {
    if (type) {
      this.handlers.delete(type)
      this.onceHandlers.delete(type)
    } else {
      this.handlers.clear()
      this.onceHandlers.clear()
    }
  }

  /**
   * Get the number of listeners for a type.
   */
  listenerCount(type?: string): number {
    if (!type) {
      let total = 0
      for (const [, handlers] of this.handlers) total += handlers.size
      for (const [, handlers] of this.onceHandlers) total += handlers.size
      return total
    }
    return (this.handlers.get(type)?.size ?? 0) + (this.onceHandlers.get(type)?.size ?? 0)
  }
}

// Singleton instance
export const eventBus = new EventBus()
export { EventBus }
