# 可复用教材内容

完整解析的每一页保存为本课程 `outputs/.build/textbook-content/page-N.json`，N 是 PDF 页序。它是可以重新校对更新的解析结果；再次处理时只更新本次页，保留其他页。不要改原始 PDF、阅读记录或用户笔记。

每页对象包含 `page`、`blocks`，可附 `printedPage`。每个内容块包括：

| 字段 | 内容 |
| --- | --- |
| `type` | 正文实际出现的 paragraph、definition、theorem、formula、example、exercise、figure 等 |
| `title` | 简短标题，保留教材原有编号 |
| `content` | 完整含义、成立条件、必要符号和正文；支持 Markdown/LaTeX |
| `note` | 可选，勘误或待核对说明 |

例题保留题目和教材已有的解答；教材没有的解答不在解析阶段补写。跨页定理或例题在各页保留实际内容，并在 note 中说明续接位置。图像使用当前课程的实际文件路径，区分原页预览与独立插图。

选文或不完整页面保存到本次输出子目录的 `selection-content.json`，包含 `scope: "selection"` 和 `pages` 数组（元素为上述页对象），明确范围。它不能覆盖 `page-N.json`，以免后续 Skill 把选段误当整页。

讲解、出题等任务先按页取用这些内容，缺页再读原 PDF。解析内容用于减少重复阅读；遇到矛盾、缺失条件或待核对标记，回看原页，不将解析结果当成无需核对的教材原文。
