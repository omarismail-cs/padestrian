'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface PedestrianToggleProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  className?: string
  ariaLabel?: string
}

function HandIcon({ className }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      className={className} 
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        d="M8.5 11V6.5a1.25 1.25 0 0 1 2.5 0V10M11 10V5.7a1.25 1.25 0 1 1 2.5 0V10M13.5 10V6.3a1.25 1.25 0 1 1 2.5 0V11.2M6 11.8v-.9a1.25 1.25 0 1 1 2.5 0V13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 13v2.2c0 2.6 2.1 4.8 4.8 4.8h2.4c2.9 0 5.2-2.3 5.2-5.2V11"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function WalkIcon({ className }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 24 24"
      fill="currentColor" 
      className={className} 
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      <path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 21.5h2.1l1.9-8.2 2.1 2V21.5h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.1 2.5 5.4 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.7-1.2-1-2-1-.3 0-.6.1-.9.2L6 8.3V13h2V9.6l1.8-.7z" />
    </svg>
  )
}

const EASE = 'ease-[cubic-bezier(0.22,1,0.36,1)]'

function PedestrianToggle({
  checked,
  onCheckedChange,
  className,
  ariaLabel,
}: PedestrianToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? 'Toggle'}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 cursor-pointer items-center justify-center rounded-full border',
        'transition-[background-color,border-color,box-shadow,scale] duration-[420ms] active:scale-95',
        EASE,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
        checked
          ? 'border-brand/60 bg-brand/15 shadow-[0_0_14px_color-mix(in_srgb,var(--brand)_35%,transparent)]'
          : 'border-[#d88758]/45 bg-[#d88758]/10 shadow-[0_0_14px_transparent]',
        className,
      )}
    >
      <span
        className={cn(
          'absolute inset-0 rounded-full shadow-[inset_0_0_10px_color-mix(in_srgb,var(--brand)_45%,transparent)] transition-opacity duration-[420ms] motion-reduce:transition-none',
          EASE,
          checked ? 'opacity-100' : 'opacity-0',
        )}
      />
      {/* Both icons stay mounted so they crossfade instead of swapping */}
      <span className="relative z-10 h-5 w-5 flex-shrink-0">
        <span
          className={cn(
            'absolute inset-0 flex items-center justify-center text-brand transition-[opacity,scale,rotate] duration-[420ms] motion-reduce:transition-none',
            EASE,
            checked ? 'scale-100 rotate-0 opacity-100' : 'scale-50 -rotate-12 opacity-0',
          )}
        >
          <WalkIcon className="h-5 w-5 flex-shrink-0" />
        </span>
        <span
          className={cn(
            'absolute inset-0 flex items-center justify-center text-[#d88758] transition-[opacity,scale,rotate] duration-[420ms] motion-reduce:transition-none',
            EASE,
            checked ? 'scale-50 rotate-12 opacity-0' : 'scale-100 rotate-0 opacity-100',
          )}
        >
          <HandIcon className="h-5 w-5 flex-shrink-0" />
        </span>
      </span>
    </button>
  )
}

export { PedestrianToggle }
