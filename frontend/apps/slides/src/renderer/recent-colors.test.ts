import { beforeEach, describe, expect, it } from 'vitest'
import { getRecentColors, pushRecentColor } from './recent-colors'

const KEY = 'slides:recent-colors'

beforeEach(() => {
  localStorage.clear()
})

describe('recent colors', () => {
  it('falls back to an empty list when storage is corrupt or not an array', () => {
    localStorage.setItem(KEY, '{not json')
    expect(getRecentColors()).toEqual([])
    localStorage.setItem(KEY, '{"colors":[]}')
    expect(getRecentColors()).toEqual([])
  })

  it('normalizes, deduplicates and caps the stored list at 10', () => {
    const hexes = Array.from({ length: 12 }, (_, i) => `#${i.toString(16).padStart(6, '0')}`)
    localStorage.setItem(KEY, JSON.stringify([...hexes, '#000000', 'not-a-color']))
    const colors = getRecentColors()
    expect(colors).toHaveLength(10)
    expect(colors[0]).toBe('#000000')
    expect(new Set(colors).size).toBe(colors.length)
    expect(colors.every((c) => /^#[0-9A-F]{6}$/.test(c))).toBe(true)
  })

  it('pushes the most recent color to the front and ignores invalid input', () => {
    pushRecentColor('#aabbcc')
    pushRecentColor('112233')
    expect(getRecentColors()).toEqual(['#112233', '#AABBCC'])
    // Re-pushing moves it back to the front without duplicating it.
    pushRecentColor('#AABBCC')
    expect(getRecentColors()).toEqual(['#AABBCC', '#112233'])
    pushRecentColor('nope')
    expect(getRecentColors()).toEqual(['#AABBCC', '#112233'])
  })
})
