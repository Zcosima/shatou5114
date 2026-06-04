# 莎头观赛手账

一个 mobile-first 的手机端网页手账，用来记录比赛、周边、积分和图片。项目使用 Next.js + TypeScript + TailwindCSS + Zustand，数据保存在用户浏览器的 localStorage，不需要后端和登录系统。

## 功能

- 首页数据概览
- 比赛记录列表、详情编辑、删除
- 批量导入赛事截图，浏览器端 OCR 后生成可确认的比赛候选记录
- 周边记录列表、详情编辑、删除
- 批量识别购物截图，生成可确认的周边候选记录
- 积分页自动汇总比赛积分和周边消费积分
- JSON 数据导出和导入备份
- Zustand persist + localStorage 本地持久化

## 技术栈

- Next.js
- React
- TypeScript
- TailwindCSS
- Zustand
- tesseract.js

## 本地开发

```bash
npm install
npm run dev
```

默认开发地址：

```text
http://localhost:3000
```

如果使用 pnpm：

```bash
pnpm install
pnpm dev
```

## 构建

```bash
npm run build
```

构建通过后可运行：

```bash
npm run start
```

## 部署到 Vercel

### 方式一：GitHub + Vercel

1. 在 GitHub 创建一个新仓库。
2. 将本项目推送到 GitHub。
3. 打开 Vercel，选择 `Import Project`。
4. 选择该 GitHub 仓库。
5. Framework Preset 选择 `Next.js`。
6. Build Command 使用默认值：`npm run build`。
7. Output Directory 保持默认。
8. 点击 Deploy。

部署完成后会得到一个公网地址，例如：

```text
https://your-project-name.vercel.app
```

### 方式二：Vercel CLI

```bash
npm install -g vercel
vercel
vercel --prod
```

## 数据说明

所有数据都保存在用户自己的浏览器 localStorage 中：

- 不需要服务器
- 不需要登录
- 不会多人共享数据
- 换手机或清理浏览器缓存后，本地数据可能丢失

建议用户定期在“积分”页使用“导出数据”保存 JSON 备份；需要恢复时使用“导入数据”。

## 注意事项

- OCR 在浏览器端运行，首次识别可能需要加载 tesseract.js 相关资源。
- 识别结果不会直接写入正式记录，必须先在确认页检查并点击确认。
- 公开访问后，每位用户看到的是同一个网页，但数据保存在各自设备本地。