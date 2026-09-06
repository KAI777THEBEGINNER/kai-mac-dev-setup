---
name: proxy-doctor
description: 自建代理节点（VLESS+REALITY）连不上或疑似被封时的诊断与预警工具。从墙内一键体检，把网络现象翻译成「是被 GFW 封了 ／ 还是 Xray 配置坏了」的明确结论与处方；可装本机自动预警，节点异常时弹 macOS 通知。当节点访问异常、怀疑被封、或想长期监测节点健康时使用。
---

# proxy-doctor｜节点诊断医生

给自建 VLESS + REALITY 节点做「问诊」的工具集。核心思路：**先确诊，再下药**——别一卡就瞎改参数。

数据区固定在 `~/vps-setup/`（`.env`、日志、状态都在这），本 skill 只装逻辑。所有脚本从 `~/vps-setup/.env` 读 `SERVER` ／ `PASSWORD` ／ `SNI`。

---

## 一、故障速查表（按现象直接查）

| 你看到的现象 | 先执行 | 关键判断 | 处方 |
|---|---|---|---|
| 代理软件连不上网／无法翻墙 | `~/vps-setup/proxy-doctor/scripts/probe.sh` | 看 `CONNECT` 状态 | 见第二节分诊表 |
| 菜单栏 `[--]` 或 bwg 流量不刷新 | `python3 ~/workspace/bwg-monitor/src/bwg_monitor.py` | 看终端输出是否报错 | 见第四节「bwg API 问题」 |
| 浏览器访问 Bandwagon 面板要人机验证 | 换 IP（手机热点）再试 | 换 IP 后正常 → 原 IP 被 Cloudflare 标记 | 停 bwg-monitor，等 6–24 小时恢复 |
| SwiftBar 菜单栏看不到 `[xx%]` | `defaults read com.ameba.SwiftBar DisabledPlugins` | 插件是否在禁用列表 | 见第六节 |
| 收到 proxy-doctor 弹窗「节点异常」 | `cat ~/vps-setup/probe-node.log` | 看最近状态是 TIMEOUT/TLSFAIL/REFUSED | 按第二节分诊 |

---

## 二、墙内体检（最常用）

```bash
~/vps-setup/proxy-doctor/scripts/probe.sh
```

在墙内这台 Mac 上一把测节点 443 的「TCP 建连 + TLS 握手」总耗时（CONNECT 延迟），输出一行结论，并追加到 `~/vps-setup/probe-node.log`。

## 三、分诊表：按 probe 结果下药

probe 输出 `CONNECT=<状态> <延迟>`，状态只有四种：

| CONNECT 状态 | 病因 | 处方 |
|---|---|---|
| `OK` | 健康 | 无需处理 |
| `TLSFAIL` | **不是被封**。TCP 通了但 TLS 握手失败：Xray／REALITY 配置坏，或证书链撞 8192 上限 | 跑「服务端深诊」；多半重启 Xray 或换证书链更小的 SNI |
| `TIMEOUT` | 疑似 **IP 被 GFW 封**（也可能机器宕机） | 先去 KiwiVM 后台确认机器在线；在线则基本是被封 → 改参数续命／换 IP |
| `REFUSED` | 机器在线但 443 没监听 | SSH 上去 `systemctl restart xray` |

> 关键：**只有 TIMEOUT 才考虑「被封」；TLSFAIL 是自己配置坏了，改参数没用。** 这一条能省掉大半夜瞎折腾。

## 四、服务端深诊（probe 报 TLSFAIL 时）

```bash
~/vps-setup/proxy-doctor/scripts/server-diag.sh
```

SSH 上节点只读检查：Xray 状态、443 监听、防火墙、**当前 SNI 的证书链 DER 大小 vs REALITY 8192 上限**、error.log 握手报错。证书链超 8192 会握手失败，却长得像「被封」。

## 五、bwg API / Bandwagon 面板问题

### 5.1 判断是不是 Cloudflare 把 IP 标记了

- 现象：浏览器访问 `https://bandwagonhost.com/clientarea.php` 弹出人机验证；或 `bwg_monitor.py` 报 SSL/HTTP 错误
- 验证：换源 IP（手机热点、机场、VPN）再访问，如果正常 → 就是原 IP 信誉被毒化
- 常见诱因：bwg-monitor 频率太高、UA 像 bot、规律整点请求、凌晨也不断请求

### 5.2 修复步骤

1. **立即停用 bwg-monitor**，停止继续毒化 IP：
   ```bash
   defaults write com.ameba.SwiftBar DisabledPlugins -array "bwg-monitor.1m.sh"
   killall SwiftBar; sleep 1; open -a SwiftBar
   ```

2. **临时换马甲访问面板**：手机热点 / 机场 / VPN，仅用于应急确认机器状态。

3. **等 6–24 小时**，让 Cloudflare 把原 IP 信誉降下来。

4. **恢复后若再被拦，继续降频**。修改 `bwg-monitor.1m.sh` 里的延迟：
   ```bash
   # 当前约每小时一次（±3 分钟）
   delay=$((3300 + RANDOM % 601))
   # 改为约每 2 小时一次（±10 分钟）
   delay=$((6900 + RANDOM % 1201))
   ```

5. **长期方案**：如果家里 IP 已被长期标记，把 bwg-monitor 搬到 VPS 上跑，或改成纯手动刷新（点「立即刷新流量」）。

---

## 六、自动预警（装一次，长期盯）

```bash
# 启用：每 30 分钟本机自测，节点「健康↔异常」翻转时弹 macOS 通知
~/vps-setup/proxy-doctor/scripts/watch-install.sh
# 自定义间隔（秒）：例如每 15 分钟
~/vps-setup/proxy-doctor/scripts/watch-install.sh 900
# 关闭
~/vps-setup/proxy-doctor/scripts/watch-uninstall.sh
```

只在状态翻转时通知，持续异常不会反复轰炸；重启电脑后自动恢复。

## 七、历史回放

```bash
cat ~/vps-setup/probe-node.log
```

积累「多久被封一次、被封时是哪种故障」的真实数据。判断节点是否该换、SNI 改动是否有效，靠这个，不靠感觉。

---

## 八、菜单栏（并入 bwg-monitor 展开，不单独做插件）

节点健康**不单独占一个菜单栏图标**，而是内嵌进已有的 `bwg-monitor` 插件展开里——菜单栏只有一个图标（bwg 流量 `[xx%]`），点开展开后下半部分显示节点健康。

- 实现：`bwg-monitor.1m.sh` 调 `probe.sh --section` 取节点健康几行，拼到流量详情下面
- 节点行：🟢 节点健康 ｜ CONNECT 延迟（TCP+TLS 建立总耗时）｜ 异常时 🔴 + 判定
- 节点探测连的是你自己节点 443，与 bandwagon／Cloudflare 无关，凌晨也照常显示
- 与 launchd 预警分工：**launchd 是后台保命**（SwiftBar 没开也盯着、异常弹通知）；**菜单栏是顺手看的仪表盘**（要 SwiftBar 开着）

### SwiftBar 不显示排查

1. 检查插件是否在禁用列表：
   ```bash
   defaults read com.ameba.SwiftBar DisabledPlugins
   ```
2. 清空禁用列表并重启：
   ```bash
   defaults write com.ameba.SwiftBar DisabledPlugins -array
   killall SwiftBar; sleep 1; open -a SwiftBar
   ```
3. 菜单栏太挤：按住 `⌘` 拖动顶部右侧图标，看是否被折叠进 `⋯`。

---

## 九、日志解读

`~/vps-setup/probe-node.log` 每行格式：

```
YYYY-MM-DD HH:MM:SS | SERVER:PORT SNI=xxx | CONNECT=<状态> <延迟> | <判定>
```

- `CONNECT=OK 900ms`：健康，数字是 TCP+TLS 总耗时
- `CONNECT=TIMEOUT -`：大概率 IP 被 GFW 封，或机器宕机
- `CONNECT=TLSFAIL -`：配置问题，别急着改 IP
- `CONNECT=REFUSED -`：Xray 没监听 443

---

## 十、配套修复脚本（治疗，在 `~/vps-setup` 根目录）

- `fix.sh` ／ `fix-key.sh`：重置 REALITY 参数（同 IP 改参数，多数「被封」靠这个续命）
- `repair.sh`：重新生成节点信息与客户端配置
- `generate-node-config.sh`：生成新客户端配置 + 二维码

---

> **已安装为 Claude Code skill**：`~/.pi/agent/skills/proxy-doctor/` 会被自动加载。源目录仍在 `~/vps-setup/proxy-doctor/`，后续更新建议先改源目录，再重新复制到 skills。

## 十一、更新 skill

源目录在 `~/vps-setup/proxy-doctor/`，安装目录在 `~/.pi/agent/skills/proxy-doctor/`。改完源目录后，执行下面命令同步到 skills：

```bash
rm -rf ~/.pi/agent/skills/proxy-doctor
cp -R ~/vps-setup/proxy-doctor ~/.pi/agent/skills/proxy-doctor
```

然后重启 Claude Code 或等待 skill 自动重载。
