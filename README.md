# Slima Video Studio

**English** · [繁體中文](README.zh-TW.md)

A free, open-source desktop studio that turns a story into an AI video. You write a sentence or paste a script; the app breaks it into scenes and shots, generates a first frame and a clip for every shot, adds narration and music, and joins them into one finished film. Everything lives on an editable node canvas, so you can fix any single shot and re-run just that part.

It is **bring-your-own-key**: the app has no server and provides no models. You connect your own AI service account (one [OpenRouter](https://openrouter.ai) key is enough for text, images and video), and you see the estimated cost before anything is generated.

> **Status: early (v0.x).** It works end to end on macOS (Apple Silicon). A Windows build exists but has not been tested on a real Windows machine and is not offered for download yet. The installers are not code-signed yet (see [First launch](#first-launch)). The user interface is currently in Traditional Chinese only.

## What you can do

- **Story to film on one canvas.** Write one sentence, pick a style, the number of shots and seconds per shot, and the canvas grows a whole short film: scenes, shots, first frames, video clips and a cut.
- **Fix one shot, not the whole film.** Edit a shot's description or its characters and only the affected pictures and clips are marked "needs re-run". Every shot keeps its versions.
- **Characters and locations.** Character cards with a locked appearance description, concept images and three-view turnarounds, so the same character can be reused across shots.
- **See the cost first.** Every run shows an estimate and asks for confirmation; a per-run limit (default US$5) protects you from surprises.
- **Sound.** Narration (your shots' spoken lines read aloud by an AI voice), one music track and the video model's own sound are mixed into the film automatically; the finished-film panel lets you set each volume to small / medium / large and shows a timeline of what plays when. Mixing is local and free; narration costs a fraction of a cent per line and a music track about US$0.08 at the time of writing, and each shows its estimate first.
- **Preview and export.** Play the joined film in the app and export it as an MP4. By default a 3-second closing card lists the AI services that were used (untick it if you do not want it; the film in your project is not changed). Joining and mixing use the bundled FFmpeg; nothing leaves your computer except the calls to the AI service you configured.
- **Let an AI assistant drive it.** Claude Code or Claude Desktop can make the whole film through the app's built-in MCP server (see [Connect Claude](#connect-claude-let-an-ai-drive-the-app)).
- **Tables as well as a canvas.** Outline, storyboard table, characters, locations, generation history and files are all views of the same data; undo and redo work across them.
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

![Setup wizard](docs/images/01-setup-wizard.png)

### Use real AI

1. Create an [OpenRouter](https://openrouter.ai) account, add a few dollars of credit, and create an API key (set a spending limit on the key if you like). The account needs credit for the paid image and video models.
2. In the app's setup wizard (or Settings) paste the key. It is stored encrypted on your computer by the operating system and is never shown again in full. On macOS the system may ask for your login password so the app can use the keychain; because the installers are not signed with a Developer ID yet, it may ask again after you update the app.
3. On the canvas, write a sentence, set the shots and seconds, press **Generate** and check the estimate.

A short test film of 2 shots × 3 seconds cost about US$1.1 in our own run. Estimates can be lower than the real price (our run was estimated at US$0.78), so start small.

## Connect Claude (let an AI drive the app)

Besides clicking, you can let an AI assistant such as **Claude Code** or **Claude Desktop** make the film for you. The app contains a small local server that speaks [MCP](https://modelcontextprotocol.io): the assistant can create a project, split your story into scenes and shots, generate and look at first frames, generate videos, re-do a shot, give the film narration and music, mix and measure the sound, join the shots and export the MP4, all in the same project you see on screen. The assistant works on the same project you see on screen, in demo mode or with your own keys. Nothing is installed besides the app, and the connection never leaves your computer (`127.0.0.1` only).

![Settings: AI tool connection](docs/images/08-connect-claude.png)

_The real settings page of the app (the token is hidden until you press "顯示 token")._

**Connect in one click** (needs v0.2.0 or later; the app must be open):

1. Open the app → **Settings (設定) → AI 工具連線 (MCP)**.
2. Press **連接 Claude Code** or **連接 Claude Desktop**. This also switches on "允許 AI 工具連線". For Claude Desktop, quit it completely (⌘Q) and open it again; the app backs up Claude Desktop's configuration file before adding one entry and leaves your other servers untouched.
3. Tell your assistant, for example: _"Use the slima-video-studio tools. Call get_capabilities, then load the getting-started guide, and make a 3-shot film from this story: …"_

In **Claude Code**, type `/mcp` to check that `slima-video-studio` is connected (tools of a newly added server only appear in a **new** Claude Code session).

**Which way to connect?** There are two, and both are safe:

- **The one-click buttons and the command below use a small bridge** that starts with your assistant and reads the app's current port and token from the app's own folder every time. Nothing to copy, and it keeps working after you press "change token". Use this by default; it is also the only way for Claude Desktop, which can only start commands.
- **The manual `claude mcp add --transport http …` line under the picture talks to the app directly** and contains the port and the secret token, so it stops working when you change the token or the port. Use it only for an MCP client that cannot start commands but can send an HTTP header.

**If Claude says the connection failed or the tools do not load:** check that the app is open and that **設定 → AI 工具連線 → 允許 AI 工具連線** is ticked, then start a new Claude session. When the app is closed the assistant only sees "connection failed"; the plain-language explanation appears once the app is running.

**Connect from the command line (macOS, app installed in `/Applications`)** — the same thing the button does, using the app's own runtime as a small bridge; nothing is installed and no token is copied:

```bash
claude mcp add --scope user slima-video-studio -e ELECTRON_RUN_AS_NODE=1 -- \
  "/Applications/Slima Video Studio.app/Contents/MacOS/Slima Video Studio" \
  "/Applications/Slima Video Studio.app/Contents/Resources/app.asar/out/main/mcp-stdio-bridge.js" \
  --user-data "$HOME/Library/Application Support/@svs/desktop"
```

You still have to switch on **允許 AI 工具連線** once in Settings (the one-click buttons do that for you).

**What the assistant can do** (52 tools; it reads the guides with `load_guide` and sees each tool's description):

| Area               | Tools                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start              | `get_capabilities`, `load_guide`, `estimate_cost`                                                                                                                                                             |
| Project and models | `list_projects`, `get_current_project`, `open_project`, `create_project`, `configure_project`, `list_models`, `set_models`, `undo`, `redo`                                                                    |
| Story              | `split_story_into_scenes`, `get_outline`, `edit_outline`, `split_scene_into_shots`                                                                                                                            |
| Shots              | `list_shots`, `get_shot`, `update_shot`, `create_shot`, `delete_shots`, `reorder_shots`                                                                                                                       |
| Characters         | `list_characters`, `create_character`, `update_character`, `suggest_character_anchor`, `set_character_anchor`, `generate_character_images`, `view_character_images`, `pick_character_image`, `lock_character` |
| Pictures and video | `generate_first_frames`, `view_first_frames`, `generate_videos`, `view_video_stills`, `regenerate_shot`, `adopt_version`, `cancel_generation`, `wait_for_generation`, `get_generation_status`                 |
| Film               | `assemble_film`, `export_film` (with `credits`: the closing card, on by default)                                                                                                                              |
| Sound              | `get_sound`, `plan_sound`, `generate_narration`, `generate_music`, `adjust_sound_clip`, `adopt_sound_clip`, `remove_sound_clip`, `set_sound_settings`, `mix_sound`, `analyze_sound`                           |

The tools that look at pictures return real (downsized) images, so the assistant can check first frames and video stills for mistakes before you pay for more.

**What protects you**

- **Off by default**, only on `127.0.0.1`, and every request needs a secret token. "Change token" invalidates the old one.
- The assistant can never see or change your service keys, settings or the spending allowance.
- **Spending allowance: US$0 by default.** In demo mode nothing costs money. With real AI, every paid step (text, pictures, videos) is checked against the estimate first and refused when it is over the allowance; only you can raise the allowance, in the same settings page.
- Opening or creating a project in the assistant switches the project shown in the app window.

**Sound (narration, music, mixing).** The assistant can also give the film a voice: it writes each shot's spoken line, asks for narration and one music track, adjusts timing and volume, mixes everything into the film and **measures** the result (loudness, peak, quiet stretches, a shot with no sound) because it cannot listen. Narration and music cost money like the other generation steps: the estimate comes first, the spending allowance applies, and you can cap one step with a maximum price. You listen to the result in the app, where the same controls are available by hand:

![The sound area of the finished-film panel: the video's own sound, music, and a timeline with one row per kind of sound](docs/images/09-sound-panel.png)

_The real sound area of the app's finished-film panel (interface only). The narration row is empty here because the shots have no spoken lines yet; write a line in a shot and it is read aloud._

**For an AI assistant reading this page:** the app is a desktop program that only the user can switch on. If you can run shell commands on the user's Mac, run the `claude mcp add …` command above yourself (use `--scope project` if the user wants it for one folder only), then ask the user to (1) open the app and tick **允許 AI 工具連線** under Settings → AI 工具連線 and (2) start a new Claude Code session, because a server added mid-session is not loaded until then. Otherwise ask the user to press the one-click button. Either way you never need to find or handle the connection token. Once connected, call `get_capabilities` first, then `load_guide` with `getting-started` (and `storyboard` before splitting scenes into shots, `spending` before paying for anything, `sound` before narration and music). Generate first frames and look at them (`view_first_frames`) before you generate videos. Read tool errors: they are written in plain language and usually say what to do next.

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
