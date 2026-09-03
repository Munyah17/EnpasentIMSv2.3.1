import { useState, useEffect } from 'react'
import type { Policy, Dependant, Insurer, InsurerRecord, Client, Product, AppUser } from '../../types'
import { MANUAL_PAYMENT_METHODS } from '../../types'
import { db } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'
import PhoneInput from '../ui/PhoneInput'
import DateInput from '../ui/DateInput'
import InsurerSelect from '../ui/InsurerSelect'
import { resolveClientInsurer } from '../../lib/insurerAssignment'
import { premiumPeriodLabel } from '../../lib/productUtils'
import { computeAssignedStartDate } from '../../lib/policyLifecycle'

interface Props {
  onClose: () => void
  onSave: (policy: Policy) => void
  showToast?: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
  /** Pre-selects and locks this client (e.g. "Assign Policy" from the
   *  Clients page for someone registered with no policy yet) — skips the
   *  New/Existing toggle and search step entirely. */
  initialClient?: Client
}

export default function NewPolicyModal({ onClose, onSave, showToast, initialClient }: Props) {
  const { user } = useAuth()
  // A customer already on file can take out another policy without being
  // re-registered from scratch — that's what "existing" mode is for. It's
  // also how a client ends up holding more than one policy at all.
  const [customerMode, setCustomerMode] = useState<'new' | 'existing'>(initialClient ? 'existing' : 'new')
  const [clientSearch, setClientSearch] = useState('')
  const [existingClientId, setExistingClientId] = useState('')
  const [existingClients, setExistingClients] = useState<Client[]>([])

  // Client fields
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientNationalId, setClientNationalId] = useState('')
  const [clientDob, setClientDob] = useState('')
  const [clientAddress, setClientAddress] = useState('')
  const [clientOccupation, setClientOccupation] = useState('')
  // One insurer per policy — asked once, applied to both the client record
  // and the policy itself (this modal used to ask twice for the same thing).
  const [insurer, setInsurer] = useState<Insurer | ''>('')

  // Policy fields
  const [productId, setProductId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('OneMoney')
  // Cover starts on the 1st of the aligned month (see computeAssignedStartDate),
  // not the day it was captured — only Super Admin/Admin may override this.
  const [startDate, setStartDate] = useState(computeAssignedStartDate())
  const canOverrideStartDate = user?.role === 'super_admin' || user?.role === 'admin'
  // Optional — a policy can carry zero dependants, so this starts empty
  // rather than seeding a mandatory first row.
  const [dependants, setDependants] = useState<Dependant[]>([])
  const [growerNumber, setGrowerNumber] = useState('')
  const [agentId, setAgentId] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [staff, setStaff] = useState<AppUser[]>([])
  const [insurerOptions, setInsurerOptions] = useState<InsurerRecord[]>([])
  const product = products.find(p => p.id === productId)

  /** A dependant is covered under the same kind of cover as the policy they
   *  sit on, so the plan picker only ever offers products from the policy's
   *  own category. Offering the full catalogue is how agriculture packages
   *  ended up attached to funeral policies. */
  const dependantPlanOptions = product
    ? products.filter(p => p.active && p.category === product.category)
    : []

  useEffect(() => {
    db.products.list().then(({ data }) => { if (data) setProducts(data); setProductsLoading(false) })
    db.clients.list().then(({ data }) => { if (data) setExistingClients(data) })
    db.insurers.list().then(({ data }) => setInsurerOptions(data.filter(i => i.status === 'active')))
    db.staff.list().then(({ data }) => {
      const active = (data ?? []).filter(s => s.active)
      setStaff(active)
      // Default to whoever is actually creating this policy — the person
      // serving the client — while still letting them reassign it below.
      if (user && active.some(s => s.id === user.id)) setAgentId(user.id)
    })
    if (initialClient) selectExistingClient(initialClient)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Changing the product after dependants were given plans would otherwise
  // leave those plans pointing at the previous category's packages.
  useEffect(() => {
    if (!product) return
    setDependants(prev => prev.map(d => {
      if (!d.productId) return d
      const plan = products.find(p => p.id === d.productId)
      if (plan && plan.category === product.category) return d
      return { ...d, productId: undefined, productName: undefined, premium: undefined, coverAmount: undefined }
    }))
  }, [product, products])

  const clearClientFields = () => {
    setClientName(''); setClientPhone(''); setClientEmail(''); setClientNationalId('')
    setClientDob(''); setClientAddress(''); setClientOccupation(''); setInsurer('')
  }

  const switchMode = (mode: 'new' | 'existing') => {
    setCustomerMode(mode)
    setExistingClientId('')
    setClientSearch('')
    clearClientFields()
  }

  const clientSearchResults = clientSearch.trim().length < 2 ? [] : existingClients.filter(c =>
    c.name.toLowerCase().includes(clientSearch.trim().toLowerCase()) ||
    c.phone.includes(clientSearch.trim()) ||
    c.nationalId.toLowerCase().includes(clientSearch.trim().toLowerCase())
  ).slice(0, 8)

  const selectExistingClient = (client: Client) => {
    setExistingClientId(client.id)
    setClientSearch(`${client.name} (${client.phone})`)
    setClientName(client.name)
    setClientPhone(client.phone)
    setClientEmail(client.email)
    setClientNationalId(client.nationalId)
    setClientDob(client.dob)
    setClientAddress(client.address)
    setClientOccupation(client.occupation ?? '')
    setInsurer(client.insurer ?? '')
  }

  const addDependant = () => {
    setDependants(prev => [...prev, { name: '', relationship: '', dob: '', nationalId: '' }])
  }

  const removeDependant = (i: number) => {
    setDependants(prev => prev.filter((_, idx) => idx !== i))
  }

  const updateDependant = (i: number, field: keyof Dependant, value: string) => {
    setDependants(prev => prev.map((d, idx) => {
      if (idx !== i) return d
      const next = { ...d, [field]: value }
      if (field === 'productId') {
        const plan = products.find(p => p.id === value)
        next.productName = plan?.name
        next.premium = plan?.premium
        next.coverAmount = plan?.coverAmount
      }
      return next
    }))
  }

  const clientAge = clientDob ? Math.floor((Date.now() - new Date(clientDob).getTime()) / (365.25 * 24 * 3600 * 1000)) : null

  const handleSave = async () => {
    if (customerMode === 'existing' && !existingClientId) {
      if (showToast) showToast('error', 'Search for and select an existing customer first.')
      return
    }
    if (!clientName || !clientPhone || !clientNationalId || !clientDob || !productId) {
      if (showToast) showToast('error', 'Please fill in all required fields, including date of birth.')
      return
    }
    if (clientAge !== null && clientAge < 18) {
      if (showToast) showToast('error', 'The policyholder must be at least 18 years old.')
      return
    }
    const incompleteDependant = dependants.find(d => d.name.trim() && (!d.dob || !d.nationalId.trim()))
    if (incompleteDependant) {
      if (showToast) showToast('error', 'Enter date of birth and ID number for every dependant.')
      return
    }
    const overValue = dependants.find(d => (d.premium ?? 0) > product!.premium || (d.coverAmount ?? 0) > product!.coverAmount)
    if (overValue) {
      if (showToast) showToast('error', `${overValue.name || 'A dependant'}'s plan premium and cover cannot exceed the policyholder's.`)
      return
    }

    // Existing customer: update their record in place (details may have
    // changed since they were first registered) rather than creating a
    // duplicate client row — this is what lets one person hold more than
    // one policy.
    // Insurer is optional here too; blank places the client with the house
    // insurer provisionally. This decides the CLIENT record only -- the
    // policy's own insurer below is never back-filled from it, because that
    // is the party who pays the claim. See src/lib/insurerAssignment.ts.
    const resolvedInsurer = resolveClientInsurer(insurer, insurerOptions)

    let createdClient: Client | null
    if (customerMode === 'existing' && existingClientId) {
      const prior = existingClients.find(c => c.id === existingClientId)
      // Only speak to the provisional flag when this modal actually decided
      // something. Reopening a client who was already provisionally placed
      // and saving without touching the picker must not quietly convert that
      // placement into a choice they never made.
      const decidedHere = !prior?.insurer || (insurer || undefined) !== prior.insurer
      const { data, error } = await db.clients.update(existingClientId, {
        name: clientName, email: clientEmail, phone: clientPhone,
        address: clientAddress, occupation: clientOccupation,
        insurer: resolvedInsurer.insurer,
        ...(decidedHere ? { insurerProvisional: resolvedInsurer.insurerProvisional } : {}),
      })
      if (error || !data) { if (showToast) showToast('error', 'Failed to update client.'); return }
      createdClient = data
    } else {
      const newClient: Client = {
        id: `c${Date.now()}`,
        name: clientName,
        email: clientEmail,
        phone: clientPhone,
        nationalId: clientNationalId,
        dob: clientDob,
        address: clientAddress,
        occupation: clientOccupation,
        insurer: resolvedInsurer.insurer,
        insurerProvisional: resolvedInsurer.insurerProvisional,
        createdAt: new Date().toISOString().split('T')[0],
        policyCount: 0,
        status: 'active',
      }
      const { data, error } = await db.clients.create(newClient)
      if (error || !data) { if (showToast) showToast('error', 'Failed to create client.'); return }
      createdClient = data
    }

    // Create policy with the client
    const policyNumber = `EMA${new Date().getFullYear()}${String(Date.now()).slice(-3)}`
    const endDate = new Date(startDate)
    endDate.setFullYear(endDate.getFullYear() + 1)
    const policy: Policy = {
      id: `pol${Date.now()}`,
      policyNumber,
      clientId: createdClient.id,
      clientName: createdClient.name,
      productId,
      productName: product!.name,
      premium: product!.premium,
      coverAmount: product!.coverAmount,
      startDate,
      endDate: endDate.toISOString().split('T')[0],
      // Every new policy starts in a waiting period, lifted to active after
      // 90 days — except agriculture, which has NO waiting period at all
      // and activates instantly on creation. See src/lib/reminderEngine.ts.
      status: product!.category === 'agriculture' ? 'active' : 'waiting_period',
      dependants,
      paymentMethod,
      // Deliberately the raw selection, not resolvedInsurer: a policy's
      // insurer is the party that pays the claim, so it is only ever what
      // someone actually chose. Blank stays blank and shows up as unplaced,
      // which is a question staff can still answer -- a provisional default
      // silently hardened into cover is one they could not.
      insurer: insurer || undefined,
      growerNumber: product!.category === 'agriculture' ? (growerNumber || undefined) : undefined,
      createdAt: new Date().toISOString().split('T')[0],
      nextPaymentDate: new Date(new Date(startDate).setMonth(new Date(startDate).getMonth() + (product!.category === 'agriculture' ? 12 : 1))).toISOString().split('T')[0],
      agentId: agentId || undefined,
      agentName: staff.find(s => s.id === agentId)?.name,
    }
    onSave(policy)
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 900 }}>
        <div className="modal-header">
          <h3>New Policy</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {!initialClient && (
            <div className="bubble-toggle" style={{ marginBottom: '1rem' }}>
              <button
                type="button"
                className={`bubble-toggle-btn${customerMode === 'new' ? ' active' : ''}`}
                onClick={() => switchMode('new')}
              >
                New Customer
              </button>
              <button
                type="button"
                className={`bubble-toggle-btn${customerMode === 'existing' ? ' active' : ''}`}
                onClick={() => switchMode('existing')}
              >
                Existing Customer
              </button>
            </div>
          )}

          {customerMode === 'existing' && !initialClient && (
            <div className="form-group" style={{ position: 'relative', marginBottom: '1rem' }}>
              <label>Search Customer * (name, phone, or ID number)</label>
              <input
                className="form-control"
                placeholder="Start typing to search…"
                value={clientSearch}
                onChange={e => { setClientSearch(e.target.value); setExistingClientId('') }}
              />
              {clientSearchResults.length > 0 && !existingClientId && (
                <div className="search-suggestions">
                  {clientSearchResults.map(c => (
                    <button type="button" key={c.id} className="search-suggestion-item" onClick={() => selectExistingClient(c)}>
                      <strong>{c.name}</strong> · {c.phone} · {c.nationalId}
                    </button>
                  ))}
                </div>
              )}
              {existingClientId && (
                <p style={{ fontSize: 12, color: 'var(--success)', marginTop: 4 }}>✓ Customer selected, details autofilled below.</p>
              )}
            </div>
          )}

          <div className="new-policy-cols">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h4 style={{ margin: 0 }}>Customer Information{existingClientId && <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--muted)' }}> (on file, read only)</span>}</h4>
              <div className="form-group">
                <label>Full Name *</label>
                <input className="form-control" placeholder="Enter full name" value={clientName} onChange={e => setClientName(e.target.value)} disabled={!!existingClientId} style={existingClientId ? { opacity: 0.6 } : undefined} />
              </div>
              <div className="form-group">
                <label>Phone Number *</label>
                <PhoneInput value={clientPhone} onChange={setClientPhone} disabled={!!existingClientId} />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" className="form-control" placeholder="email@example.com" value={clientEmail} onChange={e => setClientEmail(e.target.value)} disabled={!!existingClientId} style={existingClientId ? { opacity: 0.6 } : undefined} />
              </div>
              <div className="form-group">
                <label>National ID *</label>
                <input className="form-control" placeholder="e.g. 632118532K12" value={clientNationalId} onChange={e => setClientNationalId(e.target.value.replace(/-/g, ''))} disabled={!!existingClientId} style={existingClientId ? { opacity: 0.6 } : undefined} />
              </div>
              <div className="form-group">
                <label>Date of Birth * (18+)</label>
                <DateInput value={clientDob} onChange={setClientDob} disabled={!!existingClientId} className={existingClientId ? 'date-input-disabled' : undefined} />
              </div>
              <div className="form-group">
                <label>Occupation</label>
                <input className="form-control" placeholder="e.g. Teacher" value={clientOccupation} onChange={e => setClientOccupation(e.target.value)} disabled={!!existingClientId} style={existingClientId ? { opacity: 0.6 } : undefined} />
              </div>
              <div className="form-group">
                <label>Address</label>
                <input className="form-control" placeholder="Street address, city" value={clientAddress} onChange={e => setClientAddress(e.target.value)} disabled={!!existingClientId} style={existingClientId ? { opacity: 0.6 } : undefined} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h4 style={{ margin: 0 }}>Policy Information</h4>
              <div className="form-group">
                <label>Product *</label>
                <select className="form-control" value={productId} onChange={e => setProductId(e.target.value)} disabled={productsLoading}>
                  <option value="">{productsLoading ? 'Loading products…' : 'Select product…'}</option>
                  {products.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name} (${p.premium}{premiumPeriodLabel(p.category)})</option>)}
                </select>
              </div>
              {product && (
                <div className="info-banner info-banner-info">
                  Cover: ${product.coverAmount.toLocaleString()} · Premium: ${product.premium}{premiumPeriodLabel(product.category)} · Commission: {product.commissionPct}%
                </div>
              )}
              {product?.category === 'agriculture' && (
                <div className="form-group">
                  <label>Grower Number</label>
                  <input className="form-control" placeholder="Grower registration number" value={growerNumber} onChange={e => setGrowerNumber(e.target.value)} />
                </div>
              )}
              <div className="form-group">
                <label>Start Date *</label>
                <DateInput value={startDate} onChange={setStartDate} disabled={!canOverrideStartDate} className={!canOverrideStartDate ? 'date-input-disabled' : undefined} />
                {!canOverrideStartDate && (
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Auto-set from today's date. Only Super Admin/Admin can change it.</p>
                )}
              </div>
              <div className="form-group">
                <label>Payment Method *</label>
                <select className="form-control" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                  {MANUAL_PAYMENT_METHODS.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Insurer</label>
                <InsurerSelect value={insurer} onChange={v => setInsurer(v as Insurer)} options={insurerOptions} />
              </div>
              <div className="form-group">
                <label>Agent</label>
                <select className="form-control" value={agentId} onChange={e => setAgentId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.role.replace(/_/g, ' ')})</option>)}
                </select>
              </div>
            </div>
          </div>

          <div style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label>Dependants</label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={addDependant}>+ Add Dependant</button>
            </div>
            {dependants.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>No dependants added.</p>
            ) : (
              <>
                <div className="new-policy-dependant-row" style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Name</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Relationship</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Date of Birth</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>ID / Birth Record No.</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Plan</span>
                  <span />
                </div>
                {dependants.map((d, i) => (
                  <div key={i} className="new-policy-dependant-row" style={{ marginBottom: 8, alignItems: 'center' }}>
                    <input className="form-control" placeholder="Name" value={d.name} onChange={e => updateDependant(i, 'name', e.target.value)} />
                    <input className="form-control" placeholder="Relationship" value={d.relationship} onChange={e => updateDependant(i, 'relationship', e.target.value)} />
                    <DateInput value={d.dob} onChange={v => updateDependant(i, 'dob', v)} />
                    <input className="form-control" placeholder="ID (16+) or birth record no." value={d.nationalId} onChange={e => updateDependant(i, 'nationalId', e.target.value.replace(/-/g, ''))} />
                    <select className="form-control" value={d.productId ?? ''} onChange={e => updateDependant(i, 'productId', e.target.value)} disabled={!product}>
                      <option value="">{product ? 'Select plan…' : 'Pick the product first'}</option>
                      {dependantPlanOptions.map(p => <option key={p.id} value={p.id}>{p.name} (${p.premium})</option>)}
                    </select>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeDependant(i)} title="Remove dependant">✕</button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!clientName || !clientPhone || !clientNationalId || !productId || (customerMode === 'existing' && !existingClientId)}
          >
            {customerMode === 'existing' ? 'Create Policy' : 'Create Policy & Register Client'}
          </button>
        </div>
      </div>
    </div>
  )
}
