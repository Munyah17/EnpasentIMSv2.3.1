import { describe, it, expect, beforeEach } from 'vitest'
import { getNotifSettings, saveNotifSettings, DEFAULT_NOTIF_SETTINGS } from './mailService'

describe('mailService notification settings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns defaults when nothing has been saved', () => {
    expect(getNotifSettings()).toEqual(DEFAULT_NOTIF_SETTINGS)
  })

  it('persists and reloads a saved setting', () => {
    saveNotifSettings({ ...DEFAULT_NOTIF_SETTINGS, insurerName: 'Acme Insurance' })
    expect(getNotifSettings().insurerName).toBe('Acme Insurance')
  })

  it('falls back to defaults if the stored value is corrupted JSON', () => {
    localStorage.setItem('tqfy_notif_settings', '{not valid json')
    expect(getNotifSettings()).toEqual(DEFAULT_NOTIF_SETTINGS)
  })
})
