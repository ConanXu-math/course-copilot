# 知识图谱 v2 数据约定

新生成的知识图谱必须使用下列 v2 格式。旧版资料仍可读取，不补造证据，不改写旧文件。字段中的教材内容、页码、路径和结果 ID 均使用本次真实值。

## 资料与覆盖

| 字段 | 约定 |
| --- | --- |
| `id`、`title` | 本次指定的结果 ID；反映实际范围和主题的非空标题。 |
| `kind`、`schemaVersion` | 固定为 `"knowledge-graph"`、`2`。 |
| `detailLevel` | `"overview"` 或 `"detailed"`，与本次深度一致；默认概览。 |
| `coverage.summary` | 非空文字，说明实际覆盖程度及重要缺口。 |
| `coverage.items` | 非空主题清单，每项包含 `title`、`pages`、`status`、`note`。 |
| `nodes`、`edges` | 非空节点数组、关系数组；正文没有可靠关系时 `edges` 可为空。 |

覆盖项的 `title` 是范围内的实际主题，`status` 为 `covered`（已读并纳入）、`omitted`（已读但有意省略）或 `unread`（未读或未能可靠读取）。`pages` 为该主题核实的 PDF 页序数组；只有无法可靠定位的 `unread` 项可为空。`note` 说明覆盖内容、省略原因或读取障碍，不能用节点数量代替覆盖说明。对主题的局部覆盖应拆分列明。

服务负责根据真实请求和目录附加来源 `source`（范围、页码以及可定位的章/节标识）；Agent 不填写或推测该字段。

## 概念节点

| 字段 | 约定 |
| --- | --- |
| `id` | 非空字符串，图内唯一；边通过它引用节点。延续已有概念时保留 ID。 |
| `label` | 非空短概念名，避免长段落和章节叙述。 |
| `conceptKey` | 非空、图内唯一的课程内概念标识，跨次生成复用，例如 `ml.svm.soft-margin`。与页码、结果 ID 无关；含义或关键假设不同的变体使用不同标识。 |
| `type` | 非空语义角色，例如“模型”“任务”“方法”“概念”“性质”“条件”；按教材命名，没有固定全局分类表。 |
| `aliases` | 可选数组，各项为非空字符串，保存缩写或同义称呼；不把不同模型的名称当成别名。 |
| `description` | 可选的定义、解释或公式，支持 Markdown/LaTeX。 |
| `page` | 可选的、已核实的 PDF 页序；用于查看概念正文。 |

任务提供的已有概念目录用于查找匹配的 `conceptKey`、名称及别名。缺少匹配时才新建；相同名称不自动证明相同含义。图内合并同义节点后更新全部边端点。

## 有向关系

| 字段 | 约定 |
| --- | --- |
| `id` | 非空字符串，关系之间唯一。 |
| `source`、`target` | 已有的两个不同节点 ID。 |
| `label` | 非空、简短的纯文本关系词；不放 Markdown、LaTeX 或证据段落。 |
| `basis` | `"textbook"` 表示正文支持；`"inference"` 仅用于用户明确要求的推断。 |
| `conditions` | 可选文字；关系依赖假设或限制时必须填写，使关系单独阅读也不失真。 |
| `evidence` | 非空数组，每项含 `page`、`summary`，可选 `location`。 |

`evidence.page` 指向真正支持该关系的 PDF 页序，`summary` 是正文依据的非空简短转述，`location` 可写公式号、正文小标题或段落位置。跨页论证可用多项证据。推断关系的证据只陈述教材提供的前提，不能把推断结果写成教材原话；在 `conditions` 中说明推断的限制。

全部页码为 `1` 至本次真实 PDF 总页数的整数，不使用印刷页码。每条关系都要有依据，不能直接复制两端节点的页码。多父节点、有向环、独立子网均可；不允许自环或重复的 `(source, target, label)`。同一有向概念对的不同关系分别保留；同义关系先统一关系词后去重。反向关系有独立含义和证据时可另建。

## 格式示例

下面只演示字段连接方式，不是可直接复制的教材结论；生成时必须以本次教材和指定 ID 替换全部内容与页码。

```json
{
  "id": "本次指定的结果ID",
  "title": "支持向量机模型 · 知识图谱",
  "kind": "knowledge-graph",
  "schemaVersion": 2,
  "detailLevel": "overview",
  "coverage": {
    "summary": "概览呈现两种模型的扩展关系；已读的推导细节未展开。",
    "items": [
      { "title": "两种支持向量机模型", "pages": [11, 12], "status": "covered", "note": "保留模型区分及扩展关系。" },
      { "title": "目标函数与约束的推导细节", "pages": [11, 12], "status": "omitted", "note": "本次概览不展开逐步推导。" }
    ]
  },
  "nodes": [
    { "id": "hard", "label": "硬边距支持向量机", "conceptKey": "ml.svm.hard-margin", "type": "模型", "page": 11 },
    { "id": "soft", "label": "软边距支持向量机", "conceptKey": "ml.svm.soft-margin", "type": "模型", "aliases": ["软边距 SVM"], "page": 12 }
  ],
  "edges": [
    {
      "id": "soft-extends-hard",
      "source": "soft",
      "target": "hard",
      "label": "推广自",
      "basis": "textbook",
      "conditions": "通过松弛变量和相应惩罚允许样本违反原边距约束。",
      "evidence": [
        { "page": 12, "summary": "正文为处理线性不可分情形，在原模型中引入松弛变量及惩罚项。", "location": "软边距模型及其前后正文" }
      ]
    }
  ]
}
```

不输出坐标、颜色、布局速度或个人补充字段。将 JSON 写到任务指定的待校验路径，不自行写入另一个 `result-*` 文件。应用在正式保存前按真实 PDF 总页数强制校验 v2；结构通过并不证明关系正确，语义复核仍需依据教材正文。
