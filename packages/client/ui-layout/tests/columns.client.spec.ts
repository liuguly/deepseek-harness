import { describe, expect, it } from 'vitest'
import {
  CENTER_MIN, clampWidth, computeColumns,
  DETAILS_DEFAULT, DETAILS_MIN, FILES_DEFAULT, FILES_MIN,
  SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_MIN,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'

// Numeric preference form (0 = closed); helpers keep the scenario names readable.
const open = (width: number) => width
const closed = (_width: number) => 0

describe('clampWidth', () => {
  it('clamps into the range and rounds', () => {
    expect(clampWidth(250.4, 240, 420)).toBe(250)
    expect(clampWidth(100, 240, 420)).toBe(240)
    expect(clampWidth(9999, 240, 420)).toBe(420)
  })
})

describe('computeColumns', () => {
  it('step 1: everything fits at preferred widths', () => {
    const cols = computeColumns(1920, open(SIDEBAR_DEFAULT), open(FILES_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 1920 - 280 - 420 - 360, files: 420, details: 360 })
    const withoutFiles = computeColumns(1920, open(SIDEBAR_DEFAULT), closed(FILES_DEFAULT), open(DETAILS_DEFAULT))
    expect(withoutFiles).toEqual({ sidebar: 280, center: 1920 - 280 - 360, files: 0, details: 360 })
  })

  it('closed sidebar keeps its compact rail while closed panels contribute zero width', () => {
    expect(computeColumns(1920, closed(300), closed(420), closed(360)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 1920 - SIDEBAR_COLLAPSED, files: 0, details: 0 })
  })

  it('preferences beyond the clamp range are clamped before solving', () => {
    const cols = computeColumns(2400, open(9999), open(9999), open(1))
    expect(cols.sidebar).toBe(420)
    expect(cols.files).toBe(720)
    expect(cols.details).toBe(300)
    expect(computeColumns(1920, open(1), closed(420), open(DETAILS_DEFAULT)).sidebar).toBe(SIDEBAR_MIN)
  })

  it('step 2: details shrinks first, center pinned at min', () => {
    // 280 + 420 + 360 + 640 = 1700 > 1699; details concedes to 1699-280-420-640 = 359.
    const cols = computeColumns(1699, open(SIDEBAR_DEFAULT), open(FILES_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: CENTER_MIN, files: 420, details: 359 })
  })

  it('boundary: exactly at the step-1/step-2 seam', () => {
    const cols = computeColumns(300 + 420 + 360 + CENTER_MIN, open(300), open(420), open(360))
    expect(cols).toEqual({ sidebar: 300, center: CENTER_MIN, files: 420, details: 360 })
    const one = computeColumns(300 + 420 + 360 + CENTER_MIN - 1, open(300), open(420), open(360))
    expect(one).toEqual({ sidebar: 300, center: CENTER_MIN, files: 420, details: 359 })
  })

  it('step 3: details auto-closes when its min still starves center — files and sidebar hold', () => {
    // 280 + 420 + 300 + 640 = 1640 > 1639 → details 0; center = 1639-280-420 = 939.
    const cols = computeColumns(1639, open(SIDEBAR_DEFAULT), open(FILES_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 939, files: 420, details: 0 })
  })

  it('step 4: files shrinks toward its min once details is closed', () => {
    // 280 + 420 + 640 = 1340 > 1239 → files concedes to 1239-280-640 = 319 → clamped 320? No: 1239-280-640 = 319 < 320 → f1 = 320; check 280+320+640 = 1240 > 1239 → step 5.
    // Use a viewport where f1 lands inside the range: 280+320+640 = 1240 fits; 1239 starves.
    const fits = computeColumns(1240, open(SIDEBAR_DEFAULT), open(FILES_DEFAULT), closed(DETAILS_DEFAULT))
    expect(fits).toEqual({ sidebar: 280, center: CENTER_MIN, files: 320, details: 0 })
  })

  it('step 5: files auto-closes when its min still starves center — sidebar holds', () => {
    // 280 + 320 + 640 = 1240 > 1239 → files 0; center = 1239-280 = 959.
    const cols = computeColumns(1239, open(SIDEBAR_DEFAULT), open(FILES_DEFAULT), closed(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 959, files: 0, details: 0 })
  })

  it('the sidebar never concedes: center absorbs the deficit below CENTER_MIN', () => {
    // 700 < 280+640: sidebar keeps 280, center takes 420 < CENTER_MIN.
    const cols = computeColumns(700, open(SIDEBAR_DEFAULT), closed(FILES_DEFAULT), closed(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: SIDEBAR_DEFAULT, center: 420, files: 0, details: 0 })
  })

  it('sidebar-closed narrow window: panels concede then auto-close in chain order', () => {
    // Everything fits at preferred widths: 56 + 420 + 360 + 640 = 1476.
    const fits = computeColumns(SIDEBAR_COLLAPSED + 420 + DETAILS_DEFAULT + CENTER_MIN, closed(300), open(420), open(DETAILS_DEFAULT))
    expect(fits).toEqual({ sidebar: SIDEBAR_COLLAPSED, center: CENTER_MIN, files: 420, details: DETAILS_DEFAULT })
    // One pixel less: details concedes inside its range.
    const detailsConcedes = computeColumns(SIDEBAR_COLLAPSED + 420 + DETAILS_DEFAULT + CENTER_MIN - 1, closed(300), open(420), open(DETAILS_DEFAULT))
    expect(detailsConcedes).toEqual({
      sidebar: SIDEBAR_COLLAPSED,
      center: CENTER_MIN,
      files: 420,
      details: DETAILS_DEFAULT - 1,
    })
    // Details starved below its min → auto-closes; files keeps its preference.
    const detailsClosed = computeColumns(SIDEBAR_COLLAPSED + 420 + DETAILS_MIN + CENTER_MIN - 1, closed(300), open(420), open(DETAILS_DEFAULT))
    expect(detailsClosed).toEqual({
      sidebar: SIDEBAR_COLLAPSED,
      center: SIDEBAR_COLLAPSED + 420 + DETAILS_MIN + CENTER_MIN - 1 - SIDEBAR_COLLAPSED - 420,
      files: 420,
      details: 0,
    })
    // Files then concedes inside its range.
    const filesConcedes = computeColumns(SIDEBAR_COLLAPSED + 420 + CENTER_MIN - 1, closed(300), open(420), closed(DETAILS_DEFAULT))
    expect(filesConcedes).toEqual({
      sidebar: SIDEBAR_COLLAPSED,
      center: CENTER_MIN,
      files: SIDEBAR_COLLAPSED + 420 + CENTER_MIN - 1 - SIDEBAR_COLLAPSED - CENTER_MIN,
      details: 0,
    })
    // Files starved below its min → auto-closes; center absorbs the rest.
    const filesClosed = computeColumns(SIDEBAR_COLLAPSED + FILES_MIN + CENTER_MIN - 1, closed(300), open(420), closed(DETAILS_DEFAULT))
    expect(filesClosed).toEqual({
      sidebar: SIDEBAR_COLLAPSED,
      center: SIDEBAR_COLLAPSED + FILES_MIN + CENTER_MIN - 1 - SIDEBAR_COLLAPSED,
      files: 0,
      details: 0,
    })
  })

  it('tiny viewport: panels close, sidebar holds, center takes the remainder', () => {
    const cols = computeColumns(400, open(SIDEBAR_DEFAULT), open(FILES_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols.details).toBe(0)
    expect(cols.files).toBe(0)
    expect(cols.sidebar).toBe(SIDEBAR_DEFAULT)
    expect(cols.center).toBe(Math.max(0, 400 - SIDEBAR_DEFAULT))
  })

  it('recovery is pure: re-widening restores preferred widths untouched', () => {
    const squeezed = computeColumns(1100, open(SIDEBAR_DEFAULT), open(FILES_DEFAULT), open(DETAILS_DEFAULT))
    expect(squeezed.details).toBe(0)
    expect(squeezed.files).toBe(0)
    const restored = computeColumns(1920, open(SIDEBAR_DEFAULT), open(FILES_DEFAULT), open(DETAILS_DEFAULT))
    expect(restored.details).toBe(DETAILS_DEFAULT)
    expect(restored.files).toBe(FILES_DEFAULT)
    expect(restored.sidebar).toBe(SIDEBAR_DEFAULT)
  })
})

describe('computeColumns — degenerate viewports', () => {
  it('sidebar closed and viewport below CENTER_MIN: panels auto-close, center takes the rest', () => {
    // Reaches the final auto-close with the compact rail sidebar.
    expect(computeColumns(500, closed(300), open(FILES_DEFAULT), open(DETAILS_DEFAULT)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 500 - SIDEBAR_COLLAPSED, files: 0, details: 0 })
  })
})
