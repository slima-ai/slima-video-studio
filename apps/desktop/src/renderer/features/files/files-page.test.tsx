import type { FileEntry, FilesSnapshot } from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { FilesPage } from './files-page'

afterEach(cleanup)

const file = (extra: Partial<FileEntry> = {}): FileEntry => ({
  hash: 'a'.repeat(64),
  kind: 'image',
  mime: 'image/png',
  bytes: 1_572_864,
  width: 1280,
  height: 720,
  createdAt: '2026-10-12T08:30:00.000Z',
  path: '/tmp/p/assets/aa/aaaa.png',
  usedBy: ['第 1 鏡・第一張畫面 v1（採用中）'],
  ...extra,
})

const snapshot = (files: FileEntry[], extra: Partial<FilesSnapshot> = {}): FilesSnapshot => ({
  files,
  exports: [],
  totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
  projectDir: '/tmp/p',
  ...extra,
})

describe('FilesPage', () => {
  it('沒有檔案 → 說明檔案怎麼來', async () => {
    installFakeSvs()
    render(<FilesPage />)
    expect((await screen.findByTestId('files-empty')).textContent).toContain('到畫布寫一句話')
  })

  it('每個檔案顯示大小、解析度、用途與位置；總大小在上方', async () => {
    installFakeSvs({
      'files.list': () =>
        snapshot([
          file(),
          file({
            hash: 'b'.repeat(64),
            kind: 'video',
            mime: 'video/mp4',
            bytes: 900,
            width: undefined,
            height: undefined,
            durationSec: 3,
            usedBy: [],
            path: '/tmp/p/assets/bb/bbbb.mp4',
          }),
        ]),
    })
    render(<FilesPage />)
    const rows = await screen.findAllByTestId('file')
    expect(rows).toHaveLength(2)
    const [image, video] = rows
    if (!image || !video) throw new Error('應該有兩筆')
    expect(within(image).getByTestId('file-details').textContent).toBe('1280×720・1.5 MB')
    expect(within(image).getByTestId('file-used-by').textContent).toContain(
      '第 1 鏡・第一張畫面 v1（採用中）',
    )
    expect(within(video).getByTestId('file-details').textContent).toBe('3.0 秒・900 B')
    expect(within(video).getByTestId('file-unused')).toBeTruthy()
    expect(screen.getByTestId('files-summary').textContent).toContain('共 2 個檔案')
    expect(screen.getByTestId('files-project-dir').textContent).toContain('/tmp/p')
  })

  it('篩選會帶進請求', async () => {
    const svs = installFakeSvs({ 'files.list': () => snapshot([file()]) })
    render(<FilesPage />)
    await screen.findAllByTestId('file')
    fireEvent.click(screen.getByTestId('files-filter-video'))
    await waitFor(() => {
      expect(svs.payloadsOf('files.list').at(-1)).toEqual({ kind: 'video' })
    })
    fireEvent.click(screen.getByTestId('files-filter-unused'))
    await waitFor(() => {
      expect(svs.payloadsOf('files.list').at(-1)).toEqual({ unusedOnly: true })
    })
    fireEvent.click(screen.getByTestId('files-filter-all'))
    await waitFor(() => {
      expect(svs.payloadsOf('files.list').at(-1)).toEqual({})
    })
  })

  it('「在資料夾中顯示」用檔案的雜湊；匯出的成品用檔名；失敗會說明', async () => {
    const svs = installFakeSvs({
      'files.list': () =>
        snapshot([file()], {
          exports: [
            {
              name: 'film.mp4',
              path: '/tmp/p/exports/film.mp4',
              bytes: 2048,
              modifiedAt: '2026-10-12T09:00:00.000Z',
            },
          ],
        }),
      'files.reveal': (payload: { exportName?: string }) => {
        if (payload.exportName) throw appError('找不到這個匯出的檔案，可能已被刪除或搬走。')
        return {}
      },
    })
    render(<FilesPage />)
    fireEvent.click(await screen.findByTestId('file-reveal'))
    await waitFor(() => {
      expect(svs.payloadsOf('files.reveal')).toEqual([{ hash: 'a'.repeat(64) }])
    })
    expect(screen.getByTestId('export').textContent).toContain('film.mp4')
    fireEvent.click(screen.getByTestId('export-reveal'))
    expect((await screen.findByTestId('files-problem')).textContent).toContain('搬走')
  })

  it('影片檔案列和「匯出的成品」都能在原地播：有 ▶ 鈕；成品用 export 網址（中文檔名要編碼）；不是影片的成品沒有播放鈕', async () => {
    installFakeSvs({
      'files.list': () =>
        snapshot(
          [file({ hash: 'b'.repeat(64), kind: 'video', mime: 'video/mp4', usedBy: [] }), file()],
          {
            exports: [
              {
                name: '最終成品（中文旁白）.mp4',
                path: '/tmp/p/exports/最終成品（中文旁白）.mp4',
                bytes: 6_400_000,
                modifiedAt: '2026-10-23T10:01:01.000Z',
              },
              {
                name: 'notes.txt',
                path: '/tmp/p/exports/notes.txt',
                bytes: 12,
                modifiedAt: '2026-10-23T10:01:01.000Z',
              },
            ],
          },
        ),
    })
    render(<FilesPage />)
    const exports = await screen.findAllByTestId('export')
    const [film, notes] = exports
    if (!film || !notes) throw new Error('應該有兩筆成品')
    const player = within(film).getByTestId('inline-video')
    expect(player.getAttribute('src')).toBe(
      `svs-asset://export/${encodeURIComponent('最終成品（中文旁白）.mp4')}`,
    )
    expect(within(film).getByRole('button', { name: '播放影片' })).toBeTruthy()
    expect(within(notes).queryByTestId('inline-video')).toBeNull()
    const rows = screen.getAllByTestId('file')
    const [videoRow, imageRow] = rows
    if (!videoRow || !imageRow) throw new Error('應該有兩筆檔案')
    expect(within(videoRow).getByTestId('inline-video').getAttribute('src')).toBe(
      `svs-asset://asset/${'b'.repeat(64)}`,
    )
    expect(within(imageRow).queryByTestId('inline-video')).toBeNull()
  })
})
