/**
 * ScrollArea, Badge, Tooltip, Separator, Switch, Dialog, Select components
 * Minimal shadcn-style implementations using Radix UI primitives where available.
 */

import React, { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ============================================================================
// ScrollArea
// ============================================================================

export function ScrollArea({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('relative overflow-auto custom-scrollbar', className)} {...props}>
      {children}
    </div>
  )
}

// ============================================================================
// Badge
// ============================================================================

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning'
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
        {
          'bg-primary/20 text-primary': variant === 'default',
          'bg-secondary text-secondary-foreground': variant === 'secondary',
          'bg-destructive/20 text-destructive': variant === 'destructive',
          'border border-border text-foreground': variant === 'outline',
          'bg-green-500/20 text-green-400': variant === 'success',
          'bg-orange-500/20 text-orange-400': variant === 'warning',
        },
        className
      )}
      {...props}
    />
  )
}

// ============================================================================
// Tooltip
// ============================================================================

export function Tooltip({ children, content }: { children: ReactNode; content: string }) {
  return (
    <div className="group relative inline-flex">
      {children}
      <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="whitespace-nowrap rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-lg border border-border">
          {content}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Separator
// ============================================================================

export function Separator({ className, orientation = 'horizontal' }: { className?: string; orientation?: 'horizontal' | 'vertical' }) {
  return (
    <div
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className
      )}
    />
  )
}

// ============================================================================
// Switch
// ============================================================================

interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

export function Switch({ checked, onCheckedChange, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-secondary',
        className
      )}
    >
      <span
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0'
        )}
      />
    </button>
  )
}

// ============================================================================
// Dialog
// ============================================================================

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  /** Override the max-width. Default: 'max-w-lg' */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  className?: string
}

const dialogSizes: Record<string, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  full: 'max-w-[95vw]',
}

export function Dialog({ open, onOpenChange, children, size = 'md', className }: DialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={() => onOpenChange(false)}
      />
      {/* Content */}
      <div className={cn(
        'relative z-10 w-full overflow-auto rounded-xl border border-border bg-card shadow-2xl animate-slide-up',
        'max-h-[90vh]',
        dialogSizes[size] ?? dialogSizes.md,
        className
      )}>
        {children}
      </div>
    </div>
  )
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left mb-4', className)} {...props} />
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-lg font-semibold leading-none tracking-tight', className)} {...props} />
}

export function DialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />
}

// ============================================================================
// Select
// ============================================================================

interface SelectProps {
  value: string | null
  onValueChange: (value: string) => void
  children: ReactNode
  className?: string
}

export function Select({ value, onValueChange, children, className }: SelectProps) {
  return (
    <div className={cn('relative', className)}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child) && (child.type as any).displayName === 'SelectTrigger') {
          return React.cloneElement(child as any, { value, onValueChange })
        }
        return child
      })}
    </div>
  )
}

interface SelectTriggerProps {
  value: string | null
  onValueChange: (value: string) => void
  children: ReactNode
  className?: string
  placeholder?: string
}

export function SelectTrigger({ value, onValueChange, children, className, placeholder }: SelectTriggerProps) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm',
          'hover:bg-secondary/50 transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-ring',
          className
        )}
      >
        <span className={value ? 'text-foreground' : 'text-muted-foreground'}>
          {value || placeholder || 'Select...'}
        </span>
        <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full z-50 mt-1 w-full min-w-[8rem] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-xl animate-fade-in">
          {React.Children.map(children, (child) => {
            if (React.isValidElement(child)) {
              return React.cloneElement(child as any, {
                onSelect: (v: string) => {
                  onValueChange(v)
                  setOpen(false)
                },
                isSelected: (v: string) => v === value,
              })
            }
            return child
          })}
        </div>
      )}
    </div>
  )
}

interface SelectItemProps {
  value: string
  children: ReactNode
  onSelect?: (value: string) => void
  isSelected?: (value: string) => boolean
  className?: string
}

export function SelectItem({ value, children, onSelect, isSelected, className }: SelectItemProps) {
  const selected = isSelected?.(value) ?? false

  return (
    <button
      type="button"
      onClick={() => onSelect?.(value)}
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none transition-colors',
        'hover:bg-secondary/80 focus:bg-secondary/80',
        selected && 'bg-secondary/50',
        className
      )}
    >
      {selected && (
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
          <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
      <span className={selected ? 'text-foreground' : 'text-muted-foreground'}>{children}</span>
    </button>
  )
}

// ============================================================================
// Tabs
// ============================================================================

interface TabsProps {
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
  className?: string
}

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  return (
    <div className={className} data-tabs-value={value} data-tabs-on-change={onValueChange as any}>
      {children}
    </div>
  )
}

interface TabsListProps {
  children: ReactNode
  className?: string
}

export function TabsList({ children, className }: TabsListProps) {
  return (
    <div className={cn('inline-flex h-9 items-center justify-center rounded-lg bg-secondary/50 p-1 text-muted-foreground', className)}>
      {children}
    </div>
  )
}

interface TabsTriggerProps {
  value: string
  children: ReactNode
  className?: string
  onClick?: () => void
  isActive?: boolean
}

export function TabsTrigger({ value, children, className, onClick, isActive }: TabsTriggerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isActive
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
        className
      )}
      data-state={isActive ? 'active' : 'inactive'}
    >
      {children}
    </button>
  )
}

interface TabsContentProps {
  value: string
  children: ReactNode
  className?: string
}

export function TabsContent({ children, className }: TabsContentProps) {
  return (
    <div className={cn('mt-2', className)}>
      {children}
    </div>
  )
}

// ============================================================================
// Textarea
// ============================================================================

interface TextareaProps extends HTMLAttributes<HTMLTextAreaElement> {
  label?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label className="text-sm font-medium text-foreground/80">{label}</label>
        )}
        <textarea
          ref={ref}
          className={cn(
            'flex min-h-[80px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-sm',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'resize-none',
            className
          )}
          {...props}
        />
      </div>
    )
  }
)
Textarea.displayName = 'Textarea'
