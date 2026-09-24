---
description: 在 Claude 桌面版里用上提问导航条（像 ChatGPT 对话旁那条可以快速跳回之前提问的刻度条）：把导航脚本复制到剪贴板，并说明怎样用开发者模式运行它。
disable-model-invocation: true
---

# 在 Claude 桌面版里使用 Claude Prompt Nav

用户想让 Claude 桌面版的对话旁出现一条提问导航条：每条提问一个刻度，鼠标停在刻度上会放大刻度并预览那条提问和回复的开头，点击跳回去，⌃⌥↑ / ⌃⌥↓ 逐条切换。

背景：Claude Code 插件改不了桌面版的界面，而新版 Claude 桌面版只要启动参数里有调试或网络相关的开关就会拒绝启动，所以没有自动注入的办法。能用的是 Claude 自带的开发者模式：在 DevTools 里运行导航脚本，每次打开 Claude 运行一次。

按顺序做：

1. 把脚本复制到剪贴板。macOS 运行：

   ```
   pbcopy < "${CLAUDE_PLUGIN_ROOT}/prompt-nav.user.js"
   ```

   Windows 用 `clip.exe < "${CLAUDE_PLUGIN_ROOT}/prompt-nav.user.js"`。复制失败的话，把文件路径告诉用户，让他们自己打开复制。

2. 用用户使用的语言说明接下来的步骤：
   - 菜单栏 **Help → Troubleshooting → Enable Developer Mode**，然后重启 Claude。菜单里没有这一项时，在 `~/Library/Application Support/Claude/developer_settings.json`（Windows：`%APPDATA%\Claude\developer_settings.json`）写入 `{"allowDevTools": true}` 再重启。
   - 按 `⌘⌥⇧I`（Windows：`Ctrl+Shift+Alt+I`）打开 DevTools。如果开了两个窗口，在 Console 里输入 `location.href`，显示 `claude.ai` 的那个是对话界面。
   - 在 **Sources → Snippets** 里新建片段，粘贴脚本，按 `⌘S` 保存。DevTools 提示不允许粘贴时，先按提示输入 `allow pasting`。
   - 以后每次打开 Claude：打开 DevTools，按 `⌘P`，输入 `!` 选择这个片段，回车运行。
   - 打开对话后如果没有出现刻度条，按 ⌃⌥P（Windows：Ctrl+Alt+P），先点一条自己的提问，再点一条 Claude 的回复，它会记住这个界面的结构。

不要给 Claude 加启动参数、修改 Claude 的安装文件，或者尝试绕过它拒绝调试开关的检查：那是 Claude 有意设置的安全保护。
