# Slima Video Studio

**English** · [繁體中文](README.zh-TW.md)

A free, open-source desktop studio that turns a story into an AI video. You write a sentence or paste a script; the app breaks it into scenes and shots, generates a first frame and a clip for every shot, adds narration and music, and joins them into one finished film. Everything lives on an editable node canvas, so you can fix any single shot and re-run just that part.

It is **bring-your-own-key**: the app has no server and provides no models. You connect your own AI service account (one [OpenRouter](https://openrouter.ai) key is enough for text, images and video), and you see the estimated cost before anything is generated.

> **Status: early (v0.x).** It works end to end on macOS (Apple Silicon). A Windows build exists but has not been tested on a real Windows machine and is not offered for download yet. The installers are not code-signed yet (see [First launch](#first-launch)). The user interface is currently in Traditional Chinese only.

## What you can do

- **Story to film on one canvas.** An empty canvas offers three ways to start: add shots one by one yourself, paste a story and let the AI split it into shots, or write one sentence (and pick a style, the number of shots and seconds per shot). With the sentence you can press **Write the storyboard first** (先產生分鏡) to write only the storyboard, look at it and fix it before generating anything, or press **Whole film in one go** (一次做完整支). The canvas grows scenes, shots, first frames, video clips and a cut.
- **Fix one shot, not the whole film.** Edit a shot's description or its characters and only the affected picture and clip nodes are marked **Needs a rerun** (需要重跑). Every shot keeps its versions. Next to a node's ▶ there is a small arrow with **Just this one** (只跑這個), **This one and what follows** (這個和後面的) and **The whole chain** (整條); each lists the steps and the estimated cost first.
- **Characters and locations.** Character cards with a locked appearance description, concept images and three-view turnarounds, so the same character can be reused across shots.
- **See the cost first.** Every run shows an estimate and asks for confirmation; a spending limit per run (**Per-run spending limit**, 單次花費上限, default US$5) protects you from surprises.
- **Sound.** Narration (your shots' spoken lines read aloud by an AI voice), one music track and the video model's own sound are mixed into the film; the finished-film panel lets you set the video's own sound to off / small / medium / large and the music to small / medium / large, and shows a timeline of what plays when. The sentence card has three tick boxes for sound (the video's own sound, narration and music): after **Write the storyboard first**, pressing **Generate what’s empty** (生成空的) at the top right adds narration and music automatically once the film is joined, according to their boxes; the confirmation lists that line and includes it in the estimate (a project you build step by step is not given sound automatically; add it in the **Sound** (聲音) area of the finished-film panel). Mixing is local and free; narration costs a fraction of a cent per line and a music track about US$0.08 at the time of writing, and each shows its estimate first.
- **Preview and export.** Play the joined film in the app; press **Export MP4** (匯出 MP4) on the **Cut** (剪輯) node on the canvas (the finished-film panel opened from that node has it too) and the file is exported right away, without asking where to save: it goes into the project folder's “Exports” (匯出) folder (named `exports` on disk), and you can reach it from the “Show in Finder” (macOS) / “Show in folder” button in the message or from the project menu ▾ › **Show in folder** (在資料夾中顯示). Exporting twice within the same second adds -2, -3 to the file name, so nothing is overwritten. By default a 3-second closing card lists the AI services that were used (untick **Add AI service credits at the end (recommended)** (片尾加上 AI 服務標註（建議）) in the finished-film panel if you do not want it; the film in your project is not changed). Joining and mixing use the bundled FFmpeg; nothing leaves your computer except the calls to the AI service you configured.
- **Let an AI assistant drive it.** Claude Code or Claude Desktop can make the whole film through the app's built-in MCP server (see [Connect Claude](#connect-claude-let-an-ai-drive-the-app)).
- **Tables as well as a canvas.** The navigation on the left has: **Canvas** (畫布), **Outline** (大綱), **Storyboard** (分鏡表), **Characters** (角色), **Locations** (場景卡), **Records** (生成紀錄: generation history), **Files** (檔案), plus **Projects** (專案: this project's folder and all projects) and **Settings** (設定). The outline, storyboard table, characters, locations, records and files are all views of the same data; undo and redo work across them.
- **Optional:** import a story from [Slima](https://slima.ai) (read-only, through the official `slima-mcp`).

## Get started

### Download

Installers are published on the repository's **Releases** page: a `.dmg` for macOS (Apple Silicon). The Windows installer follows once its bundled FFmpeg is built from source (see below). Each release lists a SHA-256 checksum for every file.

### First launch

The installers are not signed with an Apple Developer ID or a Windows code-signing certificate yet, so your system will warn you the first time:

- **macOS:** open **System Settings → Privacy & Security**, scroll down to the message about "Slima Video Studio" being blocked, click **Open Anyway** and enter your password. If macOS says the app is "damaged", run `xattr -dr com.apple.quarantine "/Applications/Slima Video Studio.app"` in Terminal and open it again.
- **Windows:** in the SmartScreen window click **More info → Run anyway**.
- There is **no automatic update** yet; download the new version from Releases.

### Interface language

The app has an **English** and a **Traditional Chinese (繁體中文)** interface. On first launch it follows your system language (Chinese gives Traditional Chinese, any other language gives English); change it any time under **Settings → General → Language** (設定 → 一般 → 語言). In this README a button or menu is written as its English name followed by the Traditional Chinese name in parentheses, for example **Canvas** (畫布). The screenshots show the Traditional Chinese interface.

**The prompts sent to the AI models are not translated.** They are fixed text that the models read (and that the generated pictures and videos depend on), so they do not change with the interface language. A few of them appear on screen, in the generation queue and the generation records, and stay in Chinese. What you write (a story, a shot description) is sent as you wrote it, in whatever language you use, and the default storyboard guide follows the interface language unless you have edited it.

### Try it without a key

On first launch choose **Try it out first** (先試玩看看). The app then uses fake providers: you can walk through the whole flow for free, no key and no network.

After that you land on the **home page**: press **New project** (新專案), give it a name and start (or press **Skip for now and go to the canvas** (先不建專案，直接進畫布) and a project is created automatically the first time you add anything on the canvas).

![Setup wizard](docs/images/01-setup-wizard.png)

### Use real AI

1. Create an [OpenRouter](https://openrouter.ai) account, add a few dollars of credit, and create an API key (set a spending limit on the key if you like). The account needs credit for the paid image and video models.
2. In the app's setup wizard, or under **Settings (設定) → API keys (服務金鑰)**, paste the key into your service's card and press **Save** (儲存). It is stored encrypted on your computer by the operating system and is never shown again in full. On macOS the system may ask for your login password so the app can use the keychain; because the installers are not signed with a Developer ID yet, it may ask again after you update the app.
3. On the empty canvas pick a way to start (see [Make a film on the canvas](#make-a-film-on-the-canvas) below). The cheapest way: on the **One-liner** (一句話) card write your story, set the shots and seconds, press **Write the storyboard first** (writes only the storyboard, costs very little), look at and fix the storyboard, then press **Generate what’s empty (N steps, about US$…)** (生成空的) at the top right (it only fills in steps that have no result yet; the ▾ next to it offers “Redo the shots marked ‘needs a rerun’” and “Regenerate everything”, each with its price); the confirmation lists every step and the estimate, and you press **Run** (執行). To do everything at once, press **Whole film in one go**.

A short test film of 2 shots × 3 seconds cost about US$1.1 in our own run. Estimates can be lower than the real price (our run was estimated at US$0.78), so start small. The **Per-run spending limit** (單次花費上限, default US$5) is the card of that name under **Settings → General** (一般): a field in US dollars and a **Save** (儲存) button. It applies to every generation, whether you pressed the button or an AI assistant asked for it: if the estimate is above the limit, that run does not start; the app tells you the estimate, and to run something bigger you raise the limit there and run it again. In demo mode nothing costs money. AI assistants have a second, separate limit, **Total allowance for AI tools** (AI 工具的總額度); see [Connect Claude](#connect-claude-let-an-ai-drive-the-app).

![Settings → General: demo mode, appearance and the spending limit per run](docs/images/14-settings-general.png)

The settings page has a row of small tags at the top that jump to each area: **General** (一般), **AI tools** (AI 工具連線), **API keys** (服務金鑰), **Models** (模型) and **Experiments** (實驗功能: things still being tried, which may change at any time).

### Projects and saving

![The home page: New project, Open an existing project, Recent projects](docs/images/10-home.png)

- **A project is a folder on disk** (its name ends in `.svsproj`); the pictures, videos and exported files are inside it.
- **Autosave.** Every step is saved immediately; the top bar always says “Auto-saved · time” (已自動儲存・time) and there is no save button. ⌘S only tells you when it was last saved.
- **Open a new one, open an old one.** The home page (what you see when the app starts; later reach it from the project menu ▾ next to the project name › **Home**) has **New project** (新專案), **Open project…** (開啟舊專案…) and **Recent projects** (最近的專案). The project menu ▾ also has: **All projects** (全部專案), **Save as…** (另存為…, ⇧⌘S: copies the project with its pictures and videos into another one, what you do next is saved in the new one and the original stays where it was), **Rename** (改名) and **Show in folder** (在資料夾中顯示).
- **On macOS the File (檔案) menu** at the top of the screen has the same things: New Project… (⌘N), Open Project… (⌘O), Open Recent, Save (⌘S), Save As…, Rename…, Show in Finder, Home.

### Make a film on the canvas

![The empty canvas and its three ways to start: step by step, paste a story, one sentence](docs/images/11-canvas-start.png)

An empty canvas has three cards; pick whichever suits you (they are only starting points, and you can always add scenes, shots, characters and locations from **Add** (新增) on the left, or upload material with **Picture or video** (圖片或影片)):

- **Go step by step** (自己一步一步來): adds a scene and a first shot; double-click the description on the card to write the picture, and press ▶ when you want to generate it.
- **Paste a story** (貼一段故事): paste a story and the AI splits it into scenes and shots (the storyboard); this step generates no pictures or videos.
- **One-liner** (一句話): write a sentence and pick a style, the number of shots and seconds per shot. The main button **Write the storyboard first** writes only the storyboard (text model only, very cheap) so you can look at it and fix it; then press **Generate what’s empty** at the top right, which first lists every step with an accurate estimate and generates only after you confirm. To do everything in one go, press **Whole film in one go**.

![The one-liner card: the sound tick boxes, “Write the storyboard first” and “Whole film in one go”](docs/images/12-oneliner-card.png)

Every action that costs money shows an estimate first; demo mode costs nothing. Next to a node's **▶** there is a small arrow with a menu:

![The menu next to ▶: just this one, this and what follows, the whole chain, each with its estimate](docs/images/13-run-modes.png)

- **Just this one** (只跑這個): redoes only this node (what was done before gets a new version; the old one is kept);
- **This one and what follows** (這個和後面的): this node and the steps after it, then joins the film;
- **The whole chain** (整條; video nodes only): the shot's first frame and video, then joins the film.

The confirmation lists exactly what this run will do. If other shots still have no video and the film cannot be joined, it says that this run won’t join the film (這次不會接成成品) instead of pretending it will; options that cannot run yet (for example a video with no first frame) are greyed out with the reason.

**Delete and undo.** Every kind of node can be deleted except **Cut** (剪輯: the cut, which grows automatically from the scenes and goes away when all scenes are deleted): use the trash can on the card, the Delete key or the right-click menu. Deleting does not ask; a message says exactly what was deleted (for example, deleting a shot also deletes its pictures and video versions) with an **Undo** (復原) button, and pressing it or ⌘Z (Ctrl+Z on Windows) brings everything back. Buttons that cannot be used are greyed out and say why. The “?” at the top right › **How to start** (怎麼開始) has a three-step summary.

## Connect Claude (let an AI drive the app)

Besides clicking, you can let an AI assistant such as **Claude Code** or **Claude Desktop** make the film for you. The app contains a small local server that speaks [MCP](https://modelcontextprotocol.io): the assistant can create a project, split your story into scenes and shots, generate and look at first frames, generate videos, re-do a shot, give the film narration and music, mix and measure the sound, join the shots and export the MP4, all in the same project you see on screen, in demo mode or with your own keys. Nothing is installed besides the app, and the connection never leaves your computer (`127.0.0.1` only).

![Settings → AI tools: the connection diagram, the main switch, the Claude Desktop and Claude Code cards and the total allowance](docs/images/08-connect-claude.png)

_The real settings page of the app, with the main switch on. The picture at the top shows what is connected: a solid line means connected, a dashed line not yet. The manual command with the token is inside **More** (更多) on the Claude Code card; the token stays hidden until you press **Show token** (顯示 token)._

**Connect in one click** (needs v0.3.0 or later; the app must be open):

1. Open the app → **Settings (設定)** and pick **AI tools** (AI 工具連線) in the row of tags at the top.
2. Press **Connect** (連接) on the **Claude Code** card or on the **Claude Desktop** card (the button then reads **Reconnect** (重新連接); the light next to the name changes from “Not connected” (還沒連接) to “Set up” (已設定); if the app does not find Claude on this computer, the light says “Not found” (沒偵測到)). This also switches on the main switch **Allow AI tools to connect** (允許 AI 工具連線). For Claude Desktop, quit it completely (⌘Q) and open it again; the app backs up Claude Desktop's configuration file before adding one entry and leaves your other servers untouched.
3. Tell your assistant, for example: _"Use the slima-video-studio tools. Call get_capabilities, then load the getting-started guide, and make a 3-shot film from this story: …"_

In **Claude Code**, type `/mcp` to check that `slima-video-studio` is connected (tools of a newly added server only appear in a **new** Claude Code session).

### Connect Claude Code from the command line

This does the same thing as the **Connect** button on the **Claude Code** card (macOS, app installed in `/Applications`): it registers the app's own runtime as a small bridge. Nothing is installed and no token is copied.

```bash
claude mcp add --scope user slima-video-studio -e ELECTRON_RUN_AS_NODE=1 -- \
  "/Applications/Slima Video Studio.app/Contents/MacOS/Slima Video Studio" \
  "/Applications/Slima Video Studio.app/Contents/Resources/app.asar/out/main/mcp-stdio-bridge.js" \
  --user-data "$HOME/Library/Application Support/@svs/desktop"
```

Once it is added, two things are left: switch on **Allow AI tools to connect** under Settings → AI tools in the app (the command does not do this; the Connect button does), and start a **new** Claude Code conversation, because a server added in the middle of a conversation is not loaded until the next one.

**Which way to connect?** There are two, and both are safe:

- **The Connect buttons and the command above use a small bridge** that starts with your assistant and reads the app's current port and token from the app's own folder every time. Nothing to copy, and it keeps working after you press "change token". Use this by default; it is also the only way for Claude Desktop, which can only start commands.
- **The manual `claude mcp add --transport http …` line (Claude Code card → More → “Manual setup”, shown once the main switch is on) talks to the app directly** and contains the port and the secret token, so it stops working when you change the token or the port. Use it only for an MCP client that cannot start commands but can send an HTTP header.

**If Claude says the connection failed or the tools do not load:** check that the app is open and that **Settings → AI tools → Allow AI tools to connect** is switched on, then open a new conversation in Claude Desktop or Claude Code. When the app is closed the assistant only sees "connection failed"; the plain-language explanation appears once the app is running.

**What the assistant can do** (52 tools; it reads the guides with `load_guide` and sees each tool's description):

| Area               | Tools                                                                                                                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start              | `get_capabilities`, `load_guide`, `estimate_cost`                                                                                                                                                                                                               |
| Project and models | `list_projects`, `get_current_project`, `open_project`, `create_project`, `configure_project`, `list_models`, `set_models`, `undo`, `redo`                                                                                                                      |
| Story              | `split_story_into_scenes`, `get_outline`, `edit_outline`, `split_scene_into_shots`                                                                                                                                                                              |
| Shots              | `list_shots`, `get_shot`, `update_shot`, `create_shot`, `delete_shots`, `reorder_shots`, `get_shot_references`, `set_shot_references`, `set_shot_end_frame`, `clear_shot_end_frame`                                                                             |
| Characters         | `list_characters`, `create_character`, `update_character`, `suggest_character_anchor`, `set_character_anchor`, `list_project_images`, `add_character_reference`, `generate_character_images`, `view_character_images`, `pick_character_image`, `lock_character` |
| Pictures and video | `generate_first_frames`, `generate_end_frame`, `view_first_frames`, `generate_videos`, `view_video_stills`, `regenerate_shot`, `adopt_version`, `cancel_generation`, `wait_for_generation`, `get_generation_status`                                             |
| Film               | `trim_shot` (cut the start or end off a shot), `assemble_film`, `export_film` (with `credits`: the closing card, on by default)                                                                                                                                 |
| Sound              | `get_sound`, `plan_sound`, `generate_narration`, `generate_music`, `adjust_sound_clip`, `adopt_sound_clip`, `remove_sound_clip`, `set_sound_settings`, `mix_sound`, `analyze_sound`                                                                             |

The tools that look at pictures return real (downsized) images, so the assistant can check first frames and video stills for mistakes before you pay for more.

**What protects you**

- **Off by default**, only on `127.0.0.1`, and every request needs a secret token. "Change token" invalidates the old one.
- The assistant can never see or change your service keys, settings or the two spending limits below.
- **Total allowance for AI tools** (AI 工具的總額度)**: US$0 by default.** It is the card of that name in the same area (a field in US dollars; its light says “Can’t spend yet” (還不能花錢) until you raise it). In demo mode nothing costs money. With real AI, every paid step (text, pictures, videos) is checked against the estimate first and reserved from the allowance, and refused when it would go over; only you can raise it. **More** on the card has **Reset used amount** (已用的歸零), after which the same amount can be spent again.
- **Every generation an assistant asks for is also held to the Per-run spending limit** (Settings → General, default US$5), the same limit as for your own clicks.
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

## Privacy

What the app keeps on your computer and what it sends out (this describes version 0.4.0; the code is in this repository, so you can check it):

- **Your work stays on your computer.** Projects, pictures, videos, sound and exports are files in your project folder. Joining, mixing and exporting run on your computer with the bundled FFmpeg.
- **In demo mode nothing leaves your computer.** The fake providers need no key and no network.
- **With real AI, what you write and make is sent to the AI service you set up**, because that is how the pictures, videos, narration and music get made: your story and shot descriptions, the characters' descriptions and pictures, the first frames and videos used as input, and the narration text. The app talks to **OpenRouter** (`openrouter.ai`) and, only if you add a key for it, **fal.ai** (`queue.fal.run`). What those services do with your data is governed by their own terms and privacy policies, not by this project.
- **Importing from Slima is optional and read-only.** Only if you connect your Slima account, the app reads your stories from `api.slima.ai` through the official `slima-mcp`; nothing is written back.
- **Your service keys** are stored encrypted by your operating system's keychain (macOS Keychain, Windows DPAPI) and are never shown again in full. They are sent only to the service they belong to.
- **No telemetry.** The app has no analytics, no usage tracking, no crash reporting and no automatic update check; it contacts no server of ours except `api.slima.ai` when you import from Slima. The only other connection is the local server for AI assistants, which listens on `127.0.0.1` (your computer only) and only when you switch it on.
- The cost figures in the app are estimates calculated on your computer; the real charge is whatever your AI service bills you.

## License

Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). The names "Slima" and "Slima Video Studio", the logos and the Little Bun / Mochi artwork are **not** covered by that license. The installers bundle FFmpeg (GPL v2 or later, built with libx264 only, run as a separate program); its license text and source instructions ship with it, and the other third-party licenses are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). You are responsible for your own AI service keys and for any charges they incur. The software is provided "as is", without warranty.
