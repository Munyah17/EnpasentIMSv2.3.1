import { useState, useEffect } from 'react'
import type { ToastMessage, Product } from '../types'
import type { ActivePanel } from '../App'
import { db } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'
import { premiumPeriodLabel } from '../lib/productUtils'
import AddProductModal from '../components/modals/AddProductModal'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}


export default function Products({ showToast }: Props) {
  const { hasPermission } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editProduct, setEditProduct] = useState<Product | null>(null)

  useEffect(() => {
    db.products.list().then(({ data, error }) => {
      if (error) showToast('error', 'Failed to load products.')
      else if (data) setProducts(data)
      setLoading(false)
    })
  }, [showToast])

  const handleSave = async (p: Product) => {
    if (editProduct) {
      const { data, error } = await db.products.update(p.id, p)
      if (error || !data) { showToast('error', error ?? 'Failed to update product.'); return }
      setProducts(prev => prev.map(x => x.id === data.id ? data : x))
      showToast('success', `Product "${data.name}" updated.`)
    } else {
      const { data, error } = await db.products.create(p)
      if (error || !data) { showToast('error', error ?? 'Failed to add product.'); return }
      setProducts(prev => [...prev, data])
      showToast('success', `Product "${data.name}" added.`)
    }
    setShowAdd(false)
    setEditProduct(null)
  }

  const toggleActive = async (id: string) => {
    const product = products.find(p => p.id === id)
    if (!product) return
    const { data, error } = await db.products.update(id, { active: !product.active })
    if (error || !data) { showToast('error', 'Failed to update product status.'); return }
    setProducts(prev => prev.map(p => p.id === id ? data : p))
    showToast('info', 'Product status updated.')
  }

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div />
        {hasPermission('products.create') && (
          <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Product</button>
        )}
      </div>

      {loading ? (
        <div className="empty-state">Loading products…</div>
      ) : (
        <div className="products-grid">
          {products.map(p => (
            <div key={p.id} className={`product-card ${p.active ? 'active' : 'inactive'}`}>
              <div className={`product-card-header product-card-header-${p.category}`}>
                <div>
                  <div className="product-name">{p.name}</div>
                  <div className="product-code">{p.code}</div>
                </div>
                <span className={`pill ${p.active ? 'pill-product-active' : 'pill-product-inactive'}`}>{p.active ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="product-stats">
                <div className="product-stat">
                  <span className="product-stat-label">Premium</span>
                  <span className="product-stat-value">${p.premium}{premiumPeriodLabel(p.category)}</span>
                </div>
                <div className="product-stat">
                  <span className="product-stat-label">Cover</span>
                  <span className="product-stat-value">${p.coverAmount.toLocaleString()}</span>
                </div>
                <div className="product-stat">
                  <span className="product-stat-label">Commission</span>
                  <span className="product-stat-value">{p.commissionPct}%</span>
                </div>
                <div className="product-stat">
                  <span className="product-stat-label">Policies</span>
                  <span className="product-stat-value">{p.policiesCount}</span>
                </div>
              </div>
              <div className="product-features">
                {p.features.slice(0, 3).map((f, i) => (
                  <span key={i} className="feature-tag">✓ {f}</span>
                ))}
                {p.features.length > 3 && <span className="feature-more">+{p.features.length - 3} more</span>}
              </div>
              {hasPermission('products.edit') && (
                <div className="product-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditProduct(p); setShowAdd(true) }}>Edit</button>
                  {/* The button is coloured by what it does, not by the
                      product's current state: deactivating is the
                      destructive action, activating is the safe one. */}
                  <button
                    type="button"
                    className={`btn btn-sm ${p.active ? 'btn-danger' : 'btn-primary'}`}
                    onClick={() => toggleActive(p.id)}
                  >
                    {p.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(showAdd || editProduct) && (
        <AddProductModal
          product={editProduct}
          onClose={() => { setShowAdd(false); setEditProduct(null) }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
