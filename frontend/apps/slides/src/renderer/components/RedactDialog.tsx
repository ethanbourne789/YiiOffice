import { useCallback, useState } from 'react'

export interface RedactDialogProps {
  seed: string
  onSubmit: (label: string | null) => void
  onCancel: () => void
}

export function RedactDialog({ seed, onSubmit, onCancel }: RedactDialogProps) {
  const [label, setLabel] = useState(seed)

  const handleSubmit = useCallback(() => {
    onSubmit(label || null)
  }, [label, onSubmit])

  const handleCancel = useCallback(() => {
    onCancel()
  }, [onCancel])

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.4)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
    }}>
      <div style={{
        background: 'white',
        borderRadius: 8,
        padding: 24,
        minWidth: 320,
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Apply Redaction Label</h3>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            marginBottom: 16,
            boxSizing: 'border-box',
            fontSize: 14,
          }}
          autoFocus
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={handleCancel}>Cancel</button>
          <button onClick={handleSubmit}>Apply</button>
        </div>
      </div>
    </div>
  )
}