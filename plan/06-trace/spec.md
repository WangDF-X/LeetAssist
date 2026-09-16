# 06. Trace（代码执行 Trace）Spec

- 状态：Draft
- 关联阶段：第一版正式版之后（V1 不含任何 trace 功能；用户 2026-09-15 确认：第一版不做 trace，但方向保留，本文档全部技术结论在正式版后继续有效）
- 最后更新：2026-09-14
- 涉及代码目录：`src/trace/types.ts`, `src/trace/python/`, `src/trace/go/`, `src/trace/visualizer/`

## 1. 目标（In Scope）

这是项目的核心技术模块，遵循"能真实执行就绝不让 LLM 模拟"的原则。

> **范围调整（2026-09-15 用户确认）**：第一版正式版（V1）**不包含任何语言的 trace 功能**。本 spec 的全部内容作为正式版之后的规划保留，技术结论（Pyodide / Yaegi 零后端路线、先录制后回放架构等）原样保留，正式版后无需重新调研。

- **Phase 5（真实执行，Python 和 Go 同一优先级，不分先后）**：
  - **Python**：用 Pyodide 在浏览器内真实执行用户的 Python 代码，通过 Instrumentation（`sys.settrace`）得到统一的 `TraceEvent[]`（详见第 1a 节）。
  - **Go**：用 Yaegi（Go 语言写的 Go 解释器）编译成 WebAssembly，在浏览器内直接解释执行用户的 Go 代码，同样产出统一的 `TraceEvent[]`（详见第 1b 节）。这条路线已经有开源项目（`debugo`）验证过可行，风险和 Python 路线接近，因此**不再作为"后续阶段"的次要语言，而是和 Python 并列成为第一版就要做的两个真实执行语言**。
  - 两个语言分别对应一个 Adapter（`src/trace/python/`、`src/trace/go/`），各自负责"怎么拿到执行状态"，但都输出同一份 `TraceEvent[]` 格式，Visualizer 只认这份统一格式，不理解任何语言相关语法。
  - 功能按以下顺序递进实现，Python 和 Go 各自都遵循这个顺序，不要反过来：
    1. Run / Step / Pause / Continue / Restart，展示当前行、局部变量、调用栈、输出、异常。
    2. 展示基本容器：list/dict/set/tuple（Python）、slice/map/struct（Go）。
    3. 展示复杂结构：Tree / LinkedList / Heap / Graph。
- **Phase 6（AI Simulation，可选模式，语言无关）**：
  - 在 Trace 页面提供"Execution Mode"切换：`● Real Execution` / `○ AI Simulation`。
  - AI Simulation 基于 Problem + Code + Input + LLM 生成模拟的 Step 序列，UI 必须明确标注"AI Generated Trace"，并提示"可能与真实运行结果不一致"，不能和真实执行结果混在一起展示。
  - 对 Python 和 Go 都适用，不需要分别设计。

## 1a. 关键技术结论：Python Trace 不需要后端

已确认：**不需要引入任何后端**，"完全本地/无后端"的假设成立，原规划的技术路线是对的。

- Pyodide 把 CPython 编译成 WebAssembly 后可以在浏览器里真实执行任意 Python 代码，这不是"模拟"，是真正的解释器在跑，不需要把代码发到服务器执行。
- Python 标准库自带的 `sys.settrace` 在 Pyodide 里可以正常工作。已有开源项目（例如 `TRACE-visualizer`）验证了完整路线：`sys.settrace` 逐行捕获执行状态 → 序列化局部变量/调用栈 → 识别链表/树/网格等结构 → 前端渲染，并且做了步数上限（`STEP_CAP`）防止死循环卡死浏览器，思路和本 spec 第 8 节的安全限制要求完全一致。
- 由于 `sys.settrace` 的回调必须是同步的，没法做成"解释器真的暂停、等用户点下一步再继续"的实时交互模型（一旦开始跟踪就会同步跑到底或跑到步数上限）。因此推荐的架构是"先完整录制、再回放"：
  1. 用户点 Run 时，一次性把代码执行完（受步数上限保护），把整个过程记录成 `TraceEvent[]` 数组；
  2. Step / Pause / Continue / Restart 这些交互，都是在这个**已经录制好的数组**里前后移动一个指针，而不是真的去控制解释器暂停/恢复；
  3. 用户体验上和真的能单步调试没有区别，但实现上简单可靠得多，也是已有开源方案验证过的路线。
- 必须把 Pyodide 的执行放进 **Web Worker**，而不是直接在 Side Panel 主线程跑，否则用户代码稍微复杂或不小心写了死循环，会直接卡死整个 Side Panel（这是步数上限之外的第二道安全网）。

## 1b. 关键技术结论：Go Trace 同样不需要后端，已提升为第一版目标

已决定（根据用户反馈）：**Go Trace 和 Python Trace 同一优先级**，不再放到"后续阶段"。

- Go 官方支持把 Go 代码编译成 WebAssembly（`GOOS=js GOARCH=wasm go build`），但那只解决了"运行"，编译这一步仍然需要 Go 工具链，**没法在浏览器里直接编译用户临时输入的 Go 源码**（这也是官方 Go Playground 采用"把代码发到服务器编译"的原因，不适合我们）。
- 真正可行的路是"不编译，直接解释执行"：[Yaegi](https://github.com/traefik/yaegi) 是一个**用 Go 写的 Go 解释器**，不需要编译、逐语句解释运行，概念上和"CPython 解释 Python"是同一类东西。Yaegi 自己可以被编译成 WebAssembly，装进浏览器后就能直接解释执行用户输入的任意 Go 源码——这和 Pyodide 解决 Python 问题的思路几乎一模一样：把解释器编译成 WASM，用户代码不用编译，直接喂给解释器。
- 已有开源项目验证了这条路线，甚至比我们需要的更进一步：[`debugo`](https://github.com/carbap/debugo)（Yaegi + WASM 实现的 Go Playground）**已经做出了断点、单步执行、变量/作用域查看**，这几乎就是我们 Trace 功能需要的东西的现成参考实现；`go-browser-interpreter`、`yaegi-wasm` 等项目也验证了同样的"Yaegi 编译成 WASM 后在浏览器里跑用户 Go 代码"路线是成熟可行的。
- 已知限制：Yaegi 不是 100% 完整实现 Go 语言/标准库（例如不支持 cgo、部分依赖 `reflect`/`unsafe` 的标准库功能可能缺失，对最新语言特性的支持程度依 Yaegi 版本而定），但 LeetCode 场景下的代码通常只用到 slice/map/struct/基本控制流/常见标准库函数，大概率都在 Yaegi 的覆盖范围内，需要实际测试确认。
- Go 这边同样建议采用"先完整录制、再回放"的架构（和 1a 节 Python 的架构一致），并且同样需要放进 **Web Worker**，原因和 Python 完全一样（防止死循环卡死界面）。
- 具体怎么从 Yaegi 里拿到"逐行执行状态 + 局部变量"（对标 Python 的 `sys.settrace`）还没有在本项目里实际验证，需要专门做一次 spike（可以参考 `debugo` 的实现思路），验证通过后把细节回填进本 spec。

## 1c. C++（以及大多数编译型系统语言）：仍不在计划内，没有已验证的零后端方案

- C/C++ **可以**在浏览器里编译成 WebAssembly 并运行，不需要后端（例如 `wasm-clang`、`browsercc`、`YoWASP/clang` 等项目，把 Clang/LLVM 编译器本身编译成 WASM），所以"执行"本身可以做到无后端。
- 但"执行"和"拿到逐行 Trace + 局部变量"是两件事。C++ 没有像 `sys.settrace`（Python）或 Yaegi（Go，本身是解释器）这样"自带/现成"的单步执行钩子。查证了原规划里提到的参考项目"leetcode-visualizer"，以及另外几个同类的开源 C++ 可视化项目（例如 SeePlusPlus、Data-Structure-Visualizer-Project、lldbvisualizer），**它们无一例外都依赖后端**：在服务器上用 `g++ -g` 编译出带调试信息的真实二进制，再用 GDB（MI 模式）/LLDB/Valgrind 之类的原生调试器逐行驱动执行、读取变量。也就是说，原规划里"参考 leetcode-visualizer 的 C++/LLDB 方案"这条说明本身也隐含了一个后端，只是原文没有明确指出。
- 如果以后真的要做 C++，需要先决定接受哪种妥协：自建源码级 Instrumentation（工作量明显更大）、探索 `chrome.debugger` 程序化控制 WASM DWARF 调试（可行性完全未知）、或引入后端/本机原生程序（对 Local First 的一次妥协）。**目前不在任何 Phase 范围内，暂不需要现在决定。**

## 2. 明确不做

- 不让 LLM 作为默认/唯一的代码执行方式；LLM 只是"可选模式"，且必须显式标注。
- 第一版真实执行只做 **Python 和 Go** 两种语言；C++ 等其他编译型语言的真实执行不在计划内（原因见 1c 节）。
- 第一版不追求"所有变量变化的完整还原"，只做第 1 点里列的递进范围，Python 和 Go 都一样。

## 3. 详细需求

（初稿，很多细节待定，见第 8 节）

- Python 和 Go 各自的 Instrumentation 实现完全独立（一个基于 `sys.settrace`，一个基于 Yaegi 的解释循环），但对上层暴露的接口必须一致：输入代码 + 语言，输出 `TraceEvent[]`。
- Trace 页面需要一个语言指示（跟随 LeetCode 编辑器当前选择的语言自动切换，用户不需要手动选择"用哪个 Adapter"）。

## 4. 数据结构 / 接口

```ts
interface TraceEvent {
  step: number;
  line: number;
  event: "line" | "call" | "return" | "exception";
  locals: Record<string, unknown>;
  stack: StackFrame[];
  output?: string;
}
```

`StackFrame` 的具体字段待定。这份结构是 Python Adapter 和 Go Adapter 共用的契约，任何一方都不能私自扩展字段而不通知另一方。

Trace UI 基本布局：

```
Code
1  for i, x in enumerate(nums):
2      if target - x in mp:
3          return [mp[target-x], i]
4
5      mp[x] = i

当前：>>> line 2

Variables
i       1
x       7
target  9
mp      { 2: 0 }

◀   ▶   ▶▶   1 / 8
```

## 5. UI / 交互

- 控制条：`◀ ▶ ▶▶` + `当前步 / 总步数`。
- 右侧变量面板 + 调用栈。
- 当前语言（Python/Go）跟随 LeetCode 编辑器自动识别，不需要用户手动切换 Adapter。
- Execution Mode 切换（Phase 6 引入）：
  ```
  Execution Mode
  ● Real Execution
  ○ AI Simulation
  ```
  并显示提示语：`AI Simulation is generated by the configured LLM and may not reflect the exact runtime behavior.`

## 6. 依赖

- 依赖的其他 spec：01-extension-shell（获取当前代码/语言）、04-ai-assistant（AI Simulation 模式复用 LLMProvider）、02-storage（trace 结果持久化）
- 依赖的第三方库：`Pyodide`（Python Adapter）、`Yaegi`（Go Adapter，编译成 WASM）
- 可参考的开源项目：
  - **LeetCode Solution Visualizer**：已实现 Pyodide + Execution Trace + 变量/数组/链表/树/Map/Set/调用栈的可视化，是 Python Adapter 最值得重点研究的参考实现。
  - **`debugo`（github.com/carbap/debugo）**：Yaegi + WebAssembly 实现的 Go Playground，已经做到浏览器内断点/单步/变量查看，是 Go Adapter 最值得重点研究的参考实现，重要程度和 LeetCode Solution Visualizer 相当。
  - **Yaegi（github.com/traefik/yaegi）**：Go 语言写的 Go 解释器本体，Go Adapter 的核心依赖库。
  - **leetcode-visualizer**：实现了 C++（通过 clang++ / LLDB）的真实执行 Trace，但据调研这类实现通常依赖后端驱动 GDB/LLDB，仅作为"如何设计统一执行状态"的参考，不能当作"零后端"方案的证明，也不代表本项目近期计划做 C++。

## 7. 验收标准

（Phase 5 范围，Python 和 Go 各自都要满足）

- [ ] 用户可以对一段 Python 代码执行 Run / Step / Pause / Continue / Restart，每一步能正确展示当前执行行、局部变量、调用栈、标准输出、未捕获异常，执行结果来自真实 Pyodide 执行，不经过 LLM。
- [ ] 用户可以对一段 Go 代码执行 Run / Step / Pause / Continue / Restart，每一步能正确展示当前执行行、局部变量、调用栈、标准输出、未捕获异常，执行结果来自真实 Yaegi 解释执行，不经过 LLM。
- [ ] Python 和 Go 的执行都运行在独立 Web Worker 中，即使用户代码触发死循环/超长执行，Side Panel 主线程界面依然可以响应（不被卡死）。
- [ ] 切换 LeetCode 编辑器的语言（Python ↔ Go）后，Trace 页面能自动使用对应的 Adapter，不需要用户手动选择。

## 8. 待确认问题

- [ ] `sys.settrace`（Python）方案的**可行性已通过调研确认**（见第 1a 节），但具体 Instrumentation 代码还没有在本项目里实际写过，建议作为一次 spike 完成（例如 `spike/pyodide-trace` 分支，不合并进 `main`），验证通过后把细节回填进本 spec。
- [ ] Yaegi（Go）方案的**可行性已通过调研确认**（见第 1b 节），但具体怎么从 Yaegi 里拿到逐行执行状态还没有实际验证，同样建议做一次 spike（例如 `spike/yaegi-trace` 分支，可参考 `debugo` 的实现思路），验证通过后把细节回填进本 spec。
- [ ] Pyodide 和 Yaegi 的运行时文件是否要**打包进插件安装包本地加载**，而不是从 CDN 动态加载？Chrome Web Store 对 Manifest V3 有"不允许加载远程托管代码"的政策倾向，为规避审核风险，倾向于本地打包，但会显著增加插件安装包体积（两个语言的运行时都打包，体积会更大），需要确认是否接受。
- [ ] Pyodide / Yaegi 放进 Web Worker 后，Side Panel 主线程 ↔ Worker ↔ 解释器之间的消息通信协议（怎么传代码、怎么传回 `TraceEvent[]`）待实现时具体设计，两个 Adapter 是否共用同一套 Worker 通信协议？
- [ ] LeetCode 题目常用的自定义结构（Python 的 `ListNode`/`TreeNode`，Go 的对应等价结构体）如何映射成可视化的链表/树，映射规则尚未设计，且需要 Python/Go 两套规则保持视觉呈现一致。
- [ ] 无限循环/超长执行的保护机制（最大步数、最大执行时间、超限后的提示）尚未确定，Python 和 Go 是否使用同一套阈值？
- [ ] Trace 数据量可能很大，持久化到 `ProblemSession.trace` 时是否需要裁剪/限制大小？
- [ ] AI Simulation 阶段要求 LLM 返回的结构化 JSON 具体 schema（是否直接复用 `TraceEvent[]`）尚未设计。
- [ ] Python Adapter 和 Go Adapter 是同时开工，还是先完成一个再做另一个？（虽然优先级相同，但实现顺序仍需要你决定，比如先做你更熟悉的 Go，还是先做技术验证更充分的 Python）
- [ ] C++（或其他编译型语言）Trace 目前**没有已验证的零后端方案**（见第 1c 节），如果以后想做，需要先决定接受哪种妥协，目前不在任何 Phase 的范围内，暂不需要现在决定。

## 9. 变更记录

| 日期 | 修改内容 |
|---|---|
| 2026-09-12 | 根据总体规划文档整理出初稿 |
| 2026-09-13 | 补充"Python Trace 无需后端"的技术调研结论（Pyodide + sys.settrace + Web Worker + 先录制后回放架构），更新待确认问题 |
| 2026-09-13 | 补充"其他语言能否零后端真实执行"的调研结论：Go 可以（Yaegi + WASM，已有 `debugo` 等参考实现），C++ 目前没有已验证的零后端方案 |
| 2026-09-14 | 根据用户反馈，将 Go Trace 提升为与 Python Trace 同一优先级（原 Phase 7 并入 Phase 5），重写目标、非目标、验收标准、依赖、待确认问题，反映"两个语言并列"的新结构 |
| 2026-09-15 | 用户确认第一版正式版（V1）不包含任何 trace 功能，本模块整体延后到正式版之后，增加范围调整说明 |
