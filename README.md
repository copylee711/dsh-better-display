<h1 align="center">dsh-better-display</h1>

<p align="center">
  让 DeepSeek Harness Web 的回答<b>图文并茂</b>，并为联网搜索内容加上 <b>GPT 式引用角标</b>。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@copylee/dsh-better-display"><img alt="npm version" src="https://img.shields.io/npm/v/@copylee/dsh-better-display?style=flat&color=111111" /></a>
  <a href="https://github.com/copylee711/dsh-better-display/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/copylee711/dsh-better-display/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-111111.svg" /></a>
  <a href="https://github.com/copylee711/dsh-free-search"><img alt="works with dsh-free-search" src="https://img.shields.io/badge/works_with-dsh--free--search-111111.svg" /></a>
</p>

<p align="center">
  <b>中文</b> · <a href="./README_EN.md">English</a>
</p>

## 为什么需要它

用 [`@copylee/dsh-free-search`](https://github.com/copylee711/dsh-free-search) 等插件联网搜索时，搜到的网页、图片墙只显示在**工具调用面板**里，调用结束后面板通常会被折叠。最终回答只剩一段纯文字：

- 看不到搜到的图片，除非手动展开工具面板；
- 不知道哪句话出自哪个网页，没法一键跳转核对。

**dsh-better-display** 解决这两件事：

| 能力 | 效果 |
|---|---|
| 引用角标 | 模型把引用写成 `[1](url "标题")`，渲染为上标小圆角标；悬停显示站点图标、域名和标题，点击在新标签页打开来源 |
| 来源面板 | 回答结束后在末尾汇总所有被引用的网页（按 URL 去重、按首次出现排序），可展开为卡片列表 |
| 正文配图 | 模型把 `image_search` / `page_images` / 网页结果中的相关图片以 `![说明](图片地址 "来源 · 许可")` 嵌入正文，渲染为带说明文字的图片；也支持 `save_images` 存到工作区后的本地路径 |
| 图集 | 同一行的 2 张以上图片自动排成网格图集 |
| 大图预览 | 点击图片全屏查看，可跳转原图，Esc 关闭 |
| 加载失败兜底 | 图片失效时退化为可点击的说明链接，不留破图 |
| 完整 Markdown | 基于 [dsh-better-markdown](https://github.com/zerob13/dsh-better-markdown) 的 `markstream-react` 流式渲染：Shiki 代码高亮、Mermaid、KaTeX、表格、任务列表等全部保留 |

## 工作原理

插件分两半，不修改 Harness 源码：

```text
宿主端 (lib/index.js)
  systemPrompt.section("better-display:rich-answer")
    └─ 告诉模型：引用写成 [n](url)，相关图片写成 ![说明](图片url "来源")

浏览器端 (lib/client.js)
  conversation.chat.node / assistant-step
    |- priority -110: dsh-better-display   (active)
    |     markstream-react
    |       |- link  [n](url) → 引用角标 + 悬停卡片
    |       |- image          → 带说明的图片 / 图集 / 大图预览
    |       `- code           → stream-markdown + Shiki
    |     + 回答结束后的「来源」面板
    |- priority -100: dsh-better-markdown   (若已安装，被覆盖)
    `- priority    0: Harness 内置渲染       (fallback)
```

为什么由模型写入 Markdown，而不是直接读取工具结果？DSH 的 assistant 渲染器只能拿到本条消息的 `text / reasoning / tool-call(name,args)`，工具**结果**在另一种节点里。让模型把引用和图片写进正文，是最稳定、与搜索插件解耦的方式，任何带 URL 的工具结果（内置 `web_search`、`web_fetch` 或其它搜索插件）都能用。

## 与 dsh-free-search 联动（推荐）

两者分工：

- **[@copylee/dsh-free-search](https://github.com/copylee711/dsh-free-search)** 负责**找**：19 个搜索引擎、`multi_search` / `advanced_search` / `platform_search`、`image_search` / `page_images` 搜图取图。结果带编号和直链，方便模型引用。
- **dsh-better-display** 负责**展示**：把模型引用的来源渲染成角标和来源面板，把挑选出的图片放进正文。

安装两者：

```sh
dsh plugin --profile web add @copylee/dsh-free-search
dsh plugin --profile web add @copylee/dsh-better-display
dsh --profile web
```

建议在 dsh-free-search 设置页打开搜图工具（`image_search` / `page_images`），然后直接这样问：

- 「介绍一下埃菲尔铁塔，配几张图，并标注信息来源」
- 「最近一周 DeepSeek 有什么新闻？每条注明出处」
- 「对比 iPhone 17 和 Pixel 10 的外观，附图」

回答里会出现上标角标 `¹ ² ³`、正文图片 / 图集，末尾有「来源 · N」面板。

## 与 dsh-image-gen 联动

装上 [@copylee/dsh-image-gen](https://github.com/copylee711/dsh-image-gen) 后，Agent 生成的图片会直接显示在回复正文里，而不是只给一个文件：

- 生图工具的结果带有 `genimg:<任务 ID>` 引用，本插件会在工具结果和系统提示里要求模型写成 `![说明](genimg:<任务 ID>)`。
- 图片按生成时的原始宽高比显示，不裁切；点击可放大。
- 后台生图（`background: true`，例如"讲讲高斯定理，配一张示意图"）期间显示同比例的"生成中"占位，文字照常流式输出；回复结束后图片才完成也没关系，占位会自动换成图片。失败时占位显示失败原因。
- 多张图并排成图集时也保持各自比例，不再裁成统一高度。

## 选中引用与旁问

在回答里选中文字或图片，会弹出一个小工具条：

- **添加到对话**：把选中内容作为引用卡片贴到输入框上方，类似 ChatGPT 的引用。
  - 公式、粗体、列表、表格、代码都按 Markdown 源码还原，卡片里正常渲染，不会变成乱码。
  - 卡片可以展开、编辑（直接改 Markdown）或移除；输入框里只留一个小标签，发送时自动换成规整的 `>` 引用块。
  - 选中的图片（包括 dsh-image-gen 生成的图）会作为图片附件一起加入；点开图片预览也能直接「添加到对话」。
- **旁问**：针对选中内容问一个一次性问题（例如「解释一下」）。由一个不能使用工具的分支 Agent 在当前会话的上下文里回答，答案以气泡显示在输入框上方，支持公式和 Markdown，不会写进主对话。

这两个功能取代了 [dsh-btw](https://github.com/MichengAI/dsh-btw)，两者同时安装会出现两个工具条，建议卸载 dsh-btw。设置里的「选中工具条」可以整体关闭。

## 我的消息也渲染

- 自己发出的消息气泡按 Markdown 显示：公式、引用块、列表、代码都能正常渲染。纯文字消息保持原样；带 @文件、/技能 引用的消息仍用原生气泡显示。设置里的「渲染我的消息」可以关闭。
- 输入框里写了公式或 Markdown 时，上方会出现「预览格式」按钮，点开能看到渲染效果。

## 安装

> 本插件是 dsh-better-markdown 的**超集**，并以更低的 slot priority 覆盖它。安装本插件后建议移除 dsh-better-markdown，避免多打包一份：
>
> ```sh
> dsh plugin --profile web remove dsh-better-markdown
> ```
>
> 与 [dsh-genui](https://github.com/lhuans/dsh-genui) 同样互斥：二者都替换 assistant 渲染器，只会生效一个（本插件优先级更高）。

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add @copylee/dsh-better-display
dsh --profile web --dump-config
dsh --profile web
```

### 从源码安装

需要 Node.js 20+、pnpm 10+：

```sh
git clone https://github.com/copylee711/dsh-better-display.git
cd dsh-better-display
pnpm install
pnpm run check
pnpm run build
dsh plugin --profile web add "$(pwd)"
dsh --profile web
```

Windows PowerShell 将 `"$(pwd)"` 替换为 `(Get-Location).Path`。

配置输出应包含：

```yaml
# == @copylee/dsh-better-display
- id: better-display
  name: "@copylee/dsh-better-display"
  config:
    citations: true
    inlineImages: true
    maxImages: 4
```

### 移除

```sh
dsh plugin --profile web remove @copylee/dsh-better-display
```

卸载会同时撤下 prompt section 与 slot 覆盖，Harness 内置渲染器随即恢复。

## 配置

在 DSH 左侧栏「插件」页打开 **@copylee/dsh-better-display**，点组件行的配置按钮即可调整，保存后下一条回答就生效，不用重启：

| 选项 | 默认 | 说明 |
|---|---|---|
| 引用角标 `citations` | 开 | 让模型用 `[n](url)` 标注联网来源，显示为上标角标并汇总「来源」面板 |
| 正文配图 `inlineImages` | 开 | 让模型把搜到的相关图片嵌入回答 |
| 配图数量 `imageCount` | 由 AI 决定 | `auto`：模型按内容需要决定配几张（纯文字/代码类不配，外观对比、地点介绍等多配）；`limit`：限制每条回答最多张数 |
| 最多张数 `maxImages` | `8` | 1–20，仅在「限制最多」时生效 |

同样的字段也可以直接写在 profile 的 `cordis.patch.yml` 的 `better-display` 条目里（另有高级项 `sectionOrder`，默认 `600`，控制 system prompt 段落的排序）。两个开关都关闭时不注入任何 prompt，只保留增强渲染（已有的 `[1](url)` 链接和图片仍按新样式显示）。

## 安全

- 原始 HTML 一律转义（`htmlPolicy="escape"`）。
- 角标、链接、图片只接受 `http(s)` 地址；`javascript:`、相对路径等保持为不可点击文本。
- 图片与站点图标使用 `referrerPolicy="no-referrer"`，懒加载。
- system prompt 要求模型只引用本对话工具结果中真实出现过的 URL，不得编造；搜索结果本身仍由 dsh-free-search 标记为不可信内容。

## 开发

```sh
pnpm install
pnpm run check   # tsc + vitest
pnpm run build
pnpm pack --dry-run
```

主要文件：

- `src/index.ts`：宿主端，注册「引用 / 配图」system prompt section，并在设置变更时即时刷新
- `src/client/index.ts`：注册 Markstream 组件与 assistant slot 覆盖
- `src/client/renderer.tsx`：assistant 渲染、引用角标、图片 / 图集 / 大图预览、来源面板
- `src/client/citations.ts`：引用解析（纯函数）
- `src/client/settings.tsx`：插件页里的设置表单（写回 profile 配置）
- `src/client/workspace.ts`：工作区图片路径解析（与 DSH 内置规则一致）
- `src/client/styles.css`：基于 DSH `--dsw-*` token 的样式，自动适配深浅色
- `tests/`：流式渲染、安全策略、引用 / 图片 / 来源面板、prompt section 测试

## 兼容性

- DeepSeek Harness Web `0.1.7` 及以上（已在 `0.2.0-rc.2` 验证）；更早的版本请用 `0.1.0`
- React 18+

## 致谢

- [dsh-better-markdown](https://github.com/zerob13/dsh-better-markdown)（MIT, © duskzhen）：Markstream 渲染管线、构建配置与样式基础
- [dsh-genui](https://github.com/lhuans/dsh-genui)：system prompt section + 自定义 assistant 渲染的思路
- [markstream-react](https://github.com/Simon-He95/markstream-vue)、[DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)

## License

[MIT](./LICENSE)
