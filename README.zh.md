# dsh-ba-click-fx

> 🇬🇧 [English](./README.md)

《蔚蓝档案》风格的点击特效和光标拖尾，装在 DSH 的 Web 界面里。
特效来自 [`ba-click-fx` v1.3.1](https://github.com/CialloKing/ba-click-fx)：点击圆环、碎片，以及跟着指针走的拖尾。

## 安装

```sh
dsh plugin --profile web add ./dsh-ba-click-fx
dsh --profile web
```

卸载：
```sh
dsh plugin --profile web remove dsh-ba-click-fx
```

若没有 `dsh` CLI ，把目录放进 profile，`dependencies` 加 `"dsh-ba-click-fx": "link:./dsh-ba-click-fx"`，`dsh.profile.bundles` 加 `"dsh-ba-click-fx"`，`pnpm install`，重启。

## 设置

设置 → **点击特效**（光环图标）。改完立即生效，存在 `localStorage` 的 `dsh-ba-click-fx-config`。

| 控件 | 范围 | 默认 |
|---|---|---|
| 主题颜色 | 取色器 | `#4ca7ff` |
| 全局缩放 | 0.50–3.00 | 1.00 |
| 不透明度 | 0.00–1.00 | 1.00 |
| 点击特效 | 开/关 | 开 |
| 光标拖尾 | 开/关 | 开 |
| 拖尾始终显示 | 开/关 | 关 |
| 最大 DPR | 1.0–2.0 | 1.0 |
| 点击速度 | 0.50–2.00× | 1.00× |
| 拖尾速度 | 0.50–2.00× | 1.00× |
| 光晕 | 0.00–4.00 | 1.00 |

配色与宿主主题根据（`--dsw-alias-*`），文案与宿主语言根据（中文 / English，其它语言回退英文）。

## 构建

`lib/` 是预构建产物，已入库。改完 `src/` 要跑：

```sh
npm run build   # src/ + vendor/ → lib/
npm test        # 加载产物，检查导出和插槽注册
```

随包的默认值在 `src/client/index.js`：`DEFAULT_CONFIG` 管后端、主题模式、触摸行为，`CONTROL_DEFS` 管面板各控件的范围和默认值。

## 许可

MIT。`vendor/ba-click-fx.js` 版权归 CialloKing，见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
