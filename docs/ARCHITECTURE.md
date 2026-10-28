# 架构与数据约定

## 目标与不变量

1. 用户选择一个课程根目录；只在该目录建立教学资料结构。
2. “在哪里展示”与“是不是同一个附件”分别判断。结构节点有路径，附件身份是 BB 资源 ID。
3. 扫描预览不下载、不生成课程 Markdown。用户确认后才写记录、启动下载。
4. 普通本地文件不覆盖、不移动。重新下载另存；用户编辑过的生成记录先备份。
5. 外部网址只记录文本；外部网页不是网络抓取目标。
6. 不因局部扫描、失败或老师删除内容而清空累计目录及本地文件。

## 模块边界

| 模块 | 责任 | 不负责 |
|---|---|---|
| `core.mjs` | 指令、URL 分类、资源身份、路径组件、排除栏目 | 网络请求、读写文件 |
| `parser.mjs` | DOMParser 静态解析：左栏入口、内容条目、附件、链接、框架 | 执行网页脚本、决定下载状态 |
| `scanner.mjs` | 多入口递归、范围过滤、循环保护、节点树、附件去重 | Chrome API、文件归档 |
| `worker.mjs` | 登录态请求、元数据、本地消息、持久化队列、下载事件 | HTML DOM、直接文件系统操作 |
| `offscreen.mjs` | 给 worker 提供 DOMParser | 网络下载和后台队列 |
| `app.mjs` | 用户指令、预览、人工核实、进度与错误 | 直接访问 BB 或本地文件 |
| `host.py` | 授权目录、递归本地查重、下载校验和归档、历史 | 网络请求、提取浏览器 Cookie |
| `bb_records.py` | 累计目录、Markdown、用户编辑备份 | 下载文件、移动用户旧资料 |

## 扫描流程

1. 从当前 BB 标签页读取课程标题、课程链接和左栏内容入口；课程列表是备用来源。该步骤只读 DOM，不翻页。
2. 选择课程和本地目录后，后台请求第一个资料入口；若是课程 frameset，则追踪同源 Blackboard frame 寻找菜单。
3. 从实际菜单提取该课的资料栏目。栏目名不再采用 Content 白名单。只支持 `listContent.jsp` 及明确带 `content_id` 的非工具 `launchLink.jsp`；Home Page 仪表盘及工具入口不纳入。
4. 排除五个明确的栏目名称；大小写不敏感，首尾空格忽略。改名成其他词的栏目不会靠英文猜测自动排除，但仍受内容接口类型限制。
5. 递归资料文件夹。每个内容条目生成一个结构节点，原有文件夹条目只占一层，不额外套重复目录。
6. `files` 按资源 ID 合并，`locations` 保留各处出现；`nodes` 保留所有栏目、文件夹、条目以及链接。
7. HEAD 请求确认原文件名和大小；最多同时 4 个元数据请求。
8. 本地助手递归扫描，读取下载历史，返回 `new / review / history`，形成预览。

网络请求按规范化 URL 缓存；目录遍历按当前祖先链检测循环，防止错误丢弃另一个栏目中的同一资料目录。上限：1500 个唯一页面、3000 次目录访问、25 层扫描目录。达到限制会报错或警告，不宣称完整成功。

W7 / Week 7 / 第7周过滤同时支持真实文件夹和条目标题；不凭文件内容推断周数。只扫某周时，累计索引保留其他范围的旧节点，并注明未重新核实。

## 数据与身份

- 附件 ID：`courseId:rid/xid`，缺少资源号时退回 URL pathname。名称改变不改变已知资源 ID；不同 ID 不因同名合并。
- 节点 ID：课程 + 栏目 URL + 内容行 ID 链。BB 无行 ID 的简化主题退回行序号；因此这种非标准页面调整顺序后，目录身份稳定性有限。
- 节点：`id, path[], title, kind(area/folder/item), url, fileIds[], links[]`。
- 附件：`id, url, name, folders[], courseId, locations[], local, choice, status`。
- 第一处引用决定新附件首次保存路径；其他位置从历史获得同一个实际文件地址。
- 相同标题经路径清理后发生同级冲突时附稳定 ID 摘要。新增冲突可能改变“计划路径”，已有文件仍保留原位置并由历史引用。

路径清理在 JS 和 Python 两侧分别执行，不能以浏览器端已经清理为理由省略 host 校验。

## 持久化文件

| 位置 | 用途 |
|---|---|
| Chrome `storage.local.state` | 当前课程、范围、目录映射、扫描结构、队列、最近 80 条运行记录 |
| 应用目录 `config.json` | 授权根目录、待归档 token、归档回执 |
| 课程 `.bb-downloads/history.json` | 资源 ID → 原保存位置、时间、大小、SHA-256、人工核实标记 |
| 课程 `.bb-downloads/catalog.json` | 累计节点、附件摘要、课程最近扫描信息、生成 Markdown 的路径及最后写入哈希 |

历史记录证明“曾经下载/人工确认”。路径存在检查不等于内容仍是原版；路径不存在也不能判断删除还是移动。工具不自动搜索用户重命名后的内容。

每次生成目录时合并本次节点，保留历史节点。索引中的“此前扫描”不是老师删除的判断。已退出扫描范围的旧 `链接.md` 不会被删除；本次读到同一条目且链接变空时，会更新为“未发现链接”。

## 下载与生成记录状态

主流程：`idle → discovering → choose → scanning → preview → confirming → downloading → complete`。
下载中可以 `paused → downloading`。单文件：`queued → preparing → starting → active → filing → done`，异常到 `failed`。跳过为 `skipped`。

`confirming` 阶段保存人工核实、生成初始目录；成功后才启动附件队列。任务结束再次更新目录中的真实附件状态。Markdown 更新失败独立记录在 `recordsError`，不撤销已归档文件；“重试更新目录记录”只调用记录接口。

worker 的下载事件和定时恢复核对 Chrome 的实际下载状态。Chrome 关闭或扩展重载会中断当前执行；不要在活动下载中升级。扫描不续传；中断后重新扫描。Native Messaging 的 `connectNative` 在连接期间维持 worker 存活。

## Native Messaging 协议

JSON 消息前有 4 字节本机字节序长度，带 `requestId`。响应为 `{requestId, ok, result}` 或 `{requestId, ok:false, error}`。

| action | 输入重点 | 结果 |
|---|---|---|
| `ping` | 无 | 助手版本、已选择目录 |
| `choose_root` | 可选旧 rootId | 系统目录选择器结果或 cancelled |
| `preview` | rootId、items | 本地候选、历史状态、本地文件总数 |
| `remember` | rootId、items、可选 candidatePath | 人工确认数量 |
| `prepare` | rootId、item | token、Chrome 暂存相对路径 |
| `finalize` | token、已完成下载路径 | 校验归档结果、真实保存路径 |
| `write_records` | rootId、course、scope、scanId、scannedAt、nodes、items、warnings | indexPath、输出数量、用户编辑备份路径 |

单条输入最多 8 MB，响应控制在 900 KB；超限应缩小课程范围，不通过消息传递视频内容。

## 生成 Markdown 的覆盖规则

`catalog.documents` 为逻辑名称记录真实输出路径及 SHA-256。

- 初次生成遇到未登记同名文件：选择另一个 `（BB助手）` 名称，不覆盖。
- 已登记且文件未被用户改动：原子替换。
- 已登记但当前哈希不同：先独立落盘用户修改备份，然后原子替换。
- 新旧内容相同：不改写。
- 不信任 Markdown 中的 HTML 或标题语法；标题转义，URL 编码。仅允许 HTTP(S)，拒绝带账号密码的链接。

文件归档、Markdown、catalog 分别原子写入，不是跨文件事务。中途退出可能留下部分已生成文档；再次扫描/确认可恢复，不清理用户内容。归档回执提供同 token 的幂等重试。

## 测试策略

纯函数测试解析与扫描；Python 临时目录测试文件保护。完整工作流使用真实 Python Native Messaging 子进程、模拟 Chrome API 和合成 BB 附件，覆盖扫描、人工核实、下载、归档、改名、再次扫描、新增及重试。

真实 BB 验证与模拟测试分开记录在 `VALIDATION.md`。测试通过不等于所有学校主题与所有附件接口都已适配。
