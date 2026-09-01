interface Props { score: number }

const tier = (s: number) => s >= 70 ? 'danger' : s >= 40 ? 'warning' : 'safe'

export default function FraudGauge({ score }: Props) {
  const t = tier(score)
  return (
    <div className={`fraud-score-display score-tier-${t}`}>
      <div className="fraud-gauge">
        <div className={`fraud-gauge-fill score-fill-${t}`} style={{ width: `${score}%` }} />
      </div>
      <span className="fraud-score-number">{score}% Fraud Risk</span>
    </div>
  )
}
