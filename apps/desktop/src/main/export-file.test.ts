import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findExportFile, isPlayableExport } from './export-file'

let root: string
let dir: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'svs-export-file-'))
  dir = join(root, 'exports')
  mkdirSync(dir)
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('findExportFile', () => {
  it('找得到 exports/ 裡的影片，給對的 MIME（含中文檔名、大寫副檔名）', () => {
    writeFileSync(join(dir, '最終成品（中文旁白）.mp4'), 'x')
    writeFileSync(join(dir, 'clip.MOV'), 'x')
    writeFileSync(join(dir, 'web.webm'), 'x')
    expect(findExportFile(dir, '最終成品（中文旁白）.mp4')).toEqual({
      path: join(dir, '最終成品（中文旁白）.mp4'),
      mime: 'video/mp4',
    })
    expect(findExportFile(dir, 'clip.MOV')?.mime).toBe('video/quicktime')
    expect(findExportFile(dir, 'web.webm')?.mime).toBe('video/webm')
  })

  it('不是影片、不存在、資料夾、隱藏檔、資料夾外面的檔案，一律找不到', () => {
    writeFileSync(join(dir, 'notes.txt'), 'x')
    writeFileSync(join(dir, '.secret.mp4'), 'x')
    mkdirSync(join(dir, 'folder.mp4'))
    writeFileSync(join(root, 'outside.mp4'), 'x')
    expect(findExportFile(dir, 'notes.txt')).toBeUndefined()
    expect(findExportFile(dir, 'missing.mp4')).toBeUndefined()
    expect(findExportFile(dir, 'folder.mp4')).toBeUndefined()
    expect(findExportFile(dir, '.secret.mp4')).toBeUndefined()
    expect(findExportFile(dir, '../outside.mp4')).toBeUndefined()
    expect(findExportFile(join(root, 'no-such-dir'), 'a.mp4')).toBeUndefined()
  })

  it('exports/ 裡的連結不算檔案（不跟著連結讀到資料夾外面）', () => {
    writeFileSync(join(root, 'outside.mp4'), 'x')
    symlinkSync(join(root, 'outside.mp4'), join(dir, 'link.mp4'))
    expect(findExportFile(dir, 'link.mp4')).toBeUndefined()
  })
})

describe('isPlayableExport', () => {
  it('只有常見的影片副檔名能播', () => {
    expect(isPlayableExport('a.mp4')).toBe(true)
    expect(isPlayableExport('a.WEBM')).toBe(true)
    expect(isPlayableExport('a.txt')).toBe(false)
    expect(isPlayableExport('mp4')).toBe(false)
  })
})
