interface SparklineProps {
  /** Samples in 0–1, oldest first. */
  values: number[]
  /** Slots across the full width, so the line grows left to right. */
  capacity: number
  height?: number
  label: string
}

const W = 100

export function Sparkline({ values, capacity, height = 40, label }: SparklineProps) {
  const slots = Math.max(capacity, values.length, 2)
  const y = (v: number) => height - 2 - Math.min(1, Math.max(0, v)) * (height - 4)
  const points = values.map((v, i) => `${((i / (slots - 1)) * W).toFixed(2)},${y(v).toFixed(2)}`)
  const lastX = values.length > 0 ? ((values.length - 1) / (slots - 1)) * W : 0

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      height={height}
      role="img"
      aria-label={label}
    >
      <line x1="0" x2={W} y1={height - 2} y2={height - 2} className="sparkline__base" vectorEffect="non-scaling-stroke" />
      {values.length > 1 && (
        <>
          <polygon
            className="sparkline__area"
            points={`0,${height - 2} ${points.join(' ')} ${lastX.toFixed(2)},${height - 2}`}
          />
          <polyline className="sparkline__line" points={points.join(' ')} vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  )
}
