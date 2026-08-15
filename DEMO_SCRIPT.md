# Vibe Voice Workspace Demo 脚本

建议时长：4–6 分钟。开始时保持初始文档不变，并打开右侧 Canvas。

## 场景一：理解整份文档

说：

> 先看一下这份文档。第二部分描述的流程是什么？

预期表现：

- Agent 先调用 `read_document`，再回答问题。
- 它能准确引用“二、协作流程”，而不是根据当前可见区域猜测。
- 语音回答保持简短、自然。

## 场景二：选区改写与语音确认

选中“一、核心体验”下方的段落，然后说：

> 这段有点像功能说明，帮我改得更像一个简洁的产品目标。

预期表现：

- `read_document` 能识别当前选区。
- `propose_document_patch` 在右侧生成可审阅的 diff，不直接修改正文。

然后说：

> 接受这个修改。

预期表现：

- `resolve_document_patch` 应用修改。
- 原 block ID 保持不变，编辑器仍可撤销。

## 场景三：主动建议

说：

> 打开主动建议。

然后在“二、协作流程”段落末尾补一句并停笔约 5 秒：

> 这里还需要把不同处理路径讲得更清楚。

预期表现：

- `set_proactive_mode(mode="suggest")` 开启主动模式。
- 收到停笔信号后，Agent 重新读取文档，最多提出一个具体、可拒绝的建议，例如建议把分支流程画成图。
- 它不会在没有确认时自行编辑、画图、搜索或发起 delegation。

如果它建议画图，说：

> 可以，画出来吧。

预期表现：

- `create_canvas_artifact(type="mermaid")` 在 Canvas 中生成真正的 SVG 流程图。

## 场景四：补全未完成内容

选中“四、成功指标”的待补充段落，然后说：

> 把这里补成三个可量化的指标，分别衡量理解准确率、建议采纳率和语音连续性。

看到 diff 后说：

> 先不要接受，把每个指标再写得更短一点。

最后接受新版本。这一段展示选区定位、多轮 steering 和语音确认。

## 场景五：并行 delegation

说：

> 把“协作流程”做成一张更完整的 Mermaid 图，同时把“核心体验”那段润色一下。这两个任务同时处理，不要排成先后顺序。

预期工具参数：

```json
{
  "execution_mode": "parallel",
  "tasks": [
    {
      "task_key": "diagram_flow",
      "output_kind": "mermaid",
      "depends_on": []
    },
    {
      "task_key": "polish_experience",
      "output_kind": "polish",
      "depends_on": []
    }
  ]
}
```

预期表现：

- Agent 只调用一次 `delegate_tasks`，一次提交两个任务。
- Tasks 页签出现一个 Parallel batch，两个后台请求同时开始。
- 每个任务在执行时保持 5%；完成后独立变成 `Ready for review` 和 100%，并显示自己的结果 diff。
- 可以分别 Apply 或 Dismiss；接受一个段落的结果不会覆盖另一个任务。
- Agent 说“两项任务已并行提交”，而不是“先做 A，再做 B”。

当前原型的真实边界：后台 worker 已通过 Responses API 接入。Cancel 会中止对应浏览器请求；运行中的 steering 和 pause 尚未接入，因此界面暂不展示这两个操作。

## 可选收尾

说：

> 关闭主动建议。

这可以展示主动行为始终由用户明确控制。
