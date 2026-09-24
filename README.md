# Claude Prompt Nav

给 Claude 加上 ChatGPT 那样的「提问导航条」：对话左侧每条提问一个刻度，鼠标停在刻度上就能预览那条提问和回复的开头，点一下就跳回去。支持 Claude 桌面版（通过开发者模式）和浏览器里的 claude.ai（油猴脚本）。

![演示（测试用的模拟页面）](docs/screenshot.png)

- **刻度条**：一条提问一个刻度，当前读到的那条会高亮（橙色）
- **悬停预览**：鼠标所在的刻度会放大（离得越近越长、越亮），旁边弹出卡片，显示这条提问和 Claude 回复的开头；沿着刻度条上下移动，卡片跟着切换
- **点击跳转**：点刻度或卡片跳到那条提问，跳到的提问会闪一下边框
- **快捷键**：`⌃⌥↑` / `⌃⌥↓`（Windows：`Ctrl+Alt+↑/↓`）跳到上一条 / 下一条提问
- 自动跟随浅色 / 深色主题；新提问会实时出现，切换对话后自动更新
- **识别不到时手动教它一次**：按 `⌃⌥P`，先点一条你的提问，再点一条 Claude 的回复，它会记住这个界面的结构

导航条本体是一个无依赖的脚本：[`plugins/prompt-nav/prompt-nav.user.js`](plugins/prompt-nav/prompt-nav.user.js)。

## 为什么桌面版不能全自动

- Claude Code 插件能提供命令、skill、hook 和 MCP，但改不了桌面版的界面。
- 从外部往桌面版注入脚本也行不通：新版 Claude 桌面版（在 2.7032.0 上确认）只要启动参数里带调试或网络相关的开关，就会拒绝启动（`refusing to start — a debugging or network-override switch is present on the command line`）。这是 Claude 有意设置的安全保护，本项目不会去绕过它。
- 剩下能用的是 Claude 自带的开发者模式：在 DevTools 里运行这个脚本。**每次打开 Claude 需要手动运行一次。**

希望官方直接支持的话，可以给 [anthropics/claude-code#70678](https://github.com/anthropics/claude-code/issues/70678)（在对话里跳到上一条 / 下一条提问）点个 👍。

## 在 Claude 桌面版里用

### 第一次设置

1. **打开开发者模式**：菜单栏 **Help → Troubleshooting → Enable Developer Mode**，然后重启 Claude。
   菜单里没有这一项的话，在终端运行下面这行再重启 Claude（Windows 写到 `%APPDATA%\Claude\developer_settings.json`）：
   ```bash
   echo '{"allowDevTools": true}' > ~/Library/Application\ Support/Claude/developer_settings.json
   ```
2. **复制脚本**：在终端运行（macOS）：
   ```bash
   curl -fsSL https://raw.githubusercontent.com/QKWOM/Plugin/main/plugins/prompt-nav/prompt-nav.user.js | pbcopy
   ```
   也可以直接打开[脚本的 raw 链接](https://raw.githubusercontent.com/QKWOM/Plugin/main/plugins/prompt-nav/prompt-nav.user.js)，全选复制。
3. **打开 DevTools**：在 Claude 里按 `⌘⌥⇧I`（Windows：`Ctrl+Shift+Alt+I`）。如果开了两个窗口，在 Console 里输入 `location.href` 回车，显示 `claude.ai` 的那个才是对话界面。
4. **存成片段**：在 **Sources → Snippets** 里点 **+ New snippet**，命名为 `prompt-nav`，粘贴脚本，按 `⌘S` 保存。DevTools 提示不允许粘贴时，先按提示输入 `allow pasting`。
5. **运行**：在片段编辑器里按 `⌘Enter`（Windows：`Ctrl+Enter`）。DevTools 可以关掉，导航条会一直在，直到 Claude 刷新页面或退出。

### 以后每次打开 Claude

打开 DevTools，按 `⌘P`，输入 `!prompt-nav`，回车。

### 更新

把片段内容换成最新的脚本，再运行一次，新版本会自动替换正在运行的旧版本。

### 用 Claude Code 插件代劳（可选）

在 Claude Code 里依次运行下面三条。`/prompt-nav:setup` 会把脚本复制到剪贴板，并说明上面的步骤。桌面版里如果提示 `/plugin` 不可用，就在终端版 Claude Code（运行 `claude`）里运行。

```
/plugin marketplace add QKWOM/Plugin
/plugin install prompt-nav@qkwom-plugins
/prompt-nav:setup
```

## 在浏览器里用（claude.ai）

装好 [Tampermonkey](https://www.tampermonkey.net/) 后打开
[`prompt-nav.user.js` 的 raw 链接](https://raw.githubusercontent.com/QKWOM/Plugin/HEAD/plugins/prompt-nav/prompt-nav.user.js) 即可安装。之后打开 claude.ai（包括网页版的 Claude Code）都会自动出现导航条。

## 没有出现导航条？

- 页面结构没有公开。脚本内置了 claude.ai 使用的 `data-testid="user-message"` 等写法；如果某个界面（比如桌面版的 Code 标签页）结构不同，打开一段**至少有一问一答**的对话，按 `⌃⌥P`（Windows：`Ctrl+Alt+P`），先点你的一条提问，再点 Claude 的一条回复。识别结果会保存下来，以后自动使用；识别得不对就再按一次 `⌃⌥P` 重新选。
- 在 DevTools 的 Console 里可以用 `claudePromptNav.status()` 查看识别情况，另外还有 `claudePromptNav.setSelector('...')`、`claudePromptNav.resetSelector()`、`claudePromptNav.setSide('right')`（把刻度条放到右边）。

## 卸载

- 桌面版：在 **Sources → Snippets** 里删除 `prompt-nav` 片段；不再需要开发者模式的话，在 Help 菜单里关掉。
- 浏览器：在 Tampermonkey 里删除脚本。
- 插件：在 Claude Code 里运行 `/plugin uninstall prompt-nav@qkwom-plugins`。
- 装过早期版本的启动器：删除 `~/.claude-prompt-nav` 和 `~/Applications/Claude Prompt Nav.app`。

## 已知限制

- 桌面版每次打开 Claude（或页面刷新）后都要手动运行一次片段。
- 没有在真正的 Claude 桌面版上测试过，开发者模式在新版 Claude 里能不能打开 DevTools 也还没确认。测试用 Chromium 加模拟页面覆盖了自动识别、悬停预览、跳转、快捷键、手动选择，以及片段和油猴脚本两种运行方式。
- 如果界面对长对话做了虚拟滚动（只渲染屏幕附近的消息），导航条只能列出当前已经渲染出来的提问。

## 开发

```bash
npm test   # 需要 Playwright 和 Chromium
```
