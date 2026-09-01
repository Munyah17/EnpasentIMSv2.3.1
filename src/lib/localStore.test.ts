import { describe, it, expect, beforeEach } from 'vitest'
import { localStore } from './localStore'

describe('localStore (browser-local fallback used by db.ts)', () => {
  beforeEach(() => {
    localStore.reset()
  })

  it('lists seed data on first read', () => {
    const clients = localStore.clients.list()
    expect(Array.isArray(clients)).toBe(true)
  })

  it('create() adds a row that list() then returns', () => {
    const before = localStore.clients.list().length
    const created = localStore.clients.create({
      id: 'test-client-1', name: 'Test Client', email: 't@example.com', phone: '0770000000',
      nationalId: '00000000A00', dob: '1990-01-01', address: 'Test address',
      createdAt: '2026-01-01', policyCount: 0, status: 'active',
    })
    expect(created.id).toBe('test-client-1')
    const after = localStore.clients.list()
    expect(after.length).toBe(before + 1)
    expect(after.find(c => c.id === 'test-client-1')).toBeTruthy()
  })

  it('update() patches an existing row and returns it', () => {
    localStore.clients.create({
      id: 'test-client-2', name: 'Before', email: 't2@example.com', phone: '0770000001',
      nationalId: '00000001A00', dob: '1990-01-01', address: 'Addr',
      createdAt: '2026-01-01', policyCount: 0, status: 'active',
    })
    const updated = localStore.clients.update('test-client-2', { name: 'After' })
    expect(updated?.name).toBe('After')
    expect(localStore.clients.list().find(c => c.id === 'test-client-2')?.name).toBe('After')
  })

  it('update() on a missing id returns null and does not throw', () => {
    expect(localStore.clients.update('does-not-exist', { name: 'X' })).toBeNull()
  })

  it('delete() removes the row', () => {
    localStore.clients.create({
      id: 'test-client-3', name: 'ToDelete', email: 't3@example.com', phone: '0770000002',
      nationalId: '00000002A00', dob: '1990-01-01', address: 'Addr',
      createdAt: '2026-01-01', policyCount: 0, status: 'active',
    })
    localStore.clients.delete('test-client-3')
    expect(localStore.clients.list().find(c => c.id === 'test-client-3')).toBeUndefined()
  })

  it('reset() clears all tqfy_-prefixed keys but leaves other localStorage keys alone', () => {
    localStorage.setItem('unrelated_key', 'keep-me')
    localStore.clients.create({
      id: 'test-client-4', name: 'X', email: '', phone: '', nationalId: '', dob: '',
      address: '', createdAt: '', policyCount: 0, status: 'active',
    })
    localStore.reset()
    expect(localStorage.getItem('unrelated_key')).toBe('keep-me')
    expect(localStore.clients.list().find(c => c.id === 'test-client-4')).toBeUndefined()
  })
})
