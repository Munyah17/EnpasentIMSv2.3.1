import { useState } from 'react'
import type { Product } from '../../types'

interface Props {
  product: Product | null
  onClose: () => void
  onSave: (product: Product) => void
}

export default function AddProductModal({ product, onClose, onSave }: Props) {
  const [name, setName] = useState(product?.name ?? '')
  const [code, setCode] = useState(product?.code ?? '')
  const [category, setCategory] = useState<Product['category']>(product?.category ?? 'funeral')
  const [premium, setPremium] = useState(String(product?.premium ?? ''))
  const [coverAmount, setCoverAmount] = useState(String(product?.coverAmount ?? ''))
  const [waitingPeriodDays, setWaitingPeriodDays] = useState(String(product?.waitingPeriodDays ?? 30))
  const [minAge, setMinAge] = useState(String(product?.minAge ?? 18))
  const [maxAge, setMaxAge] = useState(String(product?.maxAge ?? 70))
  const [commissionPct, setCommissionPct] = useState(String(product?.commissionPct ?? 15))
  const [excess, setExcess] = useState(product?.excess ?? '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [featuresText, setFeaturesText] = useState(product?.features.join('\n') ?? '')

  const handleSave = () => {
    if (!name || !code || !premium || !coverAmount) return
    const p: Product = {
      id: product?.id ?? `prod${Date.now()}`,
      name, code, category,
      premium: Number(premium),
      coverAmount: Number(coverAmount),
      waitingPeriodDays: Number(waitingPeriodDays),
      minAge: Number(minAge),
      maxAge: Number(maxAge),
      commissionPct: Number(commissionPct),
      active: product?.active ?? true,
      features: featuresText.split('\n').map(f => f.trim()).filter(Boolean),
      description,
      // Empty string rather than undefined, because db.products.update
      // skips undefined fields — a product switched away from agriculture
      // has to actively clear its excess, not merely stop sending it.
      excess: category === 'agriculture' ? excess.trim() : '',
      policiesCount: product?.policiesCount ?? 0,
    }
    onSave(p)
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>{product ? 'Edit Product' : 'Add Product'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="form-group">
              <label>Product Name *</label>
              <input className="form-control" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Funeral Cover Basic" />
            </div>
            <div className="form-group">
              <label>Product Code *</label>
              <input className="form-control" value={code} onChange={e => setCode(e.target.value)} placeholder="FUN001" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Category</label>
              <select className="form-control" value={category} onChange={e => setCategory(e.target.value as Product['category'])}>
                <option value="funeral">Funeral</option>
                <option value="life">Life</option>
                <option value="health">Health</option>
                <option value="accident">Accident</option>
                <option value="motor">Motor</option>
                <option value="property">Property</option>
                <option value="agriculture">Agriculture (Annual)</option>
              </select>
            </div>
            <div className="form-group">
              <label>{category === 'agriculture' ? 'Annual Premium ($) *' : 'Monthly Premium ($) *'}</label>
              <input type="number" className="form-control" min={0} value={premium} onChange={e => setPremium(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Cover Amount ($) *</label>
              <input type="number" className="form-control" min={0} value={coverAmount} onChange={e => setCoverAmount(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Waiting Period (days)</label>
              <input type="number" className="form-control" min={0} value={waitingPeriodDays} onChange={e => setWaitingPeriodDays(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Min Age</label>
              <input type="number" className="form-control" value={minAge} onChange={e => setMinAge(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Max Age</label>
              <input type="number" className="form-control" value={maxAge} onChange={e => setMaxAge(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Commission (%)</label>
              <input type="number" className="form-control" value={commissionPct} onChange={e => setCommissionPct(e.target.value)} />
            </div>
          </div>
          {/* Excess belongs to agriculture cover and nothing else. Offering
              it on every category is how funeral and medical products ended
              up carrying a deductible their policyholders do not have. */}
          {category === 'agriculture' && (
            <div className="form-group">
              <label>Policy Excess (optional)</label>
              <input className="form-control" value={excess} onChange={e => setExcess(e.target.value)} placeholder="e.g. 15% of loss" />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                Printed on the policy document. Leave blank to use the standard 15% of loss.
              </span>
            </div>
          )}
          <div className="form-group">
            <label>Description</label>
            <textarea className="form-control" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Features (one per line)</label>
            <textarea className="form-control" rows={4} value={featuresText} onChange={e => setFeaturesText(e.target.value)} placeholder="Immediate payout&#10;Up to 6 dependants&#10;Repatriation cover" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!name || !code || !premium || !coverAmount}>
            {product ? 'Save Changes' : 'Add Product'}
          </button>
        </div>
      </div>
    </div>
  )
}
