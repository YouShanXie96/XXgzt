# 第三方组件

- Electron 44.3.0，MIT；运行时内含 LICENSE 与 LICENSES.chromium.html，包含 Chromium、Node.js 等组件的授权说明。来源：https://github.com/electron/electron/releases/tag/v44.3.0
- Node.js 24.19.0，授权全文在 tools/NODE_LICENSE.txt。来源：https://github.com/nodejs/node
- fflate 0.8.3，MIT，授权文件随 node_modules/fflate 保存。来源：https://github.com/101arrowz/fflate
- rcedit 2.0.0，MIT，授权全文在 tools/RCEDIT_LICENSE.txt。来源：https://github.com/electron/rcedit
- Tesseract OCR 及其运行依赖：违规排查的图片文字识别使用 Tesseract（打包后位于 `resources/ocr`，开发时位于 `resources/ocr`，来源为用户提供的参考程序资源）。Tesseract 主项目与 tessdata 使用 Apache-2.0；其他 DLL 保留各自上游授权。主项目：https://github.com/tesseract-ocr/tesseract，语言模型：https://github.com/tesseract-ocr/tessdata（chi_sim、eng），Leptonica：https://github.com/DanBloomberg/leptonica。

> 源码包（`谢谢工作台_源码_*.zip`）不包含 `resources/ocr` 第三方运行时；重新打包前把参考程序的 `Tesseract-OCR` 目录复制到项目 `resources/ocr`（保留 `tesseract.exe`、DLL 与 `tessdata/chi_sim.traineddata`、`eng.traineddata`），或从上面两个上游地址重新获取该运行时。

src/connectors 中的平台适配代码以用户提供的工作台程序包为参考，已为本机版调整。它们是可读、可修改的 JavaScript；其余壳程序、服务整合、界面、扫描、存储、导出和交接工具均在当前源码中。平台仍由淘宝/天猫/阿里妈妈提供，工作台不提供平台访问权限。

发布时应完整保留本文件和运行时的许可文件。
