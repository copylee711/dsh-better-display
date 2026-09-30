<h1 align="center">dsh-better-display</h1>

<p align="center">
  <b>Illustrated</b> DeepSeek Harness Web replies with <b>ChatGPT-style citation chips</b> for web-search content.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@copylee/dsh-better-display"><img alt="npm version" src="https://img.shields.io/npm/v/@copylee/dsh-better-display?style=flat&color=111111" /></a>
  <a href="https://github.com/copylee711/dsh-better-display/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/copylee711/dsh-better-display/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-111111.svg" /></a>
  <a href="https://github.com/copylee711/dsh-free-search"><img alt="works with dsh-free-search" src="https://img.shields.io/badge/works_with-dsh--free--search-111111.svg" /></a>
</p>

<p align="center">
  <a href="./README.md">中文</a> · <b>English</b>
</p>

## Why

With web-search plugins such as [`@copylee/dsh-free-search`](https://github.com/copylee711/dsh-free-search), the pages and image walls a search finds appear only in the **tool-call panel**. DSH usually collapses that panel once the call finishes, which leaves the final answer as plain text:

- you can't see the pictures without expanding the tool panel;
- you can't tell which sentence came from which page, or jump to it.

**dsh-better-display** fixes both:

| Feature | Result |
|---|---|
| Citation chips | The model writes `[1](url "Title")`, which renders as a superscript chip. Hovering shows the favicon, domain and title; clicking opens the source in a new tab |
| Sources panel | Once the reply settles, every cited page is collected at the end (deduplicated by URL, in order of first use) in an expandable card list |
| Inline pictures | The model embeds relevant pictures from `image_search` / `page_images` / web results as `![caption](image-url "source · license")`, rendered with a caption; workspace paths saved by `save_images` work too |
| Galleries | Two or more pictures on one line become a grid |
| Lightbox | Click a picture to view it full-screen, open the original, and press Esc to close |
| Broken-image fallback | A dead picture turns into a caption link instead of a broken icon |
| Full Markdown | Built on [dsh-better-markdown](https://github.com/zerob13/dsh-better-markdown)'s streaming `markstream-react` pipeline, so Shiki code highlighting, Mermaid, KaTeX, tables and task lists all still work |

## How it works

```text
host (lib/index.js)
  systemPrompt.section("better-display:rich-answer")
    └─ tells the model: cite as [n](url), embed relevant pictures as ![caption](image-url "credit")

browser (lib/client.js)
  conversation.chat.node / assistant-step
    |- priority -110: dsh-better-display   (active)
    |     markstream-react
    |       |- link [n](url) → citation chip + hover card
    |       |- image         → captioned figure / gallery / lightbox
    |       `- code          → stream-markdown + Shiki
    |     + sources panel after the reply settles
    |- priority -100: dsh-better-markdown   (shadowed if installed)
    `- priority    0: Harness built-in      (fallback)
```

Why does the model write the citations into Markdown instead of the plugin reading tool results? DSH's assistant renderer only sees the message's `text / reasoning / tool-call(name,args)` blocks, and tool **results** live in separate nodes. Having the model write them into the answer is the most robust approach, and it keeps the renderer independent of any particular search plugin: it works with any tool whose results carry URLs (built-in `web_search`, `web_fetch` or other search plugins).

## With dsh-free-search (recommended)

- **[@copylee/dsh-free-search](https://github.com/copylee711/dsh-free-search)** does the **finding**: 19 engines, `multi_search` / `advanced_search` / `platform_search`, and the `image_search` / `page_images` picture tools. Its results come numbered and carry direct links, so they are easy to cite.
- **dsh-better-display** does the **showing**: it renders the cited sources as chips plus a sources panel and puts the chosen pictures into the answer.

```sh
dsh plugin --profile web add @copylee/dsh-free-search
dsh plugin --profile web add @copylee/dsh-better-display
dsh --profile web
```

Enable the picture tools in dsh-free-search's settings, then ask for example:

- "Tell me about the Eiffel Tower with a few pictures, and cite your sources"
- "What happened with DeepSeek in the last week? Cite each item"

## Install

> This plugin is a **superset** of dsh-better-markdown and shadows it at a lower slot priority. Remove dsh-better-markdown afterwards to avoid shipping a second bundle:
> `dsh plugin --profile web remove dsh-better-markdown`.
> It also excludes [dsh-genui](https://github.com/lhuans/dsh-genui): both replace the assistant renderer, so only one of them can be active (this one wins).

```sh
# npm
dsh plugin --profile web add @copylee/dsh-better-display

# from source (Node.js 20+, pnpm 10+)
git clone https://github.com/copylee711/dsh-better-display.git
cd dsh-better-display && pnpm install && pnpm run check && pnpm run build
dsh plugin --profile web add "$(pwd)"
```

Remove it with `dsh plugin --profile web remove @copylee/dsh-better-display`. This removes the prompt section and the slot shadow, and the built-in renderer takes over again.

## Configuration

Edit the `better-display` entry in the profile's `cordis.patch.yml`:

| Field | Default | Meaning |
|---|---|---|
| `citations` | `true` | Ask the model to cite web sources as `[n](url)` |
| `inlineImages` | `true` | Ask the model to embed relevant pictures |
| `maxImages` | `4` | Suggested maximum pictures per reply (1–12) |
| `sectionOrder` | `600` | System-prompt section order |

With both switches off, no prompt is injected; the renderer still styles any `[1](url)` links and images that appear.

## Security

- Raw HTML is escaped (`htmlPolicy="escape"`).
- Chips, links and images accept only `http(s)` URLs. `javascript:` and relative targets stay as inert text.
- Pictures and favicons load lazily with `referrerPolicy="no-referrer"`.
- The prompt tells the model to cite only URLs that actually appeared in this conversation's tool results. dsh-free-search still marks search output as untrusted.

## Development

```sh
pnpm install
pnpm run check   # tsc + vitest
pnpm run build
pnpm pack --dry-run
```

## Compatibility

- DeepSeek Harness Web `0.1.7` or later (verified on `0.2.0-rc.2`); use `0.1.0` for older releases
- React 18+

## Credits

- [dsh-better-markdown](https://github.com/zerob13/dsh-better-markdown) (MIT, © duskzhen): Markstream pipeline, build setup and base styles (see `THIRD_PARTY_NOTICES.md`)
- [dsh-genui](https://github.com/lhuans/dsh-genui): the prompt-section plus custom-renderer pattern
- [markstream-react](https://github.com/Simon-He95/markstream-vue), [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)

## License

[MIT](./LICENSE)
