# 标识字体

- `fingerpoint-brand-serif-regular.woff2`：来自 Adobe [思源宋体 2.003R](https://github.com/adobe-fonts/source-han-serif/tree/2.003R/SubsetOTF/CN) 的 `SourceHanSerifCN-Regular.otf`，用于站名。
- `fingerpoint-brand-sans-regular.woff2`：来自 Adobe [思源黑体 2.005R](https://github.com/adobe-fonts/source-han-sans/tree/2.005R/SubsetOTF/CN) 的 `SourceHanSansCN-Regular.otf`，用于署名。

使用 FontTools 提取 U+0020–007E 和 U+00A0，保留字形及排版功能，转换为 WOFF2。子集只用于英文标识，不作为全站中文字体。

两款字体均采用 SIL Open Font License 1.1；原始版权及许可保存在相邻的 `SourceHanSerif-LICENSE.txt` 和 `SourceHanSans-LICENSE.txt`。为遵守保留字体名称条款，子集的内部字体名称分别改为 `Fingerpoint Brand Serif` 和 `Fingerpoint Brand Sans`。
