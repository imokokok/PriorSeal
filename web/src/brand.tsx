export function PriorSealMark({ className = '' }: { className?: string }) {
  return (
    <svg className={`priorseal-mark ${className}`.trim()} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path className="priorseal-mark-blue" d="M29 44H8V8h29l6 6v14" />
      <path className="priorseal-mark-ink" d="M35 32h15l6 6v18H30l-6-6V36" />
      <circle className="priorseal-mark-proof" cx="32" cy="32" r="4.5" />
    </svg>
  )
}
