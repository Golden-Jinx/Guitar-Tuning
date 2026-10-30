# 构建

Windows x64，Node.js 24，pnpm 11.25.0。

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm pack:win
pnpm smoke
node scripts/source-archive.mjs
pnpm checksums
```

输出在 `release/`。打包后的程序不需要 Node.js 或浏览器，可离线运行。

GitHub Actions 会检查并构建 Windows 版本，首次推送 `main` 或推送新版本标签时发布 Release。已有版本不会覆盖；更新前修改 `package.json` 的版本号。

设置保存在 `%APPDATA%\Stringroom`。安装版和免安装版共用配置，与网页版分开；JSON 备份只迁移自定义调弦。

当前没有代码签名和自动更新。测试使用模拟音频设备，实际拾音还取决于麦克风或声卡。

项目尚未选择源码再使用许可（`UNLICENSED`）。Electron 和 Chromium 的许可声明随运行环境分发。
