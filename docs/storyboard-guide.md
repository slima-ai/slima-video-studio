# 分鏡準則

AI 把故事拆成鏡頭時，會連同一份「分鏡準則」一起交給文字模型參考：快速開始的「AI 拆鏡」和分場裡的「讓 AI 分畫面」都會用。

- **在哪裡看、改：** 設定 → 分鏡準則。內容就是預設的那份文字，可以直接改、儲存；「恢復預設」一鍵換回內建版本。
- **沒改過的話：** 設定檔裡的 `storyboardGuide` 是空字串，用程式內建的預設（`packages/schema/src/domain/storyboard-guide.ts` 的 `DEFAULT_STORYBOARD_GUIDE`）。之後預設更新，沒自訂過的人會跟著用到新版。
- **改過的話：** 存的是你的文字（上限 4000 字）。如果你把內容改回跟預設一模一樣再儲存，會自動存成「用預設」。
- **不加額外步驟：** 沒有確認視窗、沒有開關；拆鏡時一律帶著這份準則。把內容清空再儲存，等於恢復預設。
- **費用：** 準則每次拆鏡會多送約 1,500 個 token 的輸入（現在 1,182 個字，第 9 條「鏡頭語言」約佔 400 字；token 數是照字數估的，不是量的），花費預估已經把它算進去（預估用「字數 × 1.5」算輸入 token）。

## 預設內容怎麼來的

預設準則是整理拍片的基本概念、用我們自己的話寫成的簡短清單，不是從任何一份教材抄來的。寫之前參考了下面這些公開資料；每一條對應到哪些資料如下。

| 準則的條目                             | 參考的概念                                                                                               | 出處                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 一個鏡頭只做一件事；8 替影片模型著想 | 圖生影片的提示：一次只指定一個主要運鏡、只描述一個動作、避免「然後」之類的串接詞、用正面描述不要用否定句 | Runway〈AI video prompting guide〉<https://runway.com/resources/ai-video-prompting-guide>                                                                                                                                                                                                |
| 2 景別要有起伏                         | 用遠景開場交代環境；越近越親密、越有情緒；遠景強調孤立與場所                                             | Learn About Film〈Continuity〉<https://learnaboutfilm.com/film-language/sequence/>；Light Stalking〈Camera shot types〉<https://lightstalking.com/camera-shot-types/>                                                                                                                    |
| 3 相鄰兩鏡要有明顯差別                 | 換鏡時機位至少換約 30 度，且景別也要變，否則像跳接                                                       | Learn About Film〈Continuity〉；Yale Film Analysis〈Editing〉<https://filmanalysis.yale.edu/editing/>                                                                                                                                                                                    |
| 4 節奏有高低                           | 剪接頻率與鏡頭長短影響緊張與平靜；節奏要有變化才有張力；鏡頭內的運動也算節奏                             | Lightworks〈Rhythm and Pace〉<https://lwks.com/blog/rhythm-and-pace-crafting-the-tempo-of-film>；Film Daft〈What is Pacing in Film〉<https://filmdaft.com/what-is-pacing-in-film-definition-examples/>                                                                                   |
| 5 鏡頭之間要接得上                     | 動作剪接（在動作中途切）、視線對接（角色看向畫面外、下一鏡給看到的東西）、180 度軸線規則與行進方向一致   | Learn About Film〈Continuity〉；Adobe〈What is the 180-degree rule〉<https://www.adobe.com/sg/creativecloud/video/discover/what-is-the-180-degree-rule.html>；Salisbury University〈The Grammar of Television and Film〉<https://faculty.salisbury.edu/~axsharma/mywebs/efp/gramtv.html> |
| 6 運鏡要有理由                         | 運鏡類別與各自的用途；一次只選一個主要運鏡                                                               | Runway〈AI video prompting guide〉                                                                                                                                                                                                                                                       |
| 7 每個畫面都要看得懂                   | 分鏡的目的是讓人預先看出問題、畫面要清楚好讀；圖生影片要先講清楚主體與要保持不變的部分                   | StudioBinder〈Storyboard rules〉<https://studiobinder.com/blog/storyboard-rules>；Runway〈AI video prompting guide〉                                                                                                                                                                     |
| 9 鏡頭語言                             | 景別、角度、運鏡各自的用途與對到 App 欄位的 id、節奏長短、光線一致；接片只有直接切（App 沒有溶接、淡出） | 我們自己用拍片通識寫的，沒有對照任何一份來源的句子；同一份內容的完整版是 MCP 的 `load_guide("cinematography")`（`apps/desktop/src/main/mcp/tools/guides.ts`），這裡是給 App 自己的拆鏡模型用的精簡版                                                                                     |

## 沒查到、沒驗證的部分

- 條目 9「鏡頭語言」是用拍片通識寫的、對到 App 的欄位 id，**沒有用真的文字模型比較過有沒有讓鏡頭變好**；它會讓拆鏡模型更常用 `static`、`push_in`、`pull_out` 這幾個 id，這是想要的，但跟「沒有這一條」比較時要用同一個故事。

- 條目 8 裡「角色在大景別裡通常比近距離特寫更穩定」是我們自己做影片實驗的經驗（角色被拉近或做大動作時，模型容易替它加上不存在的部位），不是網路資料；其他角色或模型不一定一樣。
- 「首尾幀」的使用建議（首幀要構圖清楚）是常見說法，我沒有找到可靠的官方說明，所以準則裡只寫了「首幀要是構圖清楚、可以直接畫出來的畫面」，沒有寫更細的規則。
- 這份準則會不會讓 AI 拆出比較好的鏡頭，**還沒有用真的文字模型比較過**（沒有花 API 費用跑）；目前驗證的只有「準則會被帶進提示、設定看得到也改得動」。
- 上面的資料多數是一般性的教學文章與課程講義，不是經過審查的研究；當作常見的做法就好。
