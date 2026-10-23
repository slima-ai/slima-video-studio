const HAN = /[㐀-鿿]/
/** 平假名、片假名（含半形）：有就是日文，不是中文。 */
const KANA = /[぀-ゟ゠-ヿｦ-ﾟ]/
/** 韓文字母：有就是韓文，不是中文（韓文偶爾夾漢字）。 */
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/

/**
 * 這段文字（使用者的故事、角色描述）算不算中文：有漢字，而且沒有平假名、片假名、韓文字母。
 * 日文、韓文也有漢字，所以不能只看有沒有漢字；英文與其他沒有漢字的語言都不算中文。
 * 中英混著寫（例如英文故事裡有個中文名字）算中文——要細分比例再改這裡。
 */
export function isChineseText(text: string): boolean {
  return HAN.test(text) && !KANA.test(text) && !HANGUL.test(text)
}

/**
 * 給 AI 的提示（中文寫的）附一句「故事不是中文，請用故事的語言寫」。
 * 內容是中文就回空字串——**中文的提示一字不改**（提示會影響快取，改了已存的結果都會被標成需要重跑）。
 * `content` 只放使用者寫的內容（故事、標題、摘要、名字…），不要放 App 自己加的中文標籤，否則永遠是中文。
 * `instruction` 是這一個提示要 AI 用故事語言寫的欄位與規矩。
 */
export function storyLanguageNote(content: string, instruction: string): string {
  return isChineseText(content) ? '' : instruction
}
