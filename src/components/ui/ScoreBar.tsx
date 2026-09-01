interface Props {
  score: number
  label?: boolean
}

const tier = (score: number) =>
  score >= 70 ? 'danger' : score >= 40 ? 'warning' : 'safe'

export default function ScoreBar({ score, label = true }: Props) {
  const t = tier(score)
  return (
    <div className="score-bar">
      <div className="score-track">
        <div
          className={`score-fill score-fill-${t}`}
          style={{ width: `${score}%` }}
        />
      </div>
      {label && <span className={`score-value score-value-${t}`}>{score}%</span>}
    </div>
  )
}
