/** নদী AI's face: a calm river-green circle with a wave. `talking` animates the mouth line, `listening` pulses a ring. */
export function NodiAvatar({ size = 40, talking = false, listening = false }: { size?: number; talking?: boolean; listening?: boolean }) {
  return <span className={`nodi-av${talking ? ' talk' : ''}${listening ? ' listen' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
    <svg viewBox="0 0 64 64" width={size} height={size}>
      <defs><linearGradient id="nodiG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#34A86A" /><stop offset="1" stopColor="#0A4D27" /></linearGradient></defs>
      <circle cx="32" cy="32" r="31" fill="url(#nodiG)" />
      <path d="M8 40c6-5 12-5 18 0s12 5 18 0 10-4 12-2" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="3" strokeLinecap="round" />
      <circle cx="23" cy="26" r="3.2" fill="#fff" /><circle cx="41" cy="26" r="3.2" fill="#fff" />
      <path className="mouth" d="M24 40q8 7 16 0" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </svg></span>
}
