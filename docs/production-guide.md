# 製片與一致性指南

用 Claude Code 等 AI 工具接上這個 App 時，AI 在建立角色與場景、挑參考圖、檢查畫面一不一致時，會用 MCP 的 `load_guide("production")` 讀這份做法。

- **在哪裡看、改：** 設定 → 分鏡準則的下面（「製片與一致性指南」）。內容就是預設的那份文字，可以直接改、儲存；「恢復預設」一鍵換回內建版本。
- **為什麼是英文：** 跟其他 MCP 指南一樣，AI 工具讀英文最準；AI 回覆使用者時還是用使用者的語言。
- **沒改過的話：** 設定檔裡的 `productionGuide` 是空字串，用程式內建的預設（`packages/schema/src/domain/production-guide.ts` 的 `DEFAULT_PRODUCTION_GUIDE`）。之後預設更新，沒自訂過的人會跟著用到新版。
- **改過的話：** 存的是你的文字（上限 12,000 字）。如果你把內容改回跟預設一模一樣再儲存，會自動存成「用預設」。
- **不在每個工作階段都載入：** 只有 AI 需要時才讀（`getting-started` 的「角色」那一步和伺服器的簡短說明都會指到它），所以不增加固定成本。
- **寫法：** 講原則和「為什麼」，不寫死張數與模型（那些由 `get_capabilities`、`list_models` 回答）；只提這一版 App 真的有的工具與做法（有測試：指南裡提到的每個工具名稱都必須真的存在）。

## 預設內容怎麼來的

預設指南是用我們自己的話寫的原則與流程，不是從任何一份教材抄來的。寫之前參考了下面這些資料；多數是廠商或一般教學文章（只讀了搜尋摘要的標「摘要」，讀過原文的標「原文」），不是經過審查的研究。

| 指南的段落                              | 參考的概念                                                                                                 | 出處                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Why it is hard／Define first            | 一致性來自「跟著每次生成走的鎖定參考」，不是模型本身；身分（臉、體型）和場景要分開寫、身分文字固定不變     | Kapwing〈How to create a character reference sheet with AI〉<https://www.kapwing.com/resources/how-to-create-a-character-reference-sheet-with-ai/>（摘要）；invideo〈AI character consistency〉<https://invideo.io/blog/ai-character-consistency/>（摘要）；HackerNoon〈How to keep an AI character's face consistent across different scenes〉<https://hackernoon.com/how-to-keep-an-ai-characters-face-consistent-across-different-scenes>（原文） |
| What a reference picture is for（角色） | 要有正面與側面、背面，只給正面時模型得自己發明看不到的那一側，漂移就從這裡進來                             | Sozee 一致性工具比較（摘要，<https://www.sozee.ai/resources/best-ai-tools-nsfw-consistency/>）；Kapwing（摘要）                                                                                                                                                                                                                                                                                                                                      |
| What a reference picture is for（場景） | 先定一張沒有人的寬景當場景的真相、環境要有固定的文字描述；影片模型沒有持久的 3D 場景，幾何要靠參考圖帶進去 | invideo FAQ〈keep the same location consistent〉<https://invideo.io/faq/how-do-you-keep-the-same-location-consistent-across/>（摘要）；MiniMax H3 環境一致性教學 <https://www.seedance.tv/blog/minimax-h3-environment-consistency>（摘要）                                                                                                                                                                                                           |
| Spend the reference slots               | 每個模型收的參考圖張數有限；Google 的官方文件把「物件」與「角色」分開計數                                  | Google〈Image generation〉<https://ai.google.dev/gemini-api/docs/image-generation>（原文）；App 自己的挑圖規則在 `packages/workflows/src/nodes.ts` 的 `pickReferences`                                                                                                                                                                                                                                                                               |
| Look before you spend more              | 圖（便宜）→ 首幀 → 影片，每一關先看過；錯在哪一關就在那一關修                                              | 我們自己的做法（App 本來就是這個順序，見 `getting-started`）                                                                                                                                                                                                                                                                                                                                                                                         |
| When something drifts                   | 修鎖定的文字或參考圖，不要在單一鏡頭的 Prompt 裡一直加字                                                   | 我們自己的經驗；沒有找到對照來源                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Long or busy action                     | 長動作拆成幾個短鏡頭，每鏡一個動作，可以單獨重做                                                           | pippit〈fight scenes with an AI video generator〉<https://www.pippit.ai/blog/how-to-create-fight-scenes-with-an-ai-video-generator>（摘要）；Picsart〈How to make AI fight videos〉<https://picsart.com/blog/how-to-make-ai-fight-videos/>（摘要）                                                                                                                                                                                                   |
| 指南的寫法                              | 簡潔、只放模型本來不知道的事；講原因而不是只下命令；按需載入                                               | Anthropic〈Skill authoring best practices〉<https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices>、〈Prompting best practices〉<https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices>（原文）；Anthropic Engineering〈Writing effective tools for agents〉<https://www.anthropic.com/engineering/writing-tools-for-agents>（原文）                                   |

資料的查閱日期是 2026-10-23；完整的研究與沒查到的部分在 HQ `staff/handoffs/2026-10-23-studio2-vs-consistency-research.md`。

## 沒查到、沒驗證的部分

- **這份指南會不會讓 AI 做得比較好，還沒有量過。** 目前驗證的只有「指南會被載入、設定看得到也改得動、提到的工具都存在」。要量的話可以沿用分鏡準則的做法（同一批故事前後各跑幾次、比欄位分布，見 `docs/storyboard-guide.md`），再加真實花費的前後比較（指南有沒有讓 AI 多生了參考圖、多花錢）。
- **「臉一張、不帶臉的身體另一張」** 這個常見說法只找到一篇部落格（HackerNoon），沒有廠商文件或實驗支持，我們也沒有測過（兩隻示範用的角色是沒有手腳的圓球，測不出來）。指南裡把它列在「Not yet proven」，沒有當成規則。
- **多張參考圖送給影片模型是否更穩**：沒有測過；指南只說「沒驗證」。
- **「角色多的鏡頭，每個角色分到的參考圖變少」**：這是從 App 的挑圖規則（`pickReferences`：場景占一張、其餘依序分給每個角色）讀出來的，不是實測。
- 角色的「附上原版設定圖」（`list_project_images`、`add_character_reference`）是 #159 之後有的，指南已提到；場景卡目前只能由使用者在畫布上建，AI 還沒有工具建立；指南已照實寫（「You cannot create place cards with tools yet」）。之後有了工具要回頭改這一句。
- 三視圖同理：AI 只看得到 `hasTurnaround`，不能建立。
