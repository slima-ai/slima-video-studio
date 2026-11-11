# 內建字型（預告片的文字卡、片名卡）

|              |                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 字型         | Noto Sans TC，Bold（`NotoSansTC-Bold.otf`，版本 2.004），沒有修改                                                                                     |
| 授權         | SIL Open Font License 1.1（全文在 `OFL.txt`，字型檔 name 表的 13、14 欄也寫了）；允許商用、可放進影片、可隨 App 散布                                  |
| 來源         | https://github.com/notofonts/noto-cjk ，路徑 `Sans/SubsetOTF/TC/NotoSansTC-Bold.otf`，commit `165c01b46ea533872e002e0785ff17e44f6d97d8`（2021-04-30） |
| 授權全文來源 | 同一個 repo 的 `Sans/LICENSE`                                                                                                                         |
| SHA-256      | `55420b259eb119bf5f2a0aadba10cf9d736c12d64ab93e78546d69ef5f43558b`                                                                                    |
| 大小         | 5,839,972 bytes（約 5.6 MB）                                                                                                                          |

只帶一個字重（Bold）：片名卡與字卡都用粗體。字型載入失敗時，字卡退回系統字型並在 log 記一筆（`card font failed to load`）。
換字型或換版本時要同步改 `tools/licenses/generate-third-party-notices.mjs` 裡的說明，並重新產生 `THIRD-PARTY-NOTICES.md`，
還要把 `CARD_LAYOUT_VERSION`（`src/main/cards/card-service.ts`）加一。
