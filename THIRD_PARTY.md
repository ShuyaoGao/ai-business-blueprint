# 第三方组件与来源说明 / Third-party notices

| 内容 | 说明 |
|---|---|
| 第三方 JavaScript 库 | **没有**。画布、拖拽、统计、导出全部是本仓库手写的代码（`play/js/`） |
| 字体 | 不内嵌字体，只按名字引用操作系统自带字体（Microsoft YaHei / PingFang SC / Noto Sans CJK SC / system-ui） |
| 图标 | 五类方框的小图标是本仓库手画的 SVG 路径（`play/js/render.js` 里的 `ICONS`） |
| 网络请求 | 没有。不用 CDN、fetch、XHR、service worker，`file://` 下即可运行；页脚有一个指向总导览的普通链接 |
| 示例业务 | 连锁餐饮、工厂质检、客服中心三个示例的公司、流程和数字**都是虚构的**，只为教学 |

## 测试工具（不随仓库分发）

| 工具 | 用途 | 许可证 |
|---|---|---|
| Node.js | 运行单元测试 `tests/js/unit_tests.js` 和浏览器验收脚本 | MIT |
| Playwright + Chromium | 浏览器验收与截图（`tools/browser_check.js`） | Apache-2.0 / BSD |
| pytest | 静态检查 | MIT |

## 代码来源

全部代码为作者原创（由 Claude Code 辅助编写，经作者审阅）；没有复制任何画图软件或开源项目的代码。
