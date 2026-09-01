# dsh-ba-click-fx

将《蔚蓝档案》(Blue Archive) 风格的**点击特效与光标拖尾**封装为 DeepSeek Harness **web 客户端插件**。

本包把开源库 [`ba-click-fx` v1.3.1](https://github.com/CialloKing/ba-click-fx)（逐字节照搬，见 `vendor/ba-click-fx.js`，一个零运行时依赖的 ESM 包）通过标准的客户端模块系统挂载进 DSH 的 Web GUI。在界面中点击、拖拽或移动指针，即可看到游戏风格的溶解圆环、中心光盘、点击碎片与光标拖尾。

点击特效完全运行在浏览器侧（DOM / canvas / 指针事件），因此：

- **浏览器半侧**（`src/client/index.js` → `lib/client.js`）负责全部视觉渲染；
- **Host 半侧**（`src/index.js` → `lib/index.js`）只是一个空实现入口，用于让 Host Loader 激活插件行并下发客户端 bundle。

## 包结构

```
dsh-ba-click-fx/
├── package.json           # dsh.bundle (cordis.patch.yml) + dsh.client (web) 声明
├── cordis.patch.yml       # 把插件行插入 loader 组合
├── vendor/ba-click-fx.js  # ba-click-fx v1.3.1 dist 构建产物的逐字节副本（"照搬"来源）
├── src/
│   ├── index.js           # Host 半侧（空 apply）
│   └── client/index.js    # 浏览器半侧（挂载 BAClickFX，通过 ctx.effect 卸载清理）
├── scripts/build.mjs      # 从 src/ + vendor/ 组装 lib/ 产物
└── lib/                   # 预构建产物（可直接安装）
    ├── index.js
    └── client.js          # 懒加载 CJS factory：window.__ModuleLoader__.load({id, factory})
```

`lib/client.js` 是 DSH 客户端模块系统在 `/plugins/dsh-ba-click-fx/client.js` 服务的产物格式：一个通过 `window.__ModuleLoader__.load({ id, factory })` 注册的闭包工厂。内联的 ESM 包末尾的 `export { ... }` 被去掉，使其符号（`BAClickFX`、`createConfig` 等）保持在闭包作用域内；插件体再通过 CJS `exports` 重新导出，并加入 `apply(ctx, config)` 入口。

## 工作原理

1. Host Loader 导入本包的 node 半侧，为行 `{ id: ba-click-fx, name: dsh-ba-click-fx }` 激活一个 fiber。
2. client-modules 的 Host 半侧扫描启用中的 Loader 条目，寻找 `dsh.client`，解析 `exports["./client"]` → `lib/client.js`，将其哈希后写入启动图，并在 `/plugins` 下提供服务。
3. 浏览器中 `apply(ctx, config)` 调用 `new BAClickFX(...)`，自动挂载一个全屏覆盖层 canvas 并监听 DOM 指针事件。
4. `ctx.effect(...)` 注册清理逻辑，保证 HMR 重载与 profile 卸载时能移除覆盖层及其监听器。

## 安装进 profile

在包含本包的目录下执行（`./dsh-ba-click-fx` 可被解析到）：

```sh
dsh plugin --profile web add ./dsh-ba-click-fx
```

`dsh plugin add` 会把依赖装进 `$DSH_HOME/profiles/web`（本包声明了 `dsh.bundle`，因此也会被追加到 `dsh.profile.bundles`），随后**重启 `web` profile** 让 Host 加载新的客户端 bundle：

```sh
# 先停止正在运行的 web 实例，然后：
dsh --profile web
```

卸载：

```sh
dsh plugin --profile web remove dsh-ba-click-fx
```

### 手动安装（无 `dsh` CLI）

1. 把本包（或用 `pnpm pack` 生成的 tarball）放入 profile 目录树。
2. 在 `$DSH_HOME/profiles/web/package.json` 的 `dependencies` 中加入，例如
   `"dsh-ba-click-fx": "link:./dsh-ba-click-fx"`，并把 `"dsh-ba-click-fx"` 追加到 `dsh.profile.bundles`。
3. 在 `$DSH_HOME/profiles/web` 下运行 `pnpm install`。
4. 重启 `web` profile。

## 自定义特效

默认主题色为蔚蓝档案蓝（`#4ca7ff`），采用完整 WebGL2 管线，点击与拖尾均开启。修改 `src/client/index.js` 中的 `DEFAULT_CONFIG`，然后重新构建：

```sh
npm run build
```

重新构建会重写 `lib/client.js`（以及它的 source map）。重启 web profile 以加载新的 bundle（`web` profile 是构建安装，而不是 `dev:web` 监听器）。

## 说明

- 特效以覆盖层形式追加，不会影响页面布局。
- 无外部运行时依赖，内联包完全自包含。
- `vendor/ba-click-fx.js` 版权归 ba-click-fx 作者所有（MIT）；详见上游 `LICENSE` / `THIRD_PARTY_NOTICES.md`。
