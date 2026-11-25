import { useRef } from 'react'
import { usePrefs } from '../lib/prefs'

export function EvidencePicker({ onFile, accept = 'image/png,image/jpeg,application/pdf', disabled = false }: {
  onFile: (file: File) => void; accept?: string; disabled?: boolean
}) {
  const { L } = usePrefs()
  const cameraInput = useRef<HTMLInputElement>(null)
  const cameraLabel = L('ক্যামেরায় ছবি তুলুন', 'Take a photo')
  return <div className="row">
    <input type="file" accept={accept} disabled={disabled} aria-label={L('ফাইল বাছুন', 'Choose file')}
      onChange={event => {
        const file = event.currentTarget.files?.[0]
        if (file) onFile(file)
        event.currentTarget.value = ''
      }} />
    <button type="button" className="secondary sm" disabled={disabled} onClick={() => cameraInput.current?.click()}>{cameraLabel}</button>
    <input ref={cameraInput} type="file" accept="image/jpeg,image/png" capture="environment" disabled={disabled}
      hidden onChange={event => {
        const file = event.currentTarget.files?.[0]
        if (file) onFile(file)
        event.currentTarget.value = ''
      }} />
  </div>
}
