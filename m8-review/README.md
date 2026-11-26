# M8 乌拉特克复盘室

`dist/` 是静态网站，部署在已有腾讯云站点的 `/m8-review/`。M8 战术训练台继续使用 `/m8/`。部署时只复制 `dist/`。

## 同步和导入

运行 `node m8-review/sync.cjs WCL报告编号`，使用本机授权读取史诗乌拉特克（3492）战斗。设置 `WCL_SERVER_DIR` 指定授权服务目录，设置 `WCL_REPORT_OWNER_ID` 指定允许同步的 WCL 上传者编号。也可在本地 `data/sync-settings.json` 设置 `serverDir` 和 `reportOwnerId`。导出的复盘 JSON 放在 `data/` 下，通过页面的「导入日志」打开。浏览器在本机读取文件，数据不会提交给托管服务器。

「用 WCL 链接定位」可跳到已导入报告的战斗编号和回放位置。若先粘贴链接，页面会在导入对应报告后定位。右侧事件列表默认显示回放点前后 20 秒，手动滚动会暂停跟随。

公开报告可以按部署需要放在 `dist/data/<报告编号>.json`，并在 `dist/data/catalog.json` 中写入对应的 `code` 和 `title`。私有或未列出的公会报告留在 `data/`，由有权限的成员本地导入。

## 离线复盘和公开样例

在仓库根目录运行以下命令。离线文件生成到 `m8-review/data/本周M8复盘.html`，默认打开第一个报告。

```powershell
node m8-review/sync.cjs LbHw4cjQX9AK7DZ1 4 --public-sample
node m8-review/make-offline.cjs 公会报告编号 m8-review/data/LbHw4cjQX9AK7DZ1-4.json
node m8-review/verify-workspace.cjs --fresh
```

## 数据解释

- 站位来自 WCL 资源事件中的坐标。使用同一地图内的相邻样本进行插值，超过 3 秒的采样缺口不连线。
- 可核对到固定场地锚点时，P1、过场和 P3 使用配准后的场地参考图。P2 以坐标网格显示分房站位。场地边界为示意。
- 阶段以 WCL 阶段记录为准。P2 分房依据东西守卫位置和持续的玩家采样。P3 咬击点名来自紧随施法的减益记录。
- 携卵条显示记录到的减益时段，卵簇标记显示有位置的记录。分摊、浪潮和死亡条目提供日志定位，个人责任需结合打法复核。
