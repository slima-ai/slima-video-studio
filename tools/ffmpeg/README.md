# 內建的 FFmpeg

安裝檔裡的 FFmpeg 是從原始碼編的，**GPL v2 或更新版、只開 libx264、沒有 nonfree**，放在 App 的 `resources/ffmpeg/`，
旁邊附 `COPYING.GPLv2`、`COPYING.GPLv3` 與 `SOURCE.txt`（原始碼取得方式）。App 把它當**獨立的外部程式**用子行程呼叫
（`packages/media`），沒有連結進 App 的程式碼，所以 FFmpeg 的 GPL 只管這個執行檔，不會讓整個專案變成 GPL。

## 為什麼不用 ffmpeg-static 的

`ffmpeg-static` 下載的 macOS 版（FFmpeg 6.0）是用 `--enable-nonfree` 編的，`ffmpeg -L` 會印出
「This version of ffmpeg has nonfree parts compiled in」。FFmpeg 的說法是這種版本不可合法再散布，所以 macOS 安裝檔排除它
（`apps/desktop/electron-builder.yml` 的 `mac.files`），改放自己編的。

## 重編（macOS）

```bash
tools/ffmpeg/build-macos.sh        # 輸出到 apps/desktop/build/ffmpeg/<arm64|x64>/
```

- 版本與雜湊都寫死在腳本裡：FFmpeg 6.1.1（SHA-256 核對、有 gpg 就再驗官方簽章）、x264 stable 的固定 commit。
- 只需要 Xcode Command Line Tools、curl、git、shasum；**arm64 不需要 nasm**。Intel（x86_64）要先裝 nasm，並在 Intel 機器上跑。
- 平行工作數預設 8（`JOBS=4 tools/ffmpeg/build-macos.sh` 可以調低）。約 2～3 分鐘。
- 腳本結束前會檢查：沒有 `--enable-nonfree`、有 libx264 與 aac。

## 散布時要做的（GPL 義務）

1. 附 GPL 全文：已隨執行檔放在 `resources/ffmpeg/`。
2. 提供對應原始碼：`SOURCE.txt` 寫了 FFmpeg 與 x264 的版本、網址與 commit；Release 頁面也要放同樣的說明。
3. 不移除或隱藏 FFmpeg 的版權與授權聲明。
4. H.264、AAC 的**專利**授權與版權授權是兩回事，這份文件沒有處理，由 Slima 決定。

## Windows：固定來源（不是我們編的）

```bash
tools/ffmpeg/fetch-windows.sh      # 輸出到 apps/desktop/build/ffmpeg/win-x64/
```

- 來源是 gyan.dev 的 **6.1.1 essentials build**（GPL v3，沒有 `--enable-nonfree`），用 GitHub 鏡像的固定發佈檔，腳本核對 zip 與 `ffmpeg.exe` 的 SHA-256。這個 `ffmpeg.exe` 就是 `ffmpeg-static` 目前附的那個（兩邊 SHA-256 相同，2026-10-19 核對）；固定下來之後，安裝檔不再依賴 `ffmpeg-static` 在安裝當下下載什麼。
- 放進安裝檔的 `resources/ffmpeg/`：`ffmpeg.exe`、`COPYING.GPLv3`、`README-gyan.txt`、`SOURCE.txt`；`ffmpeg-static` 的 `ffmpeg.exe` 排除（`electron-builder.yml` 的 `win.files`），缺檔時 `afterPack` 讓打包失敗。
- **已知缺口（GPL 義務）：** 這個執行檔靜態連結約 35 個第三方函式庫（含 GPL 的 x264、x265、xvid）。gyan.dev 的發佈只註明 FFmpeg 自己的原始碼 commit，**沒有提供那些函式庫的對應原始碼**，我們也沒有自己保存一份。要完整履行，二選一：①自己從原始碼編 Windows 版（比照 macOS：只開 libx264，需要 MSYS2／mingw-w64 與 nasm，建議在公開 repo 的 Windows runner 上做），②自己保存並提供那些函式庫的原始碼。目前的做法只是把來源與雜湊固定下來、附上授權全文，**不算完整履行**。

## 還沒做

- Intel Mac（x64）：要在 Intel 機器或 CI 上跑 `build-macos.sh`；`electron-builder.yml` 的 mac target 目前只列 arm64，做得出 `build/ffmpeg/x64/` 之後再把 x64 加回去。沒有 `build/ffmpeg/x64/` 卻硬打 x64（`--x64`）時會**失敗**（`afterPack` 勾子 `check-bundled-ffmpeg.cjs`；electron-builder 自己對缺的 `extraResources` 只會警告、照樣打包，所以要靠這道檢查）。
- Linux：沿用 `ffmpeg-static`，沒有查它的建置選項。
