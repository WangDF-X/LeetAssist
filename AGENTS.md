# AGENTS.md — ShuaTi Assist 项目协作规则

本文件定义 Zed Agent（以及任何协作者）在本项目中必须遵循的工作方式。目标：让开发过程可控、可追溯、可回滚，避免"边想边写"的 vibe coding 失控，同时保持 git 历史干净、易于排查问题。

> 产品定位、核心原则、不做的事，见 `plan/00-product/vision.md`。本文件只约束"怎么做"，不约束"做什么"。

## 0. 最高优先级规则

1. **没有对应的、状态为 `Confirmed` 或 `In Progress` 的 spec 文档，不允许开始编写正式功能代码。** 详见第 2 节。
2. **不允许直接在 `main` 分支上提交或修改代码。** 详见第 1 节。
3. **任何功能在合并回 `main` 之前，必须完成第 4 节的提交前 Review 流程。**
4. 如果 spec 文档中标记了"待确认问题"，或用户的需求超出了已 Confirmed 的范围，**必须先停下来向用户提问**，禁止直接猜测实现（这是本项目对 vibe coding 的唯一让步边界）。
5. **Agent 不主动提交**：任何修改完成后，先向用户汇报改动并让其查看实际效果；只有用户明确指示（如"提交"/"推送"）时才执行 `git commit` / `git push`。详见 1.4 第 4 条。

---

## 1. Git 工作流规范

### 1.1 分支模型

本项目采用简化版 GitHub Flow + 显式 hotfix，而不是完整 Git Flow，因为：
- 项目还没有正式发布，不存在"多个历史版本并行维护"的需求，`develop` 分支只会增加同步成本；
- 一旦发布到 Chrome Web Store 之后需要紧急修复时，才引入 `hotfix/` 分支，这时用 `main` 上的最新 tag 作为基准即可，不需要额外分支。

分支类型：

| 分支前缀 | 用途 | 从哪切出 | 合入哪里 |
|---|---|---|---|
| `main` | 唯一的稳定分支，任何时候都应该能正常构建/运行 | - | - |
| `feature/<module>-<slug>` | 开发一个已 Confirmed 的功能，例如 `feature/whiteboard-autosave` | `main` | `main` |
| `fix/<slug>` | 修复日常开发中发现的非紧急 bug | `main` | `main` |
| `hotfix/<slug>` | 修复已发布版本的紧急问题 | 最新 release tag 或 `main` | `main`，并立即打 tag |
| `docs/<slug>` | 只修改 `plan/`、`README` 等文档，不涉及代码 | `main` | `main` |
| `chore/<slug>` | 依赖升级、构建配置、格式化等 | `main` | `main` |

**规则：**
- `main` 分支受保护，Agent 不直接在 `main` 上 `git commit`，一律先 `git checkout -b feature/xxx` 再开始改代码。
- 一个分支只做一件事，尽量对应一个 `plan/<module>/spec.md`（或其中一条验收标准）。这样天然减少不同分支改到同一批文件的概率，也让每次 diff 容易 review。
- 分支存活时间尽量短（几天内合并），避免和 `main` 差异越拉越大导致冲突堆积。

### 1.2 命名规范

`<类型>/<简短描述，小写中划线分隔>`，例如：

```
feature/timer-ai-estimate
fix/trace-step-counter
hotfix/api-key-leak-in-export
docs/ai-assistant-prompt-spec
chore/bump-tldraw
```

### 1.3 提交信息（Commit Message）规范

在满足你个人全局提交信息规范（简洁、祈使句、主题行 ≤ 50 字符、不加句号、必要时才写正文）的基础上，本项目额外要求主题行带上 **Conventional Commits 类型前缀**，方便以后自动生成 changelog、快速定位历史：

```
<type>(<scope>): <subject>
```

- `type`：`feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `style` / `perf` / `build`
- `scope`：模块名，例如 `whiteboard` / `trace` / `timer` / `ai` / `storage` / `extension`

示例：

```
feat(whiteboard): add autosave to indexeddb
fix(trace): fix step counter for nested loops
docs(plan): confirm timer overtime thresholds
chore(deps): bump tldraw to 2.x
```

### 1.4 合并策略与避免冲突

1. 合并前先把 `main` 的最新变更同步到 feature 分支：
   ```
   git fetch origin
   git rebase origin/main
   ```
   在**自己的、还没有分享出去的 feature 分支**上 rebase 是安全的；**禁止对 `main` 或任何已经推送共享的分支做 rebase / force-push**。
2. 合并回 `main` 使用 `--no-ff`：
   ```
   git merge --no-ff feature/xxx
   ```
   保留一个"合并提交"，方便以后用 `git revert -m 1 <合并提交>` 整体撤销这个功能，而不用一个个找 commit。
3. 每次开发 session 开始时先 `git fetch` 并 rebase 一次，而不是等到最后才同步，可以尽早发现冲突、小步解决。
4. **提交时机由用户把控，按检查点提交**：Agent 完成一批修改后**不自动 commit**，先向用户汇报改动、让用户查看实际效果；用户明确指示后才提交（推送同理）。提交时把这段时间的改动按逻辑完整性整理成少数几个 commit——一个 commit 只做一件逻辑上完整的事，相关联的改动合并成一个，避免历史里堆满"改一点提交一次"的细碎中间态，保持 git history 干净易读。
5. 不要手改生成文件/锁文件（如 `package-lock.json`、`dist/`）来"解决冲突"，出现冲突时重新生成。

### 1.5 Tag 与发布

- 每完成一个 Phase（见 `plan/00-product/vision.md` 的阶段划分）或每次提交 Chrome Web Store 审核前，在 `main` 上打 tag：`v0.1.0`、`v0.2.0` ...（遵循语义化版本）。
- Tag 只打在 `main` 上，不打在 feature 分支上。

---

## 2. Spec-Driven 开发规则（拒绝无依据的 vibe coding）

本项目参考 spec coding 的原则："先有明确文档，再写代码"。

### 2.1 文档位置

所有产品/功能规格文档都在 `plan/` 目录下，按模块拆分子目录：

```
plan/
├── README.md              文档规范与流程说明
├── _template.md           新建 spec 用的模板
├── 00-product/vision.md   产品定位、核心原则、不做的事、整体路线图
├── 01-extension-shell/spec.md
├── 02-storage/spec.md
├── 03-whiteboard/spec.md
├── 04-ai-assistant/spec.md
├── 05-timer/spec.md
└── 06-trace/spec.md
```

新增模块时复制 `plan/_template.md`。

### 2.2 Spec 状态机

每个 spec 顶部有一个 `状态` 字段：

```
Draft → Confirmed → In Progress → Done
```

- **Draft**：初稿，可能存在"待确认问题"，**不允许基于它写正式功能代码**。
- **Confirmed**：用户已经明确回答了所有"待确认问题"，范围和边界清晰，**可以开始开发**。
- **In Progress**：已经开了对应 feature 分支在开发。
- **Done**：功能已经合并进 `main` 并通过第 4 节的 Review。

### 2.3 Agent 的强制行为

- 开始写任何功能代码前，先确认对应 `plan/<module>/spec.md` 是否存在，状态是否为 `Confirmed`/`In Progress`。
- 如果 spec 不存在、还是 `Draft`、或者用户的要求超出了 spec 已写明的范围 —— **停下来，向用户提出具体问题，等待确认后再更新 spec 状态并开始写代码**，不要凭经验直接猜测实现细节（比如 UI 长什么样、字段叫什么名字、边界条件怎么处理）。
- 每个 spec 里都有"待确认问题"清单，Agent 在遇到相关实现细节时应主动引用该清单向用户提问，而不是自己拍板。
- 唯一允许的"跳过 spec 直接写代码"场景：明确标注为一次性 spike/原型验证（例如"验证 Pyodide 能不能拿到逐行 trace"），必须满足：
  1. 提前告知用户这是探索性代码，不计入正式功能；
  2. 写在独立分支（例如 `spike/pyodide-trace`），**不合并进 `main`**；
  3. 验证完成后如果要转正，必须先补 spec 并走正常流程。
- 实现过程中如果发现 spec 描述不清楚/和实际情况冲突（例如 LeetCode 页面结构和文档假设不一致），暂停编码，更新 spec 的"待确认问题"并询问用户，而不是自行改变行为后不记录。

---

## 3. 通用工程约束（来自产品核心原则）

以下约束适用于所有模块，任何 spec 都不能违反，除非用户明确要求修改本文件：

1. **Local First**：用户数据、API Key 默认全部存在本地（`chrome.storage.local` / `IndexedDB`），不允许引入自建后端或把用户数据发到第三方服务器。
2. **BYOK**：AI 请求只能发往用户在设置里配置的 Base URL，Agent 不得硬编码任何厂商的固定 API Key 或强制绑定单一模型厂商。
3. **API Key 安全**：
   - 任何日志、错误上报、埋点都不允许包含 API Key 或用户代码原文。
   - 导出功能（Export）默认**不包含** API Key / Provider 配置，需要用户显式勾选才导出。
4. **Small & Useful**：不新增"账号系统 / 云同步 / 社交 / 排行榜 / 题库 / 学习计划 / 自动刷题"等超出 `plan/00-product/vision.md` 范围的功能，即使实现起来很容易，也要先询问用户是否要扩大范围并更新 vision 文档。

---

## 4. 提交前 Review 流程（Definition of Done）

每个 feature/fix 分支在执行 `git merge` 回 `main` 之前，必须走完以下 checklist；发现问题要先修复，而不是直接合并：

1. **范围核对**：这次改动是否完全对应 spec 里某一条已 Confirmed 的需求/验收标准？有没有顺手做了 spec 之外的事（scope creep）？如果有，拆分出去或先向用户确认要不要收进这次改动。
2. **静态检查**：跑一遍 diagnostics/lint/类型检查，确认没有新增报错和警告（允许的历史遗留问题需要单独说明，不能把新问题混进去）。
3. **构建与测试**：项目有构建/测试脚本时必须跑一遍并确认通过；新增的行为要补充或更新对应测试。
4. **敏感信息检查**：`git diff` 全量走查一遍，确认没有把 API Key、用户真实数据、`.env`、本地调试用的 `console.log`/`debugger` 带进提交。
5. **文档同步**：如果实现细节和 spec 描述有出入，先更新对应 `plan/<module>/spec.md`（包括"待确认问题"是否已解决、"变更记录"表格），代码和文档一起提交。
6. **总结汇报**：向用户简要说明这次改动做了什么、Review 中发现并修复了哪些问题、还有哪些已知问题/后续待办，等待确认（或按用户授权自动继续）后再执行合并和 commit（合并前的任何中间 commit 同样遵循 1.4 第 4 条的提交时机规则）。
7. 全部通过后才允许 `git merge --no-ff` 回 `main`，并按 1.3 节规范写 commit/合并信息。

---

## 5. 目录约定

```
src/
├── background/     对应 plan/01-extension-shell
├── content/        对应 plan/01-extension-shell
├── sidepanel/
│   ├── whiteboard/ 对应 plan/03-whiteboard
│   ├── ai/         对应 plan/04-ai-assistant
│   ├── timer/      对应 plan/05-timer
│   └── trace/      对应 plan/06-trace
├── ai/             对应 plan/04-ai-assistant
├── trace/          对应 plan/06-trace
└── storage/        对应 plan/02-storage
```

保持一个 spec 对应一组代码目录，方便判断"这次改动属于哪个 spec、应该开在哪个分支"。

---

## 6. 当规则本身需要修改时

本文件（`AGENTS.md`）不是产品 spec，而是流程规则。修改它本身也要走 `docs/` 分支 + 明确告知用户改了什么、为什么改，不允许 Agent 单方面静默调整规则。
