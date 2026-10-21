import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Markdown, renderBlocks } from './markdown'
import { cpuNowMs } from '../../test/cpu-time'

afterEach(cleanup)

const view = (text: string): HTMLElement => render(<Markdown text={text} />).container

describe('Markdown：看得懂的樣子', () => {
  it('粗體、斜體、刪除線、行內程式碼', () => {
    const c = view('這是 **重點**、*斜的*、~~劃掉~~，呼叫 `get_capabilities` 先。')
    expect(c.querySelector('strong')?.textContent).toBe('重點')
    expect(c.querySelector('em')?.textContent).toBe('斜的')
    expect(c.querySelector('del')?.textContent).toBe('劃掉')
    expect(c.querySelector('code')?.textContent).toBe('get_capabilities')
    // 文字裡的 ** 標記不會留在畫面上
    expect(c.textContent).not.toContain('**')
  })

  it('函式名裡的底線不會被當成斜體：get_capabilities 和 load_guide 照樣顯示', () => {
    const c = view('先 get_capabilities 再 load_guide。')
    expect(c.querySelector('em')).toBeNull()
    expect(c.textContent).toBe('先 get_capabilities 再 load_guide。')
  })

  it('清單：無序、有序、巢狀', () => {
    const c = view('- 第一\n- 第二\n  - 子項\n\n1. 甲\n2. 乙')
    const ul = c.querySelector('ul')
    expect(ul?.querySelectorAll(':scope > li')).toHaveLength(2)
    expect(ul?.querySelector('li ul li')?.textContent).toBe('子項')
    expect(c.querySelectorAll('ol > li')).toHaveLength(2)
  })

  it('表格：標題列、資料列都在，格子裡的粗體也算', () => {
    const c = view('| # | 景別 | 秒數 |\n|---|---|---|\n| 1 | **大遠景** | 7 |\n| 2 | 中景 | 6 |')
    expect(c.querySelectorAll('th')).toHaveLength(3)
    expect([...c.querySelectorAll('th')].map((e) => e.textContent)).toEqual(['#', '景別', '秒數'])
    expect(c.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(c.querySelector('tbody td:nth-child(2) strong')?.textContent).toBe('大遠景')
  })

  it('程式碼區塊：等寬、可橫向捲動，內容原樣；沒收尾（串流到一半）也先顯示成程式碼', () => {
    const closed = view('說明\n\n```json\n{"a": 1}\n```\n\n後面')
    const pre = closed.querySelector('pre')
    expect(pre?.textContent).toBe('{"a": 1}')
    expect(pre?.className).toContain('overflow-x-auto')
    expect(pre?.className).toContain('font-mono')
    cleanup()
    const open = view('```\n還在寫的程式')
    expect(open.querySelector('pre')?.textContent).toBe('還在寫的程式')
  })

  it('標題、引用、分隔線、單一換行', () => {
    const c = view('## 小標\n\n> 引用的話\n\n---\n\n第一行\n第二行')
    expect(screen.getByText('小標').className).toContain('font-semibold')
    expect(c.querySelector('blockquote')?.textContent).toBe('引用的話')
    expect(c.querySelector('hr')).not.toBeNull()
    expect(screen.getByText(/第一行/).textContent).toBe('第一行\n第二行')
  })

  it('沒關起來的標記原樣顯示，不會吃掉字', () => {
    expect(view('只有一邊 **還沒寫完').textContent).toBe('只有一邊 **還沒寫完')
    cleanup()
    expect(view('一個 * 星號和 5 * 3 = 15').textContent).toBe('一個 * 星號和 5 * 3 = 15')
  })
})

describe('Markdown：不安全的東西只會變成字，不會執行', () => {
  const dangerous = (c: HTMLElement): Element[] => [
    ...c.querySelectorAll('script, img, iframe, a, object, embed, style, link, form, svg'),
  ]

  it('<img onerror>：顯示成原始的字，畫面上沒有 img 元素、沒有 onerror 屬性', () => {
    const c = view('看這個 <img src=x onerror="alert(1)"> 圖')
    expect(dangerous(c)).toEqual([])
    expect(c.querySelector('[onerror]')).toBeNull()
    expect(c.textContent).toBe('看這個 <img src=x onerror="alert(1)"> 圖')
  })

  it('<script>：顯示成原始的字，不會產生 script 元素', () => {
    const c = view('<script>window.__pwned = true</script>')
    expect(dangerous(c)).toEqual([])
    expect(c.textContent).toBe('<script>window.__pwned = true</script>')
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  it('javascript: 連結：只剩文字，沒有 a 元素、網址不顯示', () => {
    const c = view('[點我](javascript:alert(1)) 和 [另一個](data:text/html;base64,AAAA)')
    expect(dangerous(c)).toEqual([])
    expect(c.textContent).toBe('點我 和 另一個')
    expect(c.innerHTML).not.toContain('javascript')
  })

  it('一般 http 連結：不做成可點的連結，文字後面附網址讓使用者自己看', () => {
    const c = view('看 [說明](https://example.com/docs) 吧')
    expect(c.querySelector('a')).toBeNull()
    expect(c.textContent).toBe('看 說明 (https://example.com/docs) 吧')
  })

  it('遠端圖片 ![](http://…) 不載入：沒有 img，只顯示替代文字', () => {
    const c = view('![雨夜街角](http://evil.example/track.png?x=1)')
    expect(dangerous(c)).toEqual([])
    expect(c.textContent).toBe('雨夜街角')
    expect(c.innerHTML).not.toContain('evil.example')
  })

  it('HTML 混在表格、清單、行內程式碼裡也一樣只是字', () => {
    const c = view(
      '| a |\n|---|\n| <img src=x onerror=alert(1)> |\n\n- <script>x</script>\n\n`<iframe src=//evil>`',
    )
    expect(dangerous(c)).toEqual([])
    expect(c.querySelector('td')?.textContent).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('Markdown：沒收尾的長輸入不會卡住（串流時每來一段就整則重畫）', () => {
  // 絕對時間只是粗網：量的是這個行程用掉的 CPU 時間（被別的行程搶走的不算，機器忙不會紅；正常每個案例 2～20 毫秒，
  // 門檻留 50 倍），退化成 n² 時（十萬字會是好幾秒）一定紅；精準的退化檢查看下面的倍數
  const MAX_MS = 1000
  const big = 20_000
  const cases: [string, string][] = [
    ['未收尾的圖片', `![a](${'x'.repeat(big)}`],
    ['未收尾的連結', `[a](${'x'.repeat(big)}`],
    ['未收尾的粗體', `**${'a'.repeat(big)}`],
    ['未收尾的行內程式碼', `\`${'字'.repeat(big)}`],
    ['未收尾的斜體', `*${'a'.repeat(big)}`],
    ['一堆沒收尾的圖片開頭', '![a](xx '.repeat(big / 8)],
    ['一堆括號', `[a](${'('.repeat(big)}`],
    ['一大串沒有換行的字', '字'.repeat(big * 5)],
  ]
  for (const [name, input] of cases) {
    it(`${name}（${String(input.length)} 字）用的 CPU 時間在 ${String(MAX_MS)} 毫秒內畫完，而且字一個都沒少`, () => {
      const start = cpuNowMs()
      const c = view(input)
      const ms = cpuNowMs() - start
      expect(ms).toBeLessThan(MAX_MS)
      // 沒收尾的標記原樣當文字：畫面上的字跟輸入一樣長（圖片、連結例外：它們成立時才會被改寫）
      if (!name.includes('一堆沒收尾的圖片')) expect(c.textContent.length).toBeGreaterThan(big / 2)
    })
  }

  it('標記很多的長輸入：時間跟長度成正比（不是 n²）——長度變 4 倍，時間不到 8 倍', () => {
    // 比的是兩種長度之間的倍數：線性約 4 倍（實測 4～5.3）、平方約 16 倍（實測 15），門檻 8 倍在兩者中間。
    // 機器忙不忙不能讓它紅，所以：量的是這個行程實際用掉的 CPU 時間（不是牆鐘時間，被別的行程搶走的不算）、
    // 只量解析（renderBlocks），不含 jsdom 的畫面更新（那部分垃圾回收的雜訊大）、
    // 每種長度跑 5 次取最小的（垃圾回收偶爾多出來的那幾次不影響）。
    // 輸入是標記和一般的字混在一起：標記那邊和「每個字」那邊的 n² 都量得到
    const mixed = (n: number): string =>
      `*a **b ~~c \`d [e](f) ![g](h) ${'字'.repeat(30)}`.repeat(n)
    // 渲染端的型別沒有 node 的 process；測試是在 node 裡跑的，用得到
    const { process: nodeProcess } = globalThis as unknown as {
      process: { cpuUsage: () => { user: number; system: number } }
    }
    const cpuMs = (): number => {
      const { user, system } = nodeProcess.cpuUsage()
      return (user + system) / 1000
    }
    const fastest = (n: number): number => {
      let best = Infinity
      for (let run = 0; run < 5; run++) {
        const start = cpuMs()
        void renderBlocks(mixed(n))
        best = Math.min(best, cpuMs() - start)
      }
      return Math.max(best, 1)
    }
    fastest(500) // 暖機
    const small = fastest(1500)
    const large = fastest(6000)
    expect(large / small).toBeLessThan(8)
  })
})
