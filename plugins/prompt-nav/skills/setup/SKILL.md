---
description: 为 Claude 桌面版安装提问导航条（像 ChatGPT 对话旁边那条可以快速跳回之前提问的刻度条），并创建用来打开 Claude 的启动器。
disable-model-invocation: true
---

# 安装 Claude Prompt Nav

用户想让 Claude 桌面版的对话旁边出现一条提问导航条：每条提问一个刻度，鼠标停在刻度上会放大刻度并预览那条提问和回复的开头，点击跳回去，⌃⌥↑ / ⌃⌥↓ 逐条切换。

Claude Code 插件本身改不了桌面版的界面，所以这里是把导航脚本和一个启动器装到用户电脑上：启动器用仅限本机（127.0.0.1）的调试端口打开 Claude，并把脚本注入 Claude 的窗口。

按顺序做：

1. 运行 `node --version`。需要 v22 或更新。没有 Node 或版本太旧时，告诉用户先安装 Node.js 22+（macOS 可以 `brew install node`），然后停下。
2. 运行安装命令：

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/claude-nav.mjs" install
   ```

3. 用用户使用的语言转述结果，并说明接下来怎么做：
   - macOS：以后用 `~/Applications/Claude Prompt Nav.app` 打开 Claude（可以把它拖到 Dock，替换原来的 Claude 图标）。如果 Claude 已经以普通方式开着，启动器会先让它退出再以导航模式重新打开，所以先等正在运行的任务结束。
   - Windows：先从托盘完全退出 Claude，再双击桌面上的 `Claude Prompt Nav.cmd`。
   - 如果打开一段对话后没有出现导航条，在 Claude 窗口里按 ⌃⌥P（Windows 上是 Ctrl+Alt+P），先点一条自己的提问，再点一条 Claude 的回复，它会记住这个界面的结构。
   - 调试端口只监听本机，但 Claude 以导航模式运行期间，本机其他程序也能通过它控制 Claude 窗口。
   - 卸载：`node ~/.claude-prompt-nav/bin/claude-nav.mjs uninstall`。

不要运行 `start`、`--restart`，也不要做任何会退出 Claude 的操作：如果这个会话本身就跑在 Claude 桌面版里，退出 Claude 会把这个会话一起结束。让用户自己用启动器重新打开 Claude。
