/**
 * ToastContainer - Renders floating toasts in bottom-right corner.
 */

import React from 'react'
import { cn } from '@/lib/utils'
import { useToastStore } from '@/stores/toast-store'
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react'

const ICONS = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
}

const COLORS = {
  info: 'border-primary/40 bg-primary/10 text-primary',
  success: 'border-green-500/40 bg-green-500/10 text-green-400',
  warning: 'border-orange-500/40 bg-orange-500/10 text-orange-400',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore()

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type]
        return (
          <div
            key={toast.id}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-xl shadow-lg',
              'animate-slide-in-left pointer-events-auto min-w-[280px] max-w-[420px]',
              COLORS[toast.type]
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="text-sm flex-1">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 hover:opacity-70 transition-opacity"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
