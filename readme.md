# downloader

> 终端多线程下载器 — 基于 [Ink](https://github.com/vadimdemedes/ink) 构建的交互式命令行下载工具

利用 HTTP Range 请求将文件切分为多个分片并发下载，实时显示每个线程的进度、速度和预计剩余时间。

## 安装

```bash
npm install
npm run build
```

## 使用方法

```bash
# 基本用法（默认 4 线程）
node dist/cli.js <url>

# 指定线程数
node dist/cli.js <url> --threads=8

# 指定输出路径和线程数
node dist/cli.js <url> -o ./output.zip -t 8
```

### 参数

| 参数 | 缩写 | 说明 | 默认值 |
|------|------|------|--------|
| `--threads` | `-t` | 下载线程数 | `4` |
| `--output` | `-o` | 输出文件路径 | 自动检测 |

### 示例

```bash
# 下载文件到当前目录
node dist/cli.js https://example.com/releases/app-v2.0.zip

# 8 线程下载并指定保存路径
node dist/cli.js https://example.com/data/dataset.tar.gz -t 8 -o ./dataset.tar.gz
```

## 功能特性

- **多线程并发下载** — 通过 HTTP Range 分片，充分利用带宽
- **实时进度展示** — 总进度条 + 每个线程独立进度条
- **速度 & ETA** — 实时计算下载速度和预计剩余时间
- **自动文件名检测** — 从 `Content-Disposition` 响应头或 URL 路径推断文件名
- **重定向跟随** — 自动处理 301/302 重定向
- **优雅降级** — 服务器不支持 Range 请求时自动切换为单线程下载
- **取消下载** — 按 `q` 或 `Esc` 随时取消

## 项目结构

```
source/
├── cli.tsx         # CLI 入口，解析命令行参数
├── app.tsx         # Ink UI 组件，渲染终端界面
└── downloader.ts   # 下载引擎，处理分片、并发、合并逻辑
```

## 开发

```bash
# 监听模式编译
npm run dev

# 类型检查
npx tsc --noEmit

# 运行测试
npm test
```

## 许可证

MIT
