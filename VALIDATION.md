# 1.1.0 验证记录

日期：2026-10-27

## 自动化验证

`npm test`：31 项通过（13 项 JavaScript、18 项 Python）。

- JS：指令与范围、URL 限定、Classic 多栏目解析、排除栏目、嵌套目录、条目标题、外链、纯文字、重复附件、循环引用、名称冲突、局部失败、登录页与完整工作流。
- Python：手工旧文件、改名和编辑后的历史识别、不覆盖、幂等归档、路径越界、符号链接、登录 HTML、空文件、损坏记录、大小不符，以及累计目录、链接、备份和局部扫描合并。
- 工作流使用真实 Python Native Messaging 子进程，模拟 Chrome 下载 API、BB 页面和附件。合成 W7 共 16 项，人工确认 1 项后跳过，其余 15 项归档；多候选文件须明确选择；改名后仍跳过；新增附件只补一项；网络失败后可重试；并发上限为 3；没有创建抓取标签页；外链未被请求。
- 安装器在 `/private/tmp/bb-installer-v11-check` 的独立 home 验证通过。
- 模拟界面验证了结构展开、多候选核实、按钮解除禁用，以及修改课号后必须重新查找课程的提示与按钮限制。`dist/preview-v1.1.png` 是模拟数据。

## 本机真实 Chrome 验证

- 确认旧助手没有活动下载后，将 1.1.0 安装到既有 Application Support 目录；Chrome 扩展管理页重载后显示 1.1.0。
- 真实面板显示“本地助手已连接”；该显示要求主机 ping 返回 1.1.0。
- 在已登录的 Chrome 打开 MAT1001 后，助手查找得到 `2310-MAT1001-L01: Calculus I`。
- 使用此前用户选择的“BB助手-测试”保存位置，仅运行扫描与本地预览：识别 **6 个栏目、52 个唯一附件、8 条教师链接**，没有扫描警告。
- 栏目为 Course Information、Lecture Notes、Assignments、Quiz Scopes、Midterm、Final Exam；Announcements、Discussions、Groups、Tools、Help 按规则排除。
- 展开真实结构验证 Lecture Notes / Week1-1, Lecture 1 对应附件；Week 5 Newton's Method 下有 Desmos、GeoGebra 链接；纯文字作业与 Quiz Scopes 条目显示“只记录标题”；Midterm 单条目保留多个附件。
- `dist/live-mat1001-preview-v1.1.png` 是真实扫描预览。**未点击开始下载，未将这 52 项下载到测试目录。**

## 验证边界与后续复核

- 本轮真实验证覆盖安装、主机连接、登录态、课程识别、多栏目扫描、附件元数据和本地预览。实际归档、视频传输和 Markdown 更新主要由自动化工作流验证，本轮未执行真实全课下载。
- 本校 My Courses 使用动态 iframe 和特殊课程链接；未打开的课程可能无法直接由课号发现。首次找不到时，先在同一 Chrome 中打开课程，再查找；扫描和下载开始后无需停留在该页。
- 当前真实预览的保存位置为测试目录。正式使用时先选择目标课程根目录、重新扫描，再确认开始。
- 测试通过不代表支持所有 BB 页面。Ultra、脚本动态内容和非 bbcswebdav 下载接口见排错指南中的边界说明。
