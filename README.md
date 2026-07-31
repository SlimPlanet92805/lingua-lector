<p align="right"><a href="README.en.md">English</a> · 简体中文</p>

<img src="docs/logo.svg" width="72" alt="Lingua Lector">

# Lingua Lector — AI 交互式外语精读阅读器

**单文件 · 纯前端 · BYOK**：把任意外语文本加载进来，逐句点开，AI 拆给你看。
用你自己的 API key，没有账号，没有后端。

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square)](LICENSE)
![Single HTML file](https://img.shields.io/badge/Single-HTML%20file-orange?style=flat-square)
![Pure frontend](https://img.shields.io/badge/Pure-frontend-brightgreen?style=flat-square)
![No backend](https://img.shields.io/badge/No-backend-lightgrey?style=flat-square)
![BYOK](https://img.shields.io/badge/BYOK-bring%20your%20own%20key-9cf?style=flat-square)
![No install](https://img.shields.io/badge/No-install-yellow?style=flat-square)

## 这是什么

这是一个专门用来读 Elisabeth von Heyking 的德语日记《Tagebücher aus vier Weltteilen》的阅读器——
不过你也可以拿它读别的东西！

说正经的：把外语文本（`.txt` / `.docx` / `.pdf` / `.epub` 或直接粘贴）加载进来，正文被切成一句一句
可点击的单元，点哪句，右边就给出这句话的结构拆解和难词讲解，看完还能接着追问。整个工具是一个 HTML
文件，双击就能用。那本日记内置在里面当示例，不需要可以删掉。

![Lingua Lector 演示](docs/demo.gif)

## 缘起

这本书里的句子很长。一个主句能套住 `nachdem` 状语从句、里面再叠两层 `daß` 宾语从句、顺手插进两个
同位语和两个关系从句，写到近九百个字符都还没并列过一次（见文末「一个例子」——纪录保持者出自编者
Grete Litzmann 的导言，von Heyking 本人也没客气到哪里去）。1926 年出版的这本日记通篇如此：一位德国
外交官夫人从瓦尔帕莱索写到加尔各答、开罗、北京、墨西哥，用的是一个世纪前的德语。

于是阅读变成了：读一句、停下、查词典、理从句、发现已经忘了这句话开头在讲什么、回去重读、再往下读
一句。一页要停十次。

这个工具就是为了消掉那十次停顿：点一句话，右边告诉你骨架怎么拆、每个从句在说什么、哪些词值得记，
然后你接着读。写完发现需要这么读的不止这一本书，它就长成了一个通用精读器，适用于任何拉丁字母文本。

## 特性

- **逐句解析 + 追问**：整句译文、主干成分，以及**每个从句各自的译文**——不只告诉你「这是个关系从句，
  修饰 Kaiser」，还告诉你这半句在说什么。请求会带上所在段落作为上下文，但解析范围严格限定在这一句
- **解析结果留在本地**：按文档缓存，刷新和切换文档都不丢，也不重复消耗用量。对某一句不满意可以单句
  重新解析，也可以按文档单独清缓存
- **文档库**：内置全书加上你导入的任意多份文档，各自独立，互不影响缓存和阅读进度。文档正文和缓存存在
  IndexedDB 里（不可用时退回 `localStorage`），几百页的书也放得下，库里能看到每份占多大
- **多格式导入**：`.txt` / `.docx` / `.pdf` / `.epub`，全部在浏览器里解析，文件不会上传到任何地方
- **PDF 位置感知提取**：按文字坐标分行，剔除页眉页码，保留脚注完整性，优先用 PDF 自带书签分章
- **多 AI 服务商**：Anthropic Claude、OpenAI 兼容接口（含 DeepSeek / Groq / NVIDIA / 本地 Ollama）、
  Google Gemini，key、模型、接口地址分开保存
- **三个语言设置互不影响**，可以任意组合：界面用什么语言显示（9 种）、按哪种语言的规则给原文分句
  （11 种拉丁字母语言 + 通用兜底）、AI 用什么语言写解析（15 种 + 自己填）。读德语原文、界面用中文、
  解析用英文，是完全正常的组合
- **内置全书**：《Tagebücher aus vier Weltteilen》12 章，带侧滑目录；不需要就删掉，一键可以恢复
- **阅读设置**：按段落分页 / 自适应一屏一页 / 不分页；浅色、深色、护眼黄；正文字体与字号可调

## 快速开始

1. 下载 `dist/lingua-lector.html`
2. 双击用浏览器打开（Chrome / Edge / Firefox 均可）
3. 首次打开会弹出设置面板，选择 AI 服务商并填入 API key
4. 打开就有内置示例书可读；也可以在「文档」标签页导入文件或粘贴文本
5. 点正文里任意一句话，右侧出现解析。不满意就按面板上的 ⟳ 重新解析

## API Key

- **Anthropic Claude**：[console.anthropic.com](https://console.anthropic.com/settings/keys)
- **OpenAI**（或 DeepSeek / Groq / NVIDIA / 本地 Ollama，把 Base URL 换成对应地址）：
  [platform.openai.com](https://platform.openai.com/api-keys)
- **Google Gemini**：[Google AI Studio](https://aistudio.google.com/apikey)

建议单独为这个工具建一个 key 并设置用量上限。

**在 claude.ai 里把这个 HTML 当作 Artifact 打开**（项目最初的用法）：服务商选 Anthropic、key 留空，
请求会走 claude.ai 的沙盒代理使用你当前的会话。这个 fallback 只对 Anthropic 有效。

## Key 存在哪里

只存在你这台设备这个浏览器的 `localStorage` 里，不会发送到 AI 服务商官方接口以外的任何地方。它不是
HTML 文件的一部分，所以把文件转发给别人或传到 GitHub，对方拿到的是一个空白工具。唯一的风险是这台
设备本身被别人用——所以别在公用电脑上长期保存 key。

如果不希望 key 留在浏览器里，可以用下面的代理把它挪到服务端，浏览器全程接触不到真实 key。

## 可选代理

Anthropic 和 Gemini 都允许浏览器直接跨域调用，正常情况下不需要代理。部分 OpenAI 兼容服务商不允许，
表现为「网络请求失败」，这时可以用代理绕开，顺便把 key 挪出浏览器。

**`server.py`**（需要 Python，无第三方依赖）转发 API 请求，同时把 `dist/lingua-lector.html` 用
`http://` 提供出来并自动打开：

```bash
# 只转发，不提升安全性：key 仍由浏览器提供
python3 server.py

# key 放在服务端，浏览器不需要真实 key
python3 server.py --anthropic-key sk-ant-... --openai-key sk-... --gemini-key AIza...
```

然后在设置里把对应服务商的 Base URL 改成 `http://localhost:8787/anthropic`、
`http://localhost:8787/openai/v1`、`http://localhost:8787/gemini/v1beta`。
其余参数见 `python3 server.py --help`。

**`cloudflare-worker.js`** 功能相同，跑在 Cloudflare 免费额度上，不需要本地装东西：在
[dash.cloudflare.com](https://dash.cloudflare.com) 新建 Worker，粘贴本仓库
`cloudflare-worker.js` 的全部内容并 Deploy，需要的话在 Settings → Variables 里以 secret 形式添加
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`，然后把 Base URL 填成
`https://你的worker地址/anthropic`。

两种代理都只做转发，不记录内容；`server.py` 只监听本机回环地址。

## 支持范围

| 格式 | 实现 | 说明 |
|---|---|---|
| `.txt` | 浏览器原生 | 按空行分段 |
| `.docx` | [mammoth.js](https://github.com/mwilliamson/mammoth.js) | 提取纯文本，不保留排版 |
| `.pdf` | [pdf.js](https://mozilla.github.io/pdf.js/) | 坐标分行、剔除页眉页码、保留脚注；优先用自带书签分章；仅文字版 |
| `.epub` | [epub.js](https://github.com/futurepress/epub.js) + [JSZip](https://stuk.github.io/jszip/) | 用 epub 自带目录分章 |

分句规则覆盖德语、英语、法语、西班牙语、意大利语、葡萄牙语、荷兰语、拉丁语、捷克语、波兰语、
土耳其语，外加一个通用拉丁字母兜底规则。CJK、西里尔字母等非拉丁字母语言的分句逻辑完全不同，
塞进现有算法效果会很差，这是明确的功能边界。AI 输出语言和界面语言不受此限制。

## 已知限制

- 依赖通过 CDN 引入，离线不可用（首次导入 docx/pdf/epub 和每次解析都需要联网）
- 扫描版 PDF 需要 OCR，本工具不含 OCR
- 自身没有书签的 PDF 会整本作为一章导入。勾选「尝试识别标题并拆分为多章节」可以试着切分，那是基于
  段落形状的启发式：排版规整的书能切对，索引和注释密集的书切不准，结果要自己看一眼
- 分句是规则算法，原文噪声大（OCR 残留）时效果打折
- 部分 AI 服务商不允许浏览器直接跨域调用，见上文

## 开发

```
lingua-lector/
├── dist/lingua-lector.html   # 唯一需要的文件
├── examples/                 # 内置示例书原始数据（公版），每章一个 JSON
├── src/part1..6              # 按逻辑拆分的源码：CSS / body / 核心 / 导入 / 渲染 / 初始化
├── build.py                  # 拼接 src，生成 dist/lingua-lector.html
├── server.py                 # 可选本地代理
└── cloudflare-worker.js      # 可选 Cloudflare 代理
```

```bash
python3 build.py && node tests/run.js
```

测试只需要 Node，不装任何 npm 包，跑的是**构建产物**，所以 `build.py` 的拼接与占位符注入也在覆盖
范围内——先 build 再测。只跑某一类：`node tests/run.js i18n`（按文件名匹配）。

| 文件 | 内容 |
| --- | --- |
| `build-integrity.test.js` | 占位符已替换、标签平衡、内联 JS 语法、`getElementById` 无悬空引用 |
| `i18n.test.js` | 九种语言 key 完整性、`{占位符}` 一致性、页码组件渲染文本、三处语言列表排序一致、提示语提到的按钮真实存在 |
| `library.test.js` | 文档库生命周期、存储后端选择与迁移、解析缓存的按文档隔离 |
| `sentences.test.js` | 分句多语言边界用例 + 全书语料统计护栏（碎片率、超长句率、字符不丢失） |
| `properties.test.js` | 固定种子生成 2000 条病态输入，逐条断言不变量；外加英文真实语料回归 |
| `pdf-layout.test.js` | PDF 行合并、段落切分、标题启发式（用内置全书验证召回，用真实误判样本验证排除） |
| `prompt.test.js` | 系统提示词字面量、译文标签兜底改写、章节切分容错、供应商默认模型 |
| `a11y.test.js` | 语种标注、键盘可达性、live region 与弹窗语义、图标按钮可访问名称、主题对比度 |

## 一个例子

书中最长的单句之一，出自编者所写的导言：

> Nach einjährigem Urlaub, den das Paar in völliger Stille in Florenz verlebt, nimmt er
> schweren Herzens eine Anstellung als stellvertretender Konsul in New York an, nachdem
> Freunde im Auswärtigen Amt in Berlin ihm versichert haben, daß seinem Übergang aus der
> Konsulatskarriere in den eigentlichen diplomatischen Dienst bei allernächster Gelegenheit
> nichts im Wege stände; ein verhängnisvoller Irrtum, bei dem für jeden, dem die Verhältnisse
> im diplomatischen Dienst in den achtziger Jahren bekannt sind, die Vermutung naheliegt,
> dieser freundschaftliche Rat sei, den Gebern vielleicht selbst nicht bewußt, mit davon
> beeinflußt gewesen, daß Heykings Ausscheiden aus dem Amt in Berlin seine Freunde der
> Aufgabe überhob, sich öffentlich zu ihm zu bekennen, eine Aufgabe, die allerdings
> angesichts des höfischen Einflusses seiner Gegner ein großes Maß von Selbständigkeit
> erfordert hätte!

一个主句，一个 `nachdem` 状语从句，两层 `daß` 宾语从句，两处同位语，两个关系从句，全靠层层修饰撑起
近九百字符。工具拆给你看的就是这个：

![最长句的解析结果](docs/longest-sentence-analysis.png)

## 致谢

- 内置示例文本为 Elisabeth von Heyking《Tagebücher aus vier Weltteilen》全书（1926，Grete Litzmann 编），
  已进入公有领域
- 文件解析依赖 [mammoth.js](https://github.com/mwilliamson/mammoth.js)（BSD-2-Clause）、
  [pdf.js](https://github.com/mozilla/pdf.js)（Apache-2.0）、
  [epub.js](https://github.com/futurepress/epub.js)（BSD-2-Clause）、
  [JSZip](https://github.com/Stuk/jszip)（MIT/GPLv3 双重授权）
- 项目主要由 Claude（Anthropic）辅助开发

## License

AGPL-3.0，见 [LICENSE](LICENSE)。选择 AGPL 是希望改进能回流：如果有人修改后把服务部署给公众使用，
AGPL-3.0 要求同时公开修改版的源码。个人使用、二次开发、自建部署都不受影响。
