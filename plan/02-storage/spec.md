# 02. Storage（本地存储与导入导出）Spec

- 状态：In Progress（2026-09-21 起，随 `feature/whiteboard-konva` 落地最小骨架：Dexie + sessions 表；导入导出/用量展示后续单独分支）
- 关联阶段：Phase 2 起（画板需要落地存储），贯穿全项目
- 最后更新：2026-09-15
- 涉及代码目录：`src/storage/settings.ts`, `src/storage/database.ts`, `src/storage/backup.ts`

## 1. 目标（In Scope）

- 用 `chrome.storage.local` 保存轻量配置：AI Provider 列表（name/baseURL/apiKey/model）、UI 设置。
- 用 IndexedDB（通过 **Dexie** 封装）保存业务数据：每道题一个 `ProblemSession`（画板、计时、trace 等）。
- **AI 对话完整保留**：一个题目可建多个对话（Conversation），每个对话完整保留消息记录（见 04-ai-assistant 3.3）；体积靠上下文快照去重控制；`@code` 代码附件按快照存储、消息引用 id。
- 提供数据导出为单个 JSON 文件、导入恢复、清空本地数据三个功能。
- 导出默认不包含 API Key / Provider 配置，需用户显式勾选 "Include API settings" 才导出。
- 在设置页展示本地存储占用情况（用量、大致数据构成），不做自动清理/清理提醒。
- API Key **不加密**、明文存储在 `chrome.storage.local`，但在 UI 上必须有清晰、持续可见的提醒，让用户明确知道这一点。

## 2. 明确不做

- 不做任何形式的云端同步或后端存储。
- 不做多用户/账号隔离。
- 不做存储容量上限或自动清理提醒（用户自己的数据，不代替用户做清理决定）。
- 不对 API Key 做加密或混淆处理（原因见第 3.5 节）。

## 3. 详细需求

### 3.1 IndexedDB 封装：Dexie

已确认使用 [Dexie.js](https://dexie.org/) 作为 IndexedDB 的封装库，而不是原生 IndexedDB API。原因：Dexie 提供声明式 schema、Promise/async 风格 API、内置版本升级机制（`.upgrade()`），比手写原生 IndexedDB 的事务/游标代码简单可靠很多，是目前最成熟的 IndexedDB 封装库之一。

表设计：`sessions`（ProblemSession）、`conversations`（对话，messages 数组内嵌于单条记录，简化事务与读取）、`codeSnapshots`（@code 附件去重）。

### 3.2 Schema 版本与"惰性兼容"迁移策略

已确认策略：

1. 每条存储记录（如 `ProblemSession`）都带一个 `schemaVersion` 字段，标记这条记录是在哪个数据结构版本下写入的。
2. 数据库整体的版本升级通过 Dexie 的版本链定义（`db.version(N).stores({...})`），**结构性变化**（比如表结构调整、字段改名）才需要在对应版本的 `.upgrade(tx => {...})` 回调里写迁移代码，一次性把旧数据转换成新结构。
3. **惰性兼容**：如果只是新增了一个可选字段（不是结构性变化），不需要在 `.upgrade()` 里批量回填所有旧记录；而是在"读取"这条记录的代码里做防御性处理——发现字段缺失时，用默认值兜底，而不是要求所有历史数据都提前迁移。这样可以避免"每加一个新字段就要写一次全量迁移脚本"的负担，只有真正的结构调整才触发 `.upgrade()`。

### 3.3 存储用量展示（替代"清理提醒"）

已确认：不主动提示用户清理数据，但在设置页某个区域展示：

- 当前 Chrome 扩展存储的总用量（用 [`navigator.storage.estimate()`](https://developer.mozilla.org/docs/Web/API/StorageManager/estimate) 获取整体已用/配额估算）。
- 一个大致的数据构成概览，例如：已保存题目数、画板数据总大小、对话数据总大小、Trace 数据总大小等分类估算（通过遍历 Dexie 各表、序列化后统计字节数得到，考虑到用户体量不大，这个计算成本可以接受）。

### 3.4 导入冲突处理

已确认：Import 时如果本地已存在同一 `problemId` 的记录，**只有真正冲突的记录才需要用户处理**，不冲突的记录直接正常导入，不打扰用户。对于冲突的记录，**同时提供"全部覆盖""全部跳过""逐条选择"三个选项**，由用户自己决定用哪种方式处理这一批冲突。具体交互：

1. 导入前先扫描一遍备份文件，逐条比对 `problemId`。
2. 没有冲突的记录直接静默导入。
3. 有冲突的记录，先展示一个汇总提示（"发现 N 条题目记录已存在于本地"），提供三个入口：
   - **全部覆盖**：这一批冲突记录全部用备份数据覆盖本地；
   - **全部跳过**：这一批冲突记录全部保留本地现状，不导入；
   - **逐条选择**：展开冲突列表（题目标题 + 本地/备份的更新时间对比，方便判断该留哪个），对每条分别选择"覆盖本地 / 跳过"。
4. 三个选项都是用户主动点击才会生效，不会有默认自动选中的行为，避免误触导致数据丢失。

### 3.5 API Key 存储：不加密，但持续可见地提醒用户

已确认采用方案 C：不做加密或混淆，明文存储在 `chrome.storage.local`。原因（技术现实）：没有用户输入的"主密码"，就不存在真正意义上的加密——解密密钥最终必须让插件自己能拿到，否则插件没法用这个 Key 调用 AI 接口；任何"用户无感"的加密方案本质上只是混淆，无法防御真正有能力反编译插件代码的攻击者，反而可能让用户误以为"已加密=更安全"，产生错误的安全感。

因此采用"不加密 + 持续提醒"的组合：

- 依赖 `chrome.storage.local` 本身"只有本插件自己能读，其他网页/插件读不到"的隔离性作为唯一防线。
- 在 Provider 设置表单里 API Key 输入框的**下方常驻**一行说明文字（不是一次性弹窗/Toast，是每次打开设置页都能看到）：例如"该 Key 以明文形式仅保存在浏览器本地、此插件专属的存储空间内，不会加密，也不会上传到任何服务器；请勿在公共/共享设备上保存真实 API Key"。
- 首次配置 Provider 时，在保存前弹一次确认提示，确保用户至少看过一次这个说明（之后不用每次都弹窗打扰，常驻文字说明已经足够）。

## 4. 数据结构 / 接口

```ts
interface ProblemSession {
  schemaVersion: number; // 数据结构版本，用于"惰性兼容"读取
  problemId: string;
  title: string;
  url: string;

  code: string;
  language: string;

  timer: {
    recommended: number; // 分钟
    elapsed: number;      // 秒
  };

  whiteboard: unknown; // 画板场景（WhiteboardScene，自定义元素模型），具体结构见 03-whiteboard spec §4

  aiMessages: AiMessage[]; // 结构见 04-ai-assistant spec

  trace: TraceEvent[]; // 结构见 06-trace spec

  createdAt: string;
  updatedAt: string;
}

interface ProviderConfig {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string; // 明文存储，见第 3.5 节
}

interface Conversation {
  id: string;
  problemId: string;
  title: string;            // 直接读网页：题号+题目+难度
  contextSnapshot: unknown; // 每对话一份的题目描述/约束快照（去重）
  messages: unknown[];      // ConversationMessage[]，结构见 04-ai-assistant
  createdAt: string;
  updatedAt: string;
}

interface CodeSnapshot {
  id: string;
  problemId: string;
  language: string;
  code: string;             // @code 附件；消息内引用 id，同一份代码不重复存
  createdAt: string;
}
```

## 5. UI / 交互

设置页：

```
Data
[Export Data]
[Import Data]
[Clear Local Data]

Export:
□ Include API settings   (默认不勾选)

本地存储占用
已使用：约 X.X MB（配额 Y MB）
├─ 已保存题目：N 道
├─ 画板数据：约 X KB
└─ Trace 数据：约 X KB
```

Import 冲突时，先展示汇总入口：

```
发现 3 条题目记录已存在于本地：
- two-sum
- lru-cache
- valid-parentheses

[全部覆盖]  [全部跳过]  [逐条选择]
```

选择"逐条选择"后展开列表：

```
two-sum        本地更新于 09-10   备份更新于 09-12   [覆盖本地] [跳过]
lru-cache      本地更新于 09-08   备份更新于 09-08   [覆盖本地] [跳过]
```

Provider 设置表单：

```
Name:     [___________]
Base URL: [___________]
Model:    [___________]
API Key:  [***************]
⚠ 该 Key 以明文形式仅保存在浏览器本地、此插件专属的存储空间内，
   不会加密，也不会上传到任何服务器；请勿在公共/共享设备上保存真实 API Key。
```

## 6. 依赖

- 依赖的其他 spec：03-whiteboard（whiteboard 快照结构）、04-ai-assistant（aiMessages 结构、ProviderConfig 结构）、06-trace（trace 结构）
- 依赖的第三方库：`dexie`

## 7. 验收标准

- [ ] 关闭重开浏览器后，之前的画板/代码/计时/对话数据能正确恢复。
- [ ] Export 生成的 JSON 可以在另一台设备 / 清空数据后 Import 完整还原（含多对话记录与画板/计时数据；除非用户主动排除 API 设置）。
- [ ] 默认导出文件里不包含明文 API Key。
- [ ] 设置页能看到本地存储用量的大致展示（总量 + 分类概览）。
- [ ] Import 时，不冲突的记录静默导入；冲突的记录会展示汇总提示，且"全部覆盖""全部跳过""逐条选择"三个选项都可用，选择"逐条选择"后能对每条分别决定"覆盖本地/跳过"。
- [ ] Provider 设置表单里，API Key 输入框下方常驻显示"不加密"的提醒文字；首次保存 Provider 前会弹一次确认提示。
- [ ] 未来给 `ProblemSession` 新增一个可选字段时，旧数据不需要写迁移脚本也能正常读取（惰性兼容验证）。

## 8. 待确认问题

暂无，全部确认完毕。

## 9. 变更记录

| 日期 | 修改内容 |
|---|---|
| 2026-09-12 | 根据总体规划文档整理出初稿 |
| 2026-09-15 | 确认 Dexie、schemaVersion + 惰性兼容迁移策略、存储用量展示替代清理提醒、Import 冲突"逐条选择、仅冲突项需要处理"的交互设计 |
| 2026-09-15 | 确认 API Key 采用方案 C（不加密）+ 常驻提醒设计；所有待确认问题清空，状态由 Draft 改为 **Confirmed** |
| 2026-09-15 | 修正 Import 冲突交互设计：恢复"全部覆盖/全部跳过/逐条选择"三个选项并存（之前误删了批量选项，仅保留了逐条选择） |
| 2026-09-15 | 新增 AI 对话持久化：conversations / codeSnapshots 表，一题多对话、完整保留记录、上下文快照去重（配合 04 的新 UI 设计） |
| 2026-09-21 | 随画板分支落地最小骨架（Dexie + sessions 表 + ProblemSession，仅服务画板持久化）；whiteboard 字段注释更新为 03 的新自定义元素模型（WhiteboardScene）；导入导出/存储用量展示后续单独分支；状态 → In Progress |
