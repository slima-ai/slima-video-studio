# Slima Video Studio

**English** · [繁體中文](README.zh-TW.md)

A free, open-source desktop studio that turns a story into an AI video. You write a sentence or paste a script; the app breaks it into scenes and shots, generates a first frame and a clip for every shot, adds narration and music, and joins them into one finished film. Everything lives on an editable node canvas, so you can fix any single shot and re-run just that part.

It is **bring-your-own-key**: the app has no server and provides no models. You connect your own AI service account (one [OpenRouter](https://openrouter.ai) key is enough for text, images and video), and you see the estimated cost before anything is generated.

> **Status: early (v0.x).** It works end to end on macOS (Apple Silicon). A Windows build exists but has not been tested on a real Windows machine and is not offered for download yet. The installers are not code-signed yet (see [First launch](#first-launch)). The user interface is currently in Traditional Chinese only.

## What you can do

- **Story to film on one canvas.** An empty canvas offers three ways to start: add shots one by one yourself, paste a story and let the AI split it into shots, or write one sentence (and pick a style, the number of shots and seconds per shot). With the sentence you can press "先產生分鏡" (Generate the storyboard first) to write only the storyboard, look at it and fix it before generating anything, or press "一次做完整支" (Do the whole film at once). The canvas grows scenes, shots, first frames, video clips and a cut.
- **Fix one shot, not the whole film.** Edit a shot's description or its characters and only the affected picture and clip nodes are marked "需要重跑" (needs re-run). Every shot keeps its versions. Next to a node's ▶ there is a small arrow with "只跑這個" (just this one), "這個和後面的" (this and what follows) and "整條" (the whole chain); each lists the steps and the estimated cost first.
- **Characters and locations.** Character cards with a locked appearance description, concept images and three-view turnarounds, so the same character can be reused across shots.
- **See the cost first.** Every run shows an estimate and asks for confirmation; a spending limit per run (**單次花費上限**, default US$5) protects you from surprises.
- **Sound.** Narration (your shots' spoken lines read aloud by an AI voice), one music track and the video model's own sound are mixed into the film; the finished-film panel lets you set the video's own sound to off / small / medium / large and the music to small / medium / large, and shows a timeline of what plays when. The sentence card has three tick boxes for sound (the video's own sound, narration and music): after "先產生分鏡", pressing "全部生成" (Generate all) at the top right adds narration and music automatically once the film is joined, according to their boxes; the confirmation lists that line and includes it in the estimate (a project you build step by step is not given sound automatically; add it in the "聲音" area of the finished-film panel). Mixing is local and free; narration costs a fraction of a cent per line and a music track about US$0.08 at the time of writing, and each shows its estimate first.
- **Preview and export.** Play the joined film in the app; press "匯出 MP4" (Export MP4) on the "剪輯" (Cut) node on the canvas (the finished-film panel opened from that node has it too) and the file is exported right away, without asking where to save: it goes into the project folder's "匯出" folder (named `exports` on disk), and you can reach it from the "打開資料夾" (Open folder) button in the message or from the project menu ▾ › "在資料夾中顯示" (Show in folder). Exporting twice within the same second adds -2, -3 to the file name, so nothing is overwritten. By default a 3-second closing card lists the AI services that were used (untick "片尾加上 AI 服務標註（建議）" in the finished-film panel if you do not want it; the film in your project is not changed). Joining and mixing use the bundled FFmpeg; nothing leaves your computer except the calls to the AI service you configured.
- **Let an AI assistant drive it.** Claude Code or Claude Desktop can make the whole film through the app's built-in MCP server (see [Connect Claude](#connect-claude-let-an-ai-drive-the-app)).
- **Tables as well as a canvas.** The navigation on the left has: 畫布 (Canvas), 大綱 (Outline), 分鏡表 (Storyboard table), 角色 (Characters), 場景卡 (Location cards), 生成紀錄 (Generation history), 檔案 (Files), plus 專案 (Projects: this project's folder and all projects) and 設定 (Settings). The outline, storyboard table, characters, location cards, history and files are all views of the same data; undo and redo work across them.
- **Optional:** import a story from [Slima](https://slima.ai) (read-only, through the official `slima-mcp`).

## Get started

### Download

Installers are published on the repository's **Releases** page: a `.dmg` for macOS (Apple Silicon). The Windows installer follows once its bundled FFmpeg is built from source (see below). Each release lists a SHA-256 checksum for every file.

### First launch

The installers are not signed with an Apple Developer ID or a Windows code-signing certificate yet, so your system will warn you the first time:

- **macOS:** open **System Settings → Privacy & Security**, scroll down to the message about "Slima Video Studio" being blocked, click **Open Anyway** and enter your password. If macOS says the app is "damaged", run `xattr -dr com.apple.quarantine "/Applications/Slima Video Studio.app"` in Terminal and open it again.
- **Windows:** in the SmartScreen window click **More info → Run anyway**.
- There is **no automatic update** yet; download the new version from Releases.

### Try it without a key

On first launch choose **"先試玩看看" (Try it out)**. The app then uses fake providers: you can walk through the whole flow for free, no key and no network.

After that you land on the **home page**: press **"新專案" (New project)**, give it a name and start (or press "先不建專案，直接進畫布" — skip the project and go straight to the canvas — and a project is created automatically the first time you add anything on the canvas).

![Setup wizard](docs/images/01-setup-wizard.png)

### Use real AI

1. Create an [OpenRouter](https://openrouter.ai) account, add a few dollars of credit, and create an API key (set a spending limit on the key if you like). The account needs credit for the paid image and video models.
2. In the app's setup wizard, or under **Settings (設定) → 服務金鑰 (Service keys)**, paste the key into your service's card and press **儲存** (Save). It is stored encrypted on your computer by the operating system and is never shown again in full. On macOS the system may ask for your login password so the app can use the keychain; because the installers are not signed with a Developer ID yet, it may ask again after you update the app.
3. On the empty canvas pick a way to start (see [Make a film on the canvas](#make-a-film-on-the-canvas) below). The cheapest way: on the "一句話" (One sentence) card write your story, set the shots and seconds, press **"先產生分鏡"** (writes only the storyboard, costs very little), look at and fix the storyboard, then press **"全部生成（約 US$…）"** at the top right; the confirmation lists every step and the estimate, and you press "執行" (Run). To do everything at once, press "一次做完整支".

A short test film of 2 shots × 3 seconds cost about US$1.1 in our own run. Estimates can be lower than the real price (our run was estimated at US$0.78), so start small. The **單次花費上限** (Spending limit per run, default US$5) is the card of that name under **Settings → 一般 (General)**: a field in US dollars and a "儲存" (Save) button. It applies to every generation, whether you pressed the button or an AI assistant asked for it: if the estimate is above the limit, that run does not start; the app tells you the estimate, and to run something bigger you raise the limit there and run it again. In demo mode nothing costs money. AI assistants have a second, separate limit, **AI 工具的總額度** (the AI tools' total allowance); see [Connect Claude](#connect-claude-let-an-ai-drive-the-app).

![Settings → 一般: demo mode, appearance and the spending limit per run](docs/images/14-settings-general.png)

The settings page has a row of small tags at the top that jump to each area: **一般** (General), **AI 工具連線** (AI tool connection), **服務金鑰** (Service keys), **模型** (Models) and **實驗功能** (Experimental features: things still being tried, which may change at any time).

### Projects and saving

![The home page: New project, Open an existing project, Recent projects](docs/images/10-home.png)

- **A project is a folder on disk** (its name ends in `.svsproj`); the pictures, videos and exported files are inside it.
- **Autosave.** Every step is saved immediately; the top bar always says "已自動儲存・time" (Saved automatically · time) and there is no save button. ⌘S only tells you when it was last saved.
- **Open a new one, open an old one.** The home page (what you see when the app starts; later reach it from the project menu ▾ next to the project name › "首頁") has "新專案" (New project), "開啟舊專案…" (Open an existing project…) and "最近的專案" (Recent projects). The project menu ▾ also has: "全部專案" (All projects), **"另存為…" (Save as…,** ⇧⌘S: copies the project with its pictures and videos into another one, what you do next is saved in the new one and the original stays where it was), "改名" (Rename) and "在資料夾中顯示" (Show in folder).
- **On macOS the "檔案" (File) menu** at the top of the screen has the same things: 新專案… (⌘N), 開啟舊專案… (⌘O), 開啟最近的專案, 儲存 (⌘S), 另存為…, 改名…, 在 Finder 顯示, 首頁.

### Make a film on the canvas

![The empty canvas and its three ways to start: step by step, paste a story, one sentence](docs/images/11-canvas-start.png)

An empty canvas has three cards; pick whichever suits you (they are only starting points, and you can always add scenes, shots, characters and locations from "新增" on the left, or upload material with "圖片或影片"):

- **自己一步一步來** (step by step): adds a scene and a first shot; double-click the description on the card to write the picture, and press ▶ when you want to generate it.
- **貼一段故事** (paste a story): paste a story and the AI splits it into scenes and shots (the storyboard); this step generates no pictures or videos.
- **一句話** (one sentence): write a sentence and pick a style, the number of shots and seconds per shot. The main button **"先產生分鏡"** writes only the storyboard (text model only, very cheap) so you can look at it and fix it; then press **"全部生成"** at the top right, which first lists every step with an accurate estimate and generates only after you confirm. To do everything in one go, press **"一次做完整支"**.

![The sentence card: the sound tick boxes, "先產生分鏡" and "一次做完整支"](docs/images/12-oneliner-card.png)

Every action that costs money shows an estimate first; demo mode costs nothing. Next to a node's **▶** there is a small arrow with a menu:

![The menu next to ▶: just this one, this and what follows, the whole chain, each with its estimate](docs/images/13-run-modes.png)

- **只跑這個** (just this one): redoes only this node (what was done before gets a new version; the old one is kept);
- **這個和後面的** (this and what follows): this node and the steps after it, then joins the film;
- **整條 (The whole chain; video nodes only):** the shot's first frame and video, then joins the film.

The confirmation lists exactly what this run will do. If other shots still have no video and the film cannot be joined, it says "這次不會接成成品" (this run will not join the film) instead of pretending it will; options that cannot run yet (for example a video with no first frame) are greyed out with the reason.

**Delete and undo.** Every kind of node can be deleted except "剪輯" (the cut, which grows automatically from the scenes and goes away when all scenes are deleted): use the trash can on the card, the Delete key or the right-click menu. Deleting does not ask; a message says exactly what was deleted (for example, deleting a shot also deletes its pictures and video versions) with an "復原" (Undo) button, and pressing it or ⌘Z (Ctrl+Z on Windows) brings everything back. Buttons that cannot be used are greyed out and say why. The "？" at the top right › "怎麼開始" (How to start) has a three-step summary.

## Connect Claude (let an AI drive the app)

Besides clicking, you can let an AI assistant such as **Claude Code** or **Claude Desktop** make the film for you. The app contains a small local server that speaks [MCP](https://modelcontextprotocol.io): the assistant can create a project, split your story into scenes and shots, generate and look at first frames, generate videos, re-do a shot, give the film narration and music, mix and measure the sound, join the shots and export the MP4, all in the same project you see on screen, in demo mode or with your own keys. Nothing is installed besides the app, and the connection never leaves your computer (`127.0.0.1` only).

![Settings → AI 工具連線: the connection diagram, the main switch, the Claude Desktop and Claude Code cards and the total allowance](docs/images/08-connect-claude.png)

_The real settings page of the app, with the main switch on. The picture at the top shows what is connected: a solid line means connected, a dashed line not yet. The manual command with the token is inside "更多" (More) on the Claude Code card; the token stays hidden until you press "顯示 token"._

**Connect in one click** (needs v0.3.0 or later; the app must be open):

1. Open the app → **Settings (設定)** and pick **AI 工具連線** (AI tool connection) in the row of tags at the top.
2. Press **連接** (Connect) on the **Claude Code** card or on the **Claude Desktop** card (the button then reads "重新連接"; the light next to the name changes from "還沒連接" to "已設定"; if the app does not find Claude on this computer, the light says "沒偵測到"). This also switches on the main switch **允許 AI 工具連線** (Allow AI tools to connect). For Claude Desktop, quit it completely (⌘Q) and open it again; the app backs up Claude Desktop's configuration file before adding one entry and leaves your other servers untouched.
3. Tell your assistant, for example: _"Use the slima-video-studio tools. Call get_capabilities, then load the getting-started guide, and make a 3-shot film from this story: …"_

In **Claude Code**, type `/mcp` to check that `slima-video-studio` is connected (tools of a newly added server only appear in a **new** Claude Code session).

### Connect Claude Code from the command line

This does the same thing as the **連接** button on the **Claude Code** card (macOS, app installed in `/Applications`): it registers the app's own runtime as a small bridge. Nothing is installed and no token is copied.

```bash
claude mcp add --scope user slima-video-studio -e ELECTRON_RUN_AS_NODE=1 -- \
  "/Applications/Slima Video Studio.app/Contents/MacOS/Slima Video Studio" \
  "/Applications/Slima Video Studio.app/Contents/Resources/app.asar/out/main/mcp-stdio-bridge.js" \
  --user-data "$HOME/Library/Application Support/@svs/desktop"
```

Once it is added, two things are left: switch on **允許 AI 工具連線** under Settings → AI 工具連線 in the app (the command does not do this; the 連接 button does), and start a **new** Claude Code conversation, because a server added in the middle of a conversation is not loaded until the next one.

**Which way to connect?** There are two, and both are safe:

- **The 連接 buttons and the command above use a small bridge** that starts with your assistant and reads the app's current port and token from the app's own folder every time. Nothing to copy, and it keeps working after you press "change token". Use this by default; it is also the only way for Claude Desktop, which can only start commands.
- **The manual `claude mcp add --transport http …` line (Claude Code card → 更多 → "手動連線", shown once the main switch is on) talks to the app directly** and contains the port and the secret token, so it stops working when you change the token or the port. Use it only for an MCP client that cannot start commands but can send an HTTP header.

**If Claude says the connection failed or the tools do not load:** check that the app is open and that **設定 → AI 工具連線 → 允許 AI 工具連線** is switched on, then open a new conversation in Claude Desktop or Claude Code. When the app is closed the assistant only sees "connection failed"; the plain-language explanation appears once the app is running.

**What the assistant can do** (52 tools; it reads the guides with `load_guide` and sees each tool's description):

| Area               | Tools                                                                                                                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start              | `get_capabilities`, `load_guide`, `estimate_cost`                                                                                                                                                                                                               |
| Project and models | `list_projects`, `get_current_project`, `open_project`, `create_project`, `configure_project`, `list_models`, `set_models`, `undo`, `redo`                                                                                                                      |
| Story              | `split_story_into_scenes`, `get_outline`, `edit_outline`, `split_scene_into_shots`                                                                                                                                                                              |
| Shots              | `list_shots`, `get_shot`, `update_shot`, `create_shot`, `delete_shots`, `reorder_shots`                                                                                                                                                                         |
| Characters         | `list_characters`, `create_character`, `update_character`, `suggest_character_anchor`, `set_character_anchor`, `list_project_images`, `add_character_reference`, `generate_character_images`, `view_character_images`, `pick_character_image`, `lock_character` |
| Pictures and video | `generate_first_frames`, `view_first_frames`, `generate_videos`, `view_video_stills`, `regenerate_shot`, `adopt_version`, `cancel_generation`, `wait_for_generation`, `get_generation_status`                                                                   |
| Film               | `assemble_film`, `export_film` (with `credits`: the closing card, on by default)                                                                                                                                                                                |
| Sound              | `get_sound`, `plan_sound`, `generate_narration`, `generate_music`, `adjust_sound_clip`, `adopt_sound_clip`, `remove_sound_clip`, `set_sound_settings`, `mix_sound`, `analyze_sound`                                                                             |

The tools that look at pictures return real (downsized) images, so the assistant can check first frames and video stills for mistakes before you pay for more.

**What protects you**

- **Off by default**, only on `127.0.0.1`, and every request needs a secret token. "Change token" invalidates the old one.
- The assistant can never see or change your service keys, settings or the two spending limits below.
- **AI 工具的總額度 (the AI tools' total allowance): US$0 by default.** It is the card of that name in the same area (a field in US dollars; its light says "還不能花錢" until you raise it). In demo mode nothing costs money. With real AI, every paid step (text, pictures, videos) is checked against the estimate first and reserved from the allowance, and refused when it would go over; only you can raise it. "更多" on the card has "已用的歸零" (reset what has been used), after which the same amount can be spent again.
- **Every generation an assistant asks for is also held to the 單次花費上限** (Settings → 一般, default US$5), the same limit as for your own clicks.
- Opening or creating a project in the assistant switches the project shown in the app window.

**Sound (narration, music, mixing).** The assistant can also give the film a voice: it writes each shot's spoken line, asks for narration and one music track, adjusts timing and volume, mixes everything into the film and **measures** the result (loudness, peak, quiet stretches, a shot with no sound) because it cannot listen. Narration and music cost money like the other generation steps: the estimate comes first, the AI tools' total allowance applies, and you can cap one step with a maximum price. You listen to the result in the app, where the same controls are available by hand:

![The sound area of the finished-film panel: the video's own sound, music, and a timeline with one row per kind of sound](docs/images/09-sound-panel.png)

_The real sound area of the app's finished-film panel (interface only). The narration row is empty here because the shots have no spoken lines yet; write a line in a shot and it is read aloud._

**Once connected**, Claude starts by reading the getting-started guide that the app provides (and the storyboard, spending and sound guides before it splits scenes into shots, spends money, or adds narration and music), and it looks at generated first frames before it generates videos. The error messages of the tools are written in plain language and usually say what to do next. Nobody needs to find or copy the connection token.

## Models

With only an OpenRouter key the defaults are:

| Job                                     | Default                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| Story breakdown and descriptions        | Claude Sonnet 5.5                                                                          |
| Images (character images, first frames) | Gemini 3 Pro Image                                                                         |
| Video                                   | Kling 3.0 Standard (Veo 3.1 Lite as a cheap draft model)                                   |
| Narration (reads each shot's line)      | MiniMax Speech 2.8 HD (ElevenLabs Eleven v3 as an alternative; pick the voice in Settings) |
| Music (one instrumental track)          | Google Lyria 3 Pro                                                                         |

GPT Image 2 (standard and high quality) is available as an image model through OpenRouter. Adding a [fal.ai](https://fal.ai) key unlocks more models and character-locking video. Measured prices, endpoints and what we actually observed are in [docs/models.md](docs/models.md).

## Known limitations

- **Demo mode's scene breakdown is fake.** The story split in demo mode returns canned placeholder acts and scenes (several scenes with the same name and empty summaries), not something made from your story. Demo mode is for trying the flow (buttons, panels, export) at no cost; to judge how the story breakdown really turns out, use real AI.
- Video models sometimes add a mouth, arms or legs to characters that have none (we saw it with Kling and, less often, with Veo). Describing the character as a still, plain shape in the prompt helps; always check the result.
- No sound effects yet (narration, music and the video model's own sound are supported) and no subtitles. Narration is one spoken line per shot and a line longer than its shot is only warned about, not shortened.
- The AI-credits closing card is made by the app and is added only to the exported file; if it cannot be made the export still succeeds without it and says so.
- The macOS installer is not signed with a Developer ID, so macOS may ask for your password again after each update (real-AI mode only); see [Use real AI](#use-real-ai).
- The default "realistic" style can produce dark or unsettling images for cute characters; pick a style that fits your story.
- Installers: macOS Intel is not built yet; Linux is not tested.
- **No Windows download yet.** The Windows build exists but has not been tested on a real Windows machine, and its bundled FFmpeg is a third-party build whose corresponding library sources we do not provide yet. It will be offered after we build that FFmpeg from source (as the macOS one already is).

## Build from source

```bash
pnpm install
pnpm dev                                                    # run the app
SVS_PROVIDER_MODE=mock SVS_DISABLE_ONBOARDING=1 pnpm dev    # demo mode, no key, no cost
pnpm lint && pnpm typecheck && pnpm test                    # checks
pnpm test:e2e                                               # Electron end-to-end tests (demo mode)
tools/ffmpeg/build-macos.sh                                 # macOS only: build the FFmpeg that goes into the installer (run before dist)
pnpm --filter @svs/desktop dist                             # package an installer (unsigned)
```

On macOS, packaging checks that the installer carries the FFmpeg built by `tools/ffmpeg/build-macos.sh` (its output goes to `apps/desktop/build/ffmpeg/`); without it `dist` stops with an error. You do not need it for `pnpm dev`, the tests, or demo mode.

Requirements: Node 22 and pnpm 10. It is a pnpm workspace: `apps/desktop` (Electron app, React renderer) wires together the packages in `packages/` (`schema`, `db`, `engine`, `providers`, `media`, `workflows`, `slima`), which depend only on `@svs/schema`. The macOS FFmpeg is built from source by [`tools/ffmpeg/build-macos.sh`](tools/ffmpeg/README.md). See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). The names "Slima" and "Slima Video Studio", the logos and the Little Bun / Mochi artwork are **not** covered by that license. The installers bundle FFmpeg (GPL v2 or later, built with libx264 only, run as a separate program); its license text and source instructions ship with it, and the other third-party licenses are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). You are responsible for your own AI service keys and for any charges they incur. The software is provided "as is", without warranty.
