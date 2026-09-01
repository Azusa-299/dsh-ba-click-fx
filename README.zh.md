# dsh-ba-click-fx

将《蔚蓝档案》(Blue Archive) 风格的**点击特效 + 光标拖尾**封装为 DeepSeek Harness **web 客户端插件**。

本包把开源库 [`ba-click-fx` v1.3.1](https://github.com/CialloKing/ba-click-fx)（逐字节照搬，`vendor/ba-click-fx.js`，零运行时依赖的 ESM 包）通过标准客户端模块系统挂载进 DSH 的 Web GUI。点击、拖拽或移动指针即可看到游戏风格的溶解圆环、中心光盘、点击碎片与光标拖尾。

特效完全运行在浏览器侧：**浏览器半侧**（`src/client/index.js` → `lib/client.js`）负责全部视觉；**Host 半侧**（`src/index.js` → `lib/index.js`）只是空实现入口，让 Host Loader 激活插件行并下发客户端 bundle。

## 包结构

```
dsh-ba-click-fx/
├── package.json            # dsh.bundle + dsh.client (web) 声明
├── cordis.patch.yml        # 插入插件行
├── vendor/ba-click-fx.js   # 内联的 ba-click-fx v1.3.1 dist 构建产物
├── src/
│   ├── index.js            # Host 半侧（空实现）
│   └── client/index.js     # 浏览器半侧：特效 + 配置窗口 + i18n/主题
├── scripts/build.mjs       # 从 src/ + vendor/ 组装 lib/
└── lib/                    # 预构建产物（可直接安装）
    ├── index.js
    └── client.js           # 懒加载 CJS factory：window.__ModuleLoader__.load({id, factory})
```

## 工作原理

1. Host Loader 导入 node 半侧，为行 `{ id: ba-click-fx, name: dsh-ba-click-fx }` 激活 fiber。
2. client-modules 扫描启用的 `dsh.client` 条目，解析 `exports["./client"]` → `lib/client.js`，哈希后写入启动图，并在 `/plugins` 下提供服务。
3. 浏览器中 `apply(ctx, config)` 挂载 `new BAClickFX(...)`（全屏覆盖层 canvas）。
4. `ctx.effect(...)` 在 HMR 重载 / profile 卸载时清理全部内容。

## 安装

```sh
dsh plugin --profile web add ./dsh-ba-click-fx
# 重启 web profile 以加载新客户端 bundle：
dsh --profile web
```

卸载：`dsh plugin --profile web remove dsh-ba-click-fx`。

无 `dsh` CLI？把本包（或 `pnpm pack` 的 tarball）放入 profile，在 `dependencies` 加入 `"dsh-ba-click-fx": "link:./dsh-ba-click-fx"`、在 `dsh.profile.bundles` 追加 `"dsh-ba-click-fx"`，运行 `pnpm install`，再重启。

## 配置窗口

页面右下角出现一个 **⚙** 齿轮按钮：

- **左键点击**开合面板；**右键按住拖动**移动位置（位置持久化到 `localStorage`）；
- 修改**即时生效**（`fx.setThemeColor()` / `fx.updateConfig()`），并持久化到 `localStorage`（`dsh-ba-click-fx-config`）；
- **主题适配**（用 DSH `--dsw-alias-*` 令牌）与 **i18n 适配**（读取 `<html lang>` 检测 DSH 语言，自动切换 中文 / English）。

| 控件 | 范围 | 默认值 |
|---|---|---|
| 主题颜色 | 取色器 | `#4ca7ff` |
| 全局缩放 | `0.50 – 3.00` | `1.00` |
| 不透明度 | `0.00 – 1.00` | `1.00` |
| 点击特效 | 开 / 关 | 开 |
| 光标拖尾 | 开 / 关 | 开 |
| 拖尾始终显示 | 开 / 关 | 开 |
| 最大 DPR | `1.0 – 2.0` | `1.0` |
| 点击速度 | `0.50 – 2.00×` | `1.00×` |
| 拖尾速度 | `0.50 – 2.00×` | `1.00×` |
| 光晕（点击 + 拖尾辉光） | `0.00 – 4.00` | `1.00` |

## 构建时默认值

默认：蔚蓝档案蓝（`#4ca7ff`）、完整 WebGL2、点击与拖尾开启。要改随包默认值（后端、主题颜色模式、触摸行为等），编辑 `src/client/index.js` 中的 `DEFAULT_CONFIG`，运行 `npm run build`（重写 `lib/client.js` 及 map），再重启。

## 说明

- 特效以覆盖层追加，不影响页面布局。
- 零外部运行时依赖。
- `vendor/ba-click-fx.js` 版权归 ba-click-fx 作者所有（MIT）；详见上游 `LICENSE` / `THIRD_PARTY_NOTICES.md`。
