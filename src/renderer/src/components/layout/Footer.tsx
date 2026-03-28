/**
 * Footer - Shows token usage, cost, and session info.
 */

import React from 'react'
import {
  Coins,
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
} from 'lucide-react'
import { useChatStore } from '@/stores/chat-store'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0.00'
  if (cost < 0.01) return `<$0.01`
  return `$${cost.toFixed(2)}`
}

export function Footer() {
  const {
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    totalCost,
    lastUsage,
    isStreaming,
  } = useChatStore()

  const totalTokens = totalInputTokens + totalOutputTokens
  const hasData = totalTokens > 0 || totalCost > 0

  if (!hasData && !isStreaming) return null

  return (
    <div className="flex items-center h-7 px-3 gap-3 border-t border-border/50 bg-background/80 text-[11px] text-muted-foreground select-none">
      {/* Input tokens */}
      <div className="flex items-center gap-1" title="Input tokens">
        <ArrowDownToLine className="w-3 h-3 text-blue-400" />
        <span>{formatTokens(totalInputTokens)}</span>
      </div>

      {/* Output tokens */}
      <div className="flex items-center gap-1" title="Output tokens">
        <ArrowUpFromLine className="w-3 h-3 text-green-400" />
        <span>{formatTokens(totalOutputTokens)}</span>
      </div>

      {/* Cache tokens */}
      {(totalCacheReadTokens > 0 || totalCacheWriteTokens > 0) && (
        <div className="flex items-center gap-1" title={`Cache: ${formatTokens(totalCacheReadTokens)} read, ${formatTokens(totalCacheWriteTokens)} write`}>
          <Database className="w-3 h-3 text-amber-400" />
          <span>{formatTokens(totalCacheReadTokens + totalCacheWriteTokens)}</span>
        </div>
      )}

      {/* Cost */}
      <div className="flex items-center gap-1" title="Total cost">
        <Coins className="w-3 h-3 text-yellow-400" />
        <span>{formatCost(totalCost)}</span>
      </div>

      {/* Last turn usage (dimmed) */}
      {lastUsage && (
        <span className="ml-auto text-muted-foreground/50">
          last: {formatTokens(lastUsage.totalTokens)} tokens
        </span>
      )}
    </div>
  )
}
