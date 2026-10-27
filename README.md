# 写

把小说在手机上演出来，再让 AI 写下来。

一个单页应用，装到手机主屏就能用。没有账号，没有服务器——故事存在你的浏览器里，只有生成时的提示词会发给你自己填的那个接口。

## 怎么跑起来

### 本地看一眼

```powershell
cd E:\123\story-forge
python -m http.server 8123
```

浏览器打开 <http://127.0.0.1:8123>。

> 必须用 http/https 打开。直接双击 `index.html` 走 `file://` 的话，ES module 会被浏览器拦掉，页面上什么都不会显示。

### 装到手机上（推荐）

推到 GitHub，开 Pages，手机扫码打开，Safari 用「添加到主屏幕」、Chrome 用「安装应用」。之后就有独立图标、全屏、离线可用（除了生成那一步）。

```powershell
cd E:\123\story-forge
git init
git add .
git commit -m "story-forge"
git branch -M main
git remote add origin https://github.com/htedot/xie.git
git push -u origin main
```

然后仓库 Settings → Pages → Source 选 `main` / 根目录，拿到 `https://htedot.github.io/xie/`。

## 用起来

1. **设置**：填接口地址和密钥。默认 `https://api.deepseek.com/v1` + `deepseek-chat`。填完点「测试连接」。
2. **故事**：三块——文风、人物、大纲。想改随时改，改完下一拍立刻生效。
3. **演**：点「开始第一场」。每拍 AI 写一段，给你三个选项，加第四个「自己写」。
4. **稿**：全部拍串成一篇，导出 txt 或 json。

## 关于密钥

密钥只存在你手机的 `localStorage` 里，不上传到任何地方。但它是明文存在浏览器里的——手机别借人。

生成时你的提示词（文风、人物、大纲、前几段正文）会发给你填的那个接口。这是唯一离开这台设备的东西。

## 为什么能跨域直连

浏览器直接调接口需要对方允许 CORS。实测（2026-10-28）：

| 服务 | 浏览器直连 |
|---|---|
| DeepSeek | ✅ |
| Moonshot / Kimi | ✅ |
| DashScope（阿里） | ✅ |
| SiliconFlow | ✅ |
| 智谱 GLM | ❌ 没有 CORS 头 |

只要对方兼容 OpenAI 的 `/chat/completions` 格式且放行 CORS，把接口地址换掉就能用。

## 它会长到哪

现在已经能演，但只有三块地基是手写的。接下来最该做的是：

- **记忆**：每 6 拍把前面的压成一段前情摘要。已经做了，但阈值是写死的。
- **人物语气**：现在是靠「人物」那块里你自己写的描述。如果再拆成每人几个固定字段（句长、生气时怎么变、什么情况下不说话），人物会分得更开。
- **多角色视角**：现在只演「我」。换成别的角色要重开一部。
- **丢了怎么办**：只有导出。浏览器缓存清掉就没了，记得导出。

## 文件

```
index.html            壳
style.css             样式
js/app.js             界面与状态
js/api.js             接口适配（OpenAI 兼容）
js/prompt.js          提示词构造与解析（质量都在这里）
js/store.js           IndexedDB + localStorage
sw.js                 离线缓存
manifest.webmanifest  PWA 声明
```
