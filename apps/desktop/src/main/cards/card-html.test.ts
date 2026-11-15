import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { breakText } from './break-text'

import {
  cardSizeFor,
  creditsHtml,
  escapeHtml,
  layoutCardText,
  overlayHtml,
  textCardHtml,
  titleCardHtml,
} from './card-html'

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')
const FONT = 'file:///app/resources/fonts/NotoSansTC-Bold.otf'

describe('creditsHtml：片尾 AI 服務字卡的 HTML 跟搬家之前逐字相同', () => {
  it('三組輸入的雜湊跟搬家之前一樣', () => {
    expect(
      sha(
        creditsHtml(
          ['Video generated with Kling AI', 'Voice by MiniMax', 'Made with Slima Video Studio'],
          720,
        ),
      ),
    ).toBe('7f6a72a4d29aad136abb15c313c386cf34a1f6f0dcd68e7bd39bd60ffc582341')
    expect(sha(creditsHtml(['Made with Slima Video Studio'], 1080))).toBe(
      'b3dca0577564abb27fce2eddbf76258ed370e102ff268ab53b85f700fad8252a',
    )
    expect(sha(creditsHtml(['A <b>&</b> "B"', 'Made with Slima Video Studio'], 1280))).toBe(
      '9b29915aba594bb36ddd22f8800fd0c6767caea0a7a01acc0701d717ad667435',
    )
  })
})

describe('escapeHtml', () => {
  it('標籤、引號、& 都變成字元參照；表情符號與中文原樣保留', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      '&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62; &#38; &#39;y&#39;',
    )
    expect(escapeHtml('他回來了 😀 👨‍👩‍👧')).toBe('他回來了 😀 👨‍👩‍👧')
  })
})

describe('layoutCardText：幾個字、多大、幾行', () => {
  const sizes = [
    { width: 1280, height: 720 },
    { width: 720, height: 1280 },
    { width: 1024, height: 1024 },
  ]
  const box = (s: { width: number; height: number }) => ({
    widthPx: s.width * 0.8,
    heightPx: s.height * 0.5,
  })
  const base = (s: { width: number; height: number }) => ({
    basePx: Math.round(Math.min(s.width, s.height) * 0.12),
    minPx: Math.round(Math.min(s.width, s.height) * 0.03),
  })

  it('12 個中文字以內：一行（橫式、直式、方形都是）', () => {
    for (const size of sizes) {
      for (const text of ['他回來了', '一二三四五六七八九十甲乙']) {
        const layout = layoutCardText(text, box(size), base(size))
        expect(layout.lineCount, `${text} ${String(size.width)}x${String(size.height)}`).toBe(1)
        expect(layout.fontSizePx).toBeGreaterThan(0)
      }
    }
  })

  it('超過 12 個字：自動縮字或換行，整段仍在框裡（最多 3 行，高度不超過框；字不小於下限）', () => {
    const text = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'
    for (const size of sizes) {
      for (const length of [13, 20, 30, 45, 60]) {
        const slice = Array.from(text.repeat(3)).slice(0, length).join('')
        const layout = layoutCardText(slice, box(size), base(size))
        expect(layout.lineCount).toBeLessThanOrEqual(3)
        expect(layout.lineCount * layout.fontSizePx * 1.3).toBeLessThanOrEqual(
          box(size).heightPx + 1,
        )
        expect(layout.fontSizePx).toBeGreaterThanOrEqual(base(size).minPx)
        // 估計的寬度：每行不超過框寬
        expect(layout.fontSizePx * length).toBeLessThanOrEqual(
          box(size).widthPx * layout.lineCount * 1.01,
        )
      }
    }
  })

  it('字距 .02em 也算進寬度：一行的字加字距不超過框寬（不會因為字距多出來而在行尾掉一個字）', () => {
    for (const size of sizes) {
      const text = '一二三四五六七八九十甲乙'
      const layout = layoutCardText(text, box(size), base(size))
      expect(layout.lineCount).toBe(1)
      const width = layout.fontSizePx * Array.from(text).length * 1.02
      expect(width, `${String(size.width)}x${String(size.height)}`).toBeLessThanOrEqual(
        box(size).widthPx,
      )
    }
  })

  it('越長字越小（不會變大）', () => {
    const size = sizes[0]
    if (!size) throw new Error('no size')
    const short = layoutCardText('他回來了', box(size), base(size))
    const long = layoutCardText('一'.repeat(40), box(size), base(size))
    expect(long.fontSizePx).toBeLessThanOrEqual(short.fontSizePx)
  })

  it('英文照單字寬度估：6 個單字一行', () => {
    const size = sizes[0]
    if (!size) throw new Error('no size')
    expect(layoutCardText('He is coming back again', box(size), base(size)).lineCount).toBe(1)
  })
})

describe('cardSizeFor：寬高跟著專案比例', () => {
  it('橫式 1280×720、直式 720×1280，其他比例也是偶數', () => {
    expect(cardSizeFor('16:9')).toEqual({ width: 1280, height: 720 })
    expect(cardSizeFor('9:16')).toEqual({ width: 720, height: 1280 })
    for (const ratio of ['1:1', '4:3', '21:9'] as const) {
      const { width, height } = cardSizeFor(ratio)
      expect(width % 2).toBe(0)
      expect(height % 2).toBe(0)
    }
  })
})

describe('textCardHtml：文字卡', () => {
  it('黑底、主文字與副文字；<script>、引號、換行、表情符號都被當成文字', () => {
    const html = textCardHtml({
      text: '<script>alert(1)</script> "他"\n回來了 😀',
      subtext: `& '第一章'`,
      width: 1280,
      height: 720,
    })
    expect(html).not.toContain('<script')
    expect(html).toContain('&#60;script&#62;')
    expect(html).toContain('&#34;他&#34;')
    expect(html).toContain('<br>')
    expect(html).toContain('😀')
    expect(html).toContain('&#38; &#39;第一章&#39;')
    expect(html).toContain('background:#000')
  })

  it('換行時不留孤字：23 個字會排成三行，每一行都不少於 3 個字（不是 11＋11＋1）', () => {
    const text = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅'
    const html = textCardHtml({ text, width: 1280, height: 720 })
    const main = /<div class="main">(.*?)<\/div>/.exec(html)?.[1] ?? ''
    const lines = main.split('<br>')
    expect(lines).toHaveLength(3)
    for (const line of lines) expect(Array.from(line).length).toBeGreaterThanOrEqual(3)
    expect(lines.join('')).toBe(text)
  })

  it('自己換過行的字照原樣；一行放得下的不加換行；副文字太長也不留孤字', () => {
    const own = textCardHtml({ text: '他回來了\n帶著光', width: 1280, height: 720 })
    expect(own).toContain('<div class="main">他回來了<br>帶著光</div>')
    const short = textCardHtml({ text: '他回來了', width: 1280, height: 720 })
    expect(short).toContain('<div class="main">他回來了</div>')
    const sub = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午'
    const html = textCardHtml({ text: '他回來了', subtext: sub, width: 720, height: 1280 })
    const subLines = (/<div class="sub">(.*?)<\/div>/.exec(html)?.[1] ?? '').split('<br>')
    for (const line of subLines) expect(Array.from(line).length).toBeGreaterThanOrEqual(3)
  })

  it('有內容安全政策：不能載入腳本、不能連網；沒有字型網址就沒有 @font-face', () => {
    const html = textCardHtml({ text: '他回來了', width: 1280, height: 720 })
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain("default-src 'none'")
    expect(html).not.toContain('@font-face')
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('有字型網址：@font-face 載入它（只收 file:// 開頭的網址），字型家族排在系統字型前面', () => {
    const html = textCardHtml({ text: '他回來了', width: 1280, height: 720, fontUrl: FONT })
    expect(html).toContain('@font-face')
    expect(html).toContain(FONT)
    expect(html).toMatch(/font-family:'SVS Card',/)
    expect(() =>
      textCardHtml({ text: 'x', width: 1280, height: 720, fontUrl: 'https://evil.example/x.otf' }),
    ).toThrow()
    expect(() =>
      textCardHtml({
        text: 'x',
        width: 1280,
        height: 720,
        fontUrl: "file:///a');}</style><script>",
      }),
    ).toThrow()
  })

  it('沒有副文字就沒有副文字那一行', () => {
    const html = textCardHtml({ text: '他回來了', width: 1280, height: 720 })
    expect(html).not.toContain('class="sub"')
  })
})

describe('titleCardHtml：片名卡', () => {
  const base = {
    title: '黑藤裂谷',
    author: '某某作者',
    endLine: '12 月 1 日 全台書店上市',
    width: 1280,
    height: 720,
  }

  it('有封面：封面原圖等比例放進框裡（contain，不拉伸），旁邊是書名、作者、片尾那一行', () => {
    const html = titleCardHtml({ ...base, coverDataUri: 'data:image/png;base64,AAAA' })
    expect(html).toContain('<img')
    expect(html).toContain('src="data:image/png;base64,AAAA"')
    expect(html).toContain('object-fit:contain')
    for (const text of ['黑藤裂谷', '某某作者', '12 月 1 日 全台書店上市'])
      expect(html).toContain(text)
  })

  it('沒有封面：沒有 <img>，文字置中', () => {
    const html = titleCardHtml(base)
    expect(html).not.toContain('<img')
    expect(html).toContain('黑藤裂谷')
  })

  it('封面網址只收 data:image/（不會變成對外連線）', () => {
    expect(() => titleCardHtml({ ...base, coverDataUri: 'https://evil.example/c.png' })).toThrow()
    expect(() => titleCardHtml({ ...base, coverDataUri: 'data:text/html;base64,AAAA' })).toThrow()
    expect(() => titleCardHtml({ ...base, coverDataUri: 'data:image/png;base64,AA"AA' })).toThrow()
  })

  it('書名、作者太長要換行時也不留孤字（直式）', () => {
    const long = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸'
    const html = titleCardHtml({ title: long, author: long, width: 720, height: 1280 })
    for (const cls of ['title', 'author']) {
      const lines = (new RegExp(`<div class="${cls}">(.*?)</div>`).exec(html)?.[1] ?? '').split(
        '<br>',
      )
      if (cls === 'title') expect(lines.length).toBeGreaterThanOrEqual(2)
      for (const line of lines) expect(Array.from(line).length, cls).toBeGreaterThanOrEqual(3)
      expect(lines.join(''), cls).toBe(long)
    }
  })

  it('最底下一行小字（給匯出的 AI 服務標註）：有給才有', () => {
    expect(titleCardHtml(base)).not.toContain('class="footnote"')
    const html = titleCardHtml({ ...base, footnote: 'Video generated with Kling AI <b>' })
    expect(html).toContain('class="footnote"')
    expect(html).toContain('Video generated with Kling AI &#60;b&#62;')
  })

  it('標註用「 · 」隔開的每一項不拆開：放不下時整項換行，不會切在一項的中間', () => {
    const html = titleCardHtml({
      ...base,
      footnote: 'Video generated with Kling AI · Music generated with Google Lyria',
    })
    expect(html).toContain(
      '<span>Video generated with Kling AI</span> <span>Music generated with Google Lyria</span>',
    )
    expect(html).toContain('.footnote span{display:inline-block;')
  })

  it('書名、作者、片尾那一行都被跳脫；橫式與直式的版面不同', () => {
    const html = titleCardHtml({ ...base, title: '<img src=x onerror=1>', author: '"A"&' })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&#60;img src=x onerror=1&#62;')
    expect(html).toContain('&#34;A&#34;&#38;')
    const wide = titleCardHtml({ ...base, coverDataUri: 'data:image/png;base64,AAAA' })
    const tall = titleCardHtml({
      ...base,
      width: 720,
      height: 1280,
      coverDataUri: 'data:image/png;base64,AAAA',
    })
    expect(wide).not.toBe(tall)
    expect(wide).toContain('flex-direction:row')
    expect(tall).toContain('flex-direction:column')
  })
})

describe('breakText：疊字自己斷行（不留孤字）', () => {
  const landscape = { perLine: 12, maxLines: 2 }
  const portrait = { perLine: 9, maxLines: 3 }
  const cases: [string, string, typeof landscape, string[]][] = [
    [
      '12 個字以內：橫式一行',
      '寵辱不驚，閒看庭前花開花落',
      landscape,
      ['寵辱不驚，閒看庭前花開花落'],
    ],
    [
      '直式 12 個字：在離正中間 3 個字以內的標點斷，行尾標點拿掉',
      '寵辱不驚，閒看庭前花開花落',
      portrait,
      ['寵辱不驚', '閒看庭前花開花落'],
    ],
    [
      '橫式 19 個字：離正中間最近的標點在 9 個字後，在那裡斷',
      '先做最重要的一件事，再把待辦清單砍掉一半',
      landscape,
      ['先做最重要的一件事', '再把待辦清單砍掉一半'],
    ],
    [
      '沒有標點：從正中間斷（13 個字 → 7＋6）',
      '一二三四五六七八九十甲乙丙',
      { perLine: 9, maxLines: 2 },
      ['一二三四五六七', '八九十甲乙丙'],
    ],
    [
      '標點離正中間超過 3 個字：不在標點斷，從正中間斷',
      '一二三四五六七八九十，甲乙',
      { perLine: 9, maxLines: 2 },
      ['一二三四五六', '七八九十，甲乙'],
    ],
    [
      '照標點斷會留下少於 3 個字的孤字：改成平均分',
      '一二三四五六七八九，十一',
      portrait,
      ['一二三四五六', '七八九，十一'],
    ],
    [
      '直式 3 行：同樣的做法做兩次（25 個字 → 8＋9＋8）',
      '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰',
      portrait,
      ['一二三四五六七八', '九十甲乙丙丁戊己庚', '辛壬癸子丑寅卯辰'],
    ],
  ]
  for (const [name, text, opts, expected] of cases) {
    it(name, () => {
      expect(breakText(text, opts)).toEqual(expected)
    })
  }

  it('任何情況：每行至少 3 個字、行數不超過上限、把標點拿掉之外的字一個都沒少', () => {
    const samples = [
      '先做最重要的一件事，再把待辦清單砍掉一半',
      '真正的問題不是時間不夠，而是順序錯了',
      '把力氣花在對的地方，剩下的交給時間',
      '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑',
    ]
    for (const text of samples) {
      for (const opts of [landscape, portrait]) {
        const lines = breakText(text, opts)
        expect(lines.length, text).toBeLessThanOrEqual(opts.maxLines)
        for (const line of lines) {
          if (lines.length > 1)
            expect(line.replace(/[，、；：]/g, '').length, line).toBeGreaterThanOrEqual(3)
        }
        expect(lines.join('').replace(/[，、；：]/g, '')).toBe(text.replace(/[，、；：]/g, ''))
      }
    }
  })

  it('英文：照單字斷，兩行盡量平均；一行放得下就一行', () => {
    expect(breakText('Focus beats busyness', landscape)).toEqual(['Focus beats busyness'])
    expect(breakText('Do the one thing that matters most before anything else', landscape)).toEqual(
      ['Do the one thing that matters', 'most before anything else'],
    )
  })
})

describe('overlayHtml：透明底、字壓在下方的暗帶上', () => {
  const lands = { width: 1280, height: 720 }
  const port = { width: 720, height: 1280 }

  it('透明底（不是黑底）；字級是短邊的 7.5%（720 → 54px）；字用內建字型', () => {
    const html = overlayHtml({ ...lands, text: '寵辱不驚', fontUrl: FONT })
    expect(html).toContain('background:transparent')
    expect(html).not.toContain('background:#000;')
    expect(html).toContain('font-size:54px')
    expect(html).toContain('@font-face')
  })

  it('橫式：字區底邊離畫面底 12%、暗帶佔底下 45%（最底 62% 不透明）；直式：字區中心在 68%、暗帶佔底下 40%', () => {
    const wide = overlayHtml({ ...lands, text: '寵辱不驚' })
    expect(wide).toContain('bottom:12%')
    expect(wide).toContain('height:45%')
    expect(wide).toContain('rgba(0,0,0,.62)')
    const tall = overlayHtml({ ...port, text: '寵辱不驚' })
    expect(tall).toContain('top:68%')
    expect(tall).toContain('translateY(-50%)')
    expect(tall).toContain('height:40%')
  })

  it('每一行各自一個元素（自己斷好，不交給瀏覽器自動換行）；小字另起一行、字級是主文字的一半', () => {
    const html = overlayHtml({
      ...port,
      text: '寵辱不驚，閒看庭前花開花落',
      subtext: '——《菜根譚》',
    })
    expect(html).toContain('寵辱不驚</div><div class="line">閒看庭前花開花落')
    expect(html).toContain('class="sub"')
    expect(html).toContain('font-size:27px')
    expect(html).toContain('white-space:nowrap')
  })

  it('字有跳脫（來自使用者或模型）；沒有小字就沒有小字元素', () => {
    const html = overlayHtml({ ...lands, text: '<img src=x onerror=alert(1)>' })
    expect(html).not.toContain('<img')
    expect(html).toContain('&#60;img')
    expect(html).not.toContain('class="sub"')
  })
})
