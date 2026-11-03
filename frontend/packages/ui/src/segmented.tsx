/**
 * Segmented control: a mutually-exclusive choice rendered as one visible
 * option per segment (no dropdown round-trip). Standard radiogroup semantics:
 * `role="radiogroup"` + `role="radio"` children, roving tabindex (Tab enters
 * the selected segment only), arrow keys move the selection and the focus,
 * Home/End jump to the first/last enabled segment. Disabled segments are
 * skipped. Picking fires immediately (no confirm step), matching the native
 * radio behavior the settings rows replace.
 *
 * Styling comes from segmented.css (gs-seg* classes, token colors only).
 */
import React, { useRef } from 'react'

export interface SegmentedOption<K extends string = string> {
  readonly value: K
  readonly label: string
  readonly disabled?: boolean
}

/** index of the next enabled option from `start` in `step` direction, wrapping */
function nextEnabled(
  options: ReadonlyArray<{ readonly disabled?: boolean }>,
  start: number,
  step: 1 | -1,
): number {
  const n = options.length
  for (let i = 0; i < n; i += 1) {
    const idx = (((start + i * step) % n) + n) % n
    if (!options[idx]?.disabled) return idx
  }
  return -1
}

export function SegmentedControl<K extends string>({
  value,
  options,
  onPick,
  className,
  ariaLabel,
  disabled,
}: {
  readonly value: K
  readonly options: ReadonlyArray<SegmentedOption<K>>
  readonly onPick: (value: K) => void
  /** Extra class on the wrapper (apps size the control there). */
  readonly className?: string
  /** Accessible name for the group. */
  readonly ariaLabel?: string
  /** Disables the whole group (every segment). */
  readonly disabled?: boolean
}): React.JSX.Element {
  const groupRef = useRef<HTMLDivElement>(null)

  const pick = (option: SegmentedOption<K>) => {
    if (disabled || option.disabled) return
    if (option.value !== value) onPick(option.value)
  }

  const move = (start: number, step: 1 | -1) => {
    const next = nextEnabled(options, start, step)
    if (next < 0) return
    const option = options[next]!
    onPick(option.value)
    // roving focus follows the selection
    groupRef.current?.querySelectorAll<HTMLButtonElement>('.gs-seg-radio')[next]?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const current = options.findIndex((o) => o.value === value)
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        move(current < 0 ? 0 : current + 1, 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        move(current < 0 ? options.length - 1 : current - 1, -1)
        break
      case 'Home': {
        e.preventDefault()
        const first = nextEnabled(options, 0, 1)
        if (first >= 0) onPick(options[first]!.value)
        break
      }
      case 'End': {
        e.preventDefault()
        const last = nextEnabled(options, options.length - 1, -1)
        if (last >= 0) onPick(options[last]!.value)
        break
      }
      default:
    }
  }

  // The selected radio is the only tab stop; when the value is off-list (e.g.
  // a stored option that no longer exists) keep the first enabled one focusable.
  const selectedIndex = options.findIndex((o) => o.value === value && !o.disabled)
  const tabStop = selectedIndex >= 0 ? selectedIndex : nextEnabled(options, 0, 1)

  return (
    <div
      ref={groupRef}
      className={`gs-seg${className ? ` ${className}` : ''}`}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
    >
      {options.map((option, i) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          className="gs-seg-radio"
          aria-checked={option.value === value}
          disabled={disabled || option.disabled}
          tabIndex={i === tabStop ? 0 : -1}
          onClick={() => pick(option)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
