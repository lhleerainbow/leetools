import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, resolve } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import * as net from 'net'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import icon from '../../resources/icon.png?asset'

// ============================================================================
// 一、应用身份与数据目录（必须在任何读取 app.name / app.getPath 之前执行）
// Electron 计算 localStorage / Session / userData 等目录时，根目录是：
// macOS  : ~/Library/Application Support/<app.getName()>
// Windows: %APPDATA%\<app.getName()>
// Linux  : ~/.config/<app.getName()>
// 这里通过 app.setName + app.setPath('userData') 双重保险，保证无论打包后的
// productName 有没有被 electron-builder 正确注入，本地数据目录一定是 Lee tools。
// ============================================================================
const APP_DISPLAY_NAME = 'Lee tools'
app.setName(APP_DISPLAY_NAME)
try {
  const appData = app.getPath('appData')
  app.setPath('userData', join(appData, APP_DISPLAY_NAME))
  // 同步把 sessionData 也落在同一层级，避免残留目录
  app.setPath('sessionData', join(appData, APP_DISPLAY_NAME, 'Session'))
} catch {
  /* ignore: 在极早期版本 electron 某些环境下 sessionData 未暴露，此时回退到默认 */
}
console.log(`[App] 应用名: ${app.getName()}`)
console.log(`[App] userData 目录: ${app.getPath('userData')}`)

// ============================================================================
// 四-C、TCP 客户端连接管理器
// 按 clientId 管理 socket，避免重复连接；连接/断开/数据/错误通过 webContents.send
// 推送给渲染进程（渲染进程通过 ipcRenderer.on 注册 tcp:event 监听）。
// ============================================================================
interface TcpConnEntry {
  clientId: string
  socket: net.Socket
  host: string
  port: number
  connected: boolean
}
const tcpConns = new Map<string, TcpConnEntry>()

function hexToBuf(hex: string): Buffer {
  const clean = hex.replace(/\s+/g, '')
  if (clean.length % 2 !== 0) throw new Error('16进制长度必须为偶数')
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error('仅允许 0-9 / a-f / A-F 的16进制字符')
  return Buffer.from(clean, 'hex')
}

function bufToHex(buf: Buffer): string {
  // 以空格分隔的大写 hex，方便阅读：41 42 43
  return buf
    .toString('hex')
    .toUpperCase()
    .replace(/(.{2})/g, '$1 ')
    .trim()
}

function closeTcp(clientId: string): void {
  const entry = tcpConns.get(clientId)
  if (!entry) return
  try {
    entry.socket.removeAllListeners()
    entry.socket.destroy()
  } catch {
    /* ignore */
  }
  tcpConns.delete(clientId)
}

// ============================================================================
// 一、百度 OCR 凭证读取
// 说明：百度 Secret Key 必须只存在于主进程，绝不能被打进渲染层代码。
//
// 凭证来源与优先级（从高到低）：
//   1. process.env —— 包括 CI 注入、启动时的环境变量
//   2. userData 目录下的 config.json —— 给最终用户手动填密钥留口子（本地不改源码也能配）
//   3. 打包后 resources/.env —— CI 构建时通过 GitHub Secrets 写入并随安装包分发
//   4. 项目根目录 .env / process.cwd()/.env —— 本地开发用
//
// 不使用编译期替换，避免 Secret 被打进渲染进程 bundle。
// ============================================================================
interface UserConfig {
  BAIDU_OCR_API_KEY?: string
  BAIDU_OCR_SECRET_KEY?: string
}

function userConfigPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function loadUserConfig(): UserConfig {
  try {
    const p = userConfigPath()
    if (!existsSync(p)) return {}
    const content = readFileSync(p, 'utf-8')
    const obj = JSON.parse(content) as unknown
    if (!obj || typeof obj !== 'object') return {}
    return obj as UserConfig
  } catch {
    return {}
  }
}

let userConfigCache: UserConfig | null = null
function cachedUserConfig(): UserConfig {
  if (userConfigCache === null) userConfigCache = loadUserConfig()
  return userConfigCache
}

function applyEnvFile(path: string): boolean {
  if (!path || !existsSync(path)) return false
  const content = readFileSync(path, 'utf-8')
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/)
    if (!m) continue
    const key = m[1]
    let val = (m[2] ?? '').trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    // 仅当 process.env 中尚未设置时才用 .env 兜底（环境变量优先级最高）
    if (process.env[key] === undefined) process.env[key] = val
  }
  return true
}

function loadEnvFilesEarly(): void {
  // 开发态：优先找项目根目录
  const devCandidates: string[] = [
    resolve(__dirname, '..', '..', '.env'), // dev: out/main/index.js -> 项目根
    resolve(process.cwd(), '.env')
  ].filter(Boolean) as string[]
  for (const p of devCandidates) {
    if (applyEnvFile(p)) return
  }
  // 打包态：electron-builder 把 resources 目录整个拷贝到 process.resourcesPath
  // 并且 asarUnpack: resources/** —— .env 不在 asar 里，直接文件读取
  if (app.isPackaged && process.resourcesPath) {
    applyEnvFile(join(process.resourcesPath, '.env'))
  }
}
loadEnvFilesEarly()

/**
 * 读取凭证。返回 { ok: true, value } 或 { ok: false, hint }，
 * 不再 throw，上层 OCR IPC 拿到 hint 后通过 ElMessage 友好提示用户。
 */
function getCred(key: keyof UserConfig): { ok: true; value: string } | { ok: false; hint: string } {
  // 1) 进程环境变量（CI注入 / 启动脚本）优先级最高
  const fromEnv = process.env[key]
  if (fromEnv && fromEnv.trim()) return { ok: true, value: fromEnv.trim() }
  // 2) 用户自己在 userData/config.json 写的密钥
  const fromUser = cachedUserConfig()[key]
  if (fromUser && fromUser.trim()) return { ok: true, value: fromUser.trim() }
  // 3) .env 在打包 resources 里
  // （已经在 loadEnvFilesEarly -> applyEnvFile 里写到 process.env[key] 过了，这里兜底）
  const fromEnvFinal = process.env[key]
  if (fromEnvFinal && fromEnvFinal.trim()) return { ok: true, value: fromEnvFinal.trim() }

  const paths: string[] = []
  paths.push(userConfigPath())
  if (app.isPackaged && process.resourcesPath) paths.push(join(process.resourcesPath, '.env'))
  paths.push(resolve(__dirname, '..', '..', '.env'))
  const example =
    `方式一（给每台机器单独配置，推荐）：在 "${userConfigPath()}" 写入 ` +
    `{ "BAIDU_OCR_API_KEY": "...", "BAIDU_OCR_SECRET_KEY": "..." }，重启应用生效。` +
    `方式二（随安装包分发，开发者构建时在 GitHub Secrets 配置 BAIDU_OCR_API_KEY / BAIDU_OCR_SECRET_KEY 再打包）。` +
    `方式三（本地开发）：项目根目录写 .env 文件并填 BAIDU_OCR_API_KEY / BAIDU_OCR_SECRET_KEY。`
  return {
    ok: false,
    hint: `未配置百度OCR凭证：缺少 ${key}。${example}`
  }
}

// ============================================================================
// 二、access_token 缓存
// 鉴权：POST https://aip.baidubce.com/oauth/2.0/token
//       grant_type=client_credentials&client_id={APIKey}&client_secret={SecretKey}
// token 默认 30 天有效，这里提前 5 分钟刷新。
// ============================================================================
interface TokenCache {
  token: string
  expiresAt: number
}
let tokenCache: TokenCache | null = null

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token

  const apiKeyResult = getCred('BAIDU_OCR_API_KEY')
  if (!apiKeyResult.ok) throw new Error(apiKeyResult.hint)
  const secretKeyResult = getCred('BAIDU_OCR_SECRET_KEY')
  if (!secretKeyResult.ok) throw new Error(secretKeyResult.hint)

  const apiKey = apiKeyResult.value
  const secretKey = secretKeyResult.value
  const url =
    'https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials' +
    `&client_id=${encodeURIComponent(apiKey)}` +
    `&client_secret=${encodeURIComponent(secretKey)}`

  const res = await fetch(url, { method: 'POST' })
  const json = (await res.json()) as {
    access_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }

  if (json.error || !json.access_token) {
    throw new Error(
      `获取 access_token 失败：${json.error || '未知错误'} ${json.error_description || ''}`.trim()
    )
  }

  tokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + ((json.expires_in ?? 2592000) - 300) * 1000
  }
  return tokenCache.token
}

// ============================================================================
// 三、表格识别结果解析
// 接口：百度「表格文字识别 V2」 POST /rest/2.0/ocr/v1/table
// 返回 tables_result[].body[]，每个单元格含 row_start/row_end/col_start/col_end/words
// （0 基索引，支持跨行跨列）。header/footer 为表外的标题/备注文字，按整行合并保留。
// 解析器对字段名做了防御性兼容（col_start / column_start / row 数组等）。
// ============================================================================
interface CellMerge {
  r: number
  c: number
  rowspan: number
  colspan: number
}
interface ParsedTable {
  grid: string[][]
  merges: CellMerge[]
  excelFile: string
  headerWords: string[]
  footerWords: string[]
}

function toNum(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isNaN(n) ? fallback : n
}

function parseTable(table: unknown): ParsedTable {
  const t = (table || {}) as Record<string, unknown>
  const header = ((t.header as unknown[]) || []).filter(
    (h): h is { words?: string } => !!h && !!(h as { words?: string }).words
  )
  const footer = ((t.footer as unknown[]) || []).filter(
    (f): f is { words?: string } => !!f && !!(f as { words?: string }).words
  )
  const body = ((t.body as unknown[]) || []) as Record<string, unknown>[]

  const cells = body
    .map((c): { rs: number; re: number; cs: number; ce: number; words: string } => {
      const rowArr = Array.isArray(c.row) ? (c.row as number[]) : null
      const colArr = Array.isArray(c.column) ? (c.column as number[]) : null
      const rs = toNum(c.row_start ?? c.rowstart ?? rowArr?.[0] ?? c.row ?? 0)
      const re = toNum(c.row_end ?? c.rowend ?? rowArr?.[rowArr.length - 1] ?? c.row ?? rs)
      const cs = toNum(c.col_start ?? c.colstart ?? c.column_start ?? colArr?.[0] ?? c.column ?? 0)
      const ce = toNum(
        c.col_end ?? c.colend ?? c.column_end ?? colArr?.[colArr.length - 1] ?? c.column ?? cs
      )
      return { rs, re, cs, ce, words: String(c.words ?? '') }
    })
    .filter((c) => [c.rs, c.re, c.cs, c.ce].every((n) => !Number.isNaN(n)))

  const headerRows = header.length
  const footerRows = footer.length

  let bodyRows = 0
  let bodyCols = 0
  for (const c of cells) {
    bodyRows = Math.max(bodyRows, c.re + 1)
    bodyCols = Math.max(bodyCols, c.ce + 1)
  }
  const totalRows = headerRows + bodyRows + footerRows
  const totalCols = Math.max(bodyCols, 1)

  const grid: string[][] = Array.from({ length: totalRows }, () => new Array(totalCols).fill(''))
  const merges: CellMerge[] = []

  // 表头：每个元素作为一行，跨全部列合并
  header.forEach((h, i) => {
    grid[i][0] = String(h.words ?? '')
    if (totalCols > 1) merges.push({ r: i, c: 0, rowspan: 1, colspan: totalCols })
  })

  // 表体：按行列范围放置，跨行/跨列记录为合并
  for (const c of cells) {
    const r = c.rs + headerRows
    const col = c.cs
    grid[r][col] = c.words
    if (c.re > c.rs || c.ce > c.cs) {
      merges.push({ r, c: col, rowspan: c.re - c.rs + 1, colspan: c.ce - c.cs + 1 })
    }
  }

  // 表尾：每个元素作为一行，跨全部列合并
  footer.forEach((f, i) => {
    const r = headerRows + bodyRows + i
    grid[r][0] = String(f.words ?? '')
    if (totalCols > 1) merges.push({ r, c: 0, rowspan: 1, colspan: totalCols })
  })

  // 提取 header/footer 的文字，供导出时修补百度 excel_file（excel_file 不含表外标题）
  const headerWords = header.map((h) => String(h.words ?? ''))
  const footerWords = footer.map((f) => String(f.words ?? ''))

  return { grid, merges, excelFile: '', headerWords, footerWords }
}

// 去掉 data URL 头，取纯 base64
function stripDataUrl(dataUrl: string): string {
  const idx = dataUrl.indexOf(',')
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl
}

// XML 特殊字符转义（插入 header/footer 文字到 sheet XML 时使用）
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// 百度错误码 -> 友好提示
function friendlyOcrError(code: number, msg: string): string {
  const map: Record<number, string> = {
    6: '无权限访问该用户数据',
    16: '权限或额度问题：可能未开通「表格文字识别」服务，或今日免费额度已用完。请到百度智能云控制台-文字识别，确认已开通「表格文字识别（V2）」并领取免费额度',
    110: 'access_token 无效',
    111: 'access_token 已过期',
    17: '每天请求量超限额（百度 OCR 免费额度可能已用完）',
    18: 'QPS 超限额，请稍后重试',
    19: '请求总量超限额',
    216200: '图片为空',
    216201: '图片格式不支持（需 PNG/JPG/JPEG/BMP）',
    216202: '图片过大：base64 编码后需 ≤ 4M，最长边 ≤ 4096px',
    282000: '服务器内部错误，请重试'
  }
  return map[code] || `百度OCR错误 [${code}]: ${msg}`
}

async function recognizeTable(imageDataUrl: string): Promise<ParsedTable> {
  const token = await getAccessToken()
  const base64 = stripDataUrl(imageDataUrl)
  // return_excel=true：让百度直接返回 base64 编码的 Excel 文件（excel_file 字段）
  const body = `image=${encodeURIComponent(base64)}&return_excel=true`

  const res = await fetch(
    `https://aip.baidubce.com/rest/2.0/ocr/v1/table?access_token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    }
  )
  const json = (await res.json()) as {
    error_code?: number
    error_msg?: string
    tables_result?: unknown[]
    forms_result?: unknown[]
    excel_file?: string
  }

  if (json.error_code) {
    throw new Error(friendlyOcrError(json.error_code, json.error_msg || ''))
  }

  const excelFile = json.excel_file || ''
  const tables = json.tables_result || json.forms_result || []
  console.log('[OCR] tables 数量:', tables.length, ', excel_file 长度:', excelFile.length)
  if (!tables.length) return { grid: [], merges: [], excelFile, headerWords: [], footerWords: [] }

  // 诊断：打印 header/body/footer，确认百度返回了哪些数据
  const t0 = (tables[0] || {}) as Record<string, unknown>
  const headerRaw = Array.isArray(t0.header) ? t0.header : []
  const bodyRaw = Array.isArray(t0.body) ? t0.body : []
  const footerRaw = Array.isArray(t0.footer) ? t0.footer : []
  console.log(
    '[OCR] header(',
    headerRaw.length,
    '条):',
    JSON.stringify(headerRaw.map((h: { words?: string }) => h?.words))
  )
  console.log('[OCR] body(', bodyRaw.length, '条)')
  console.log(
    '[OCR] footer(',
    footerRaw.length,
    '条):',
    JSON.stringify(footerRaw.map((f: { words?: string }) => f?.words))
  )

  const parsed = parseTable(tables[0])
  console.log('[OCR] 解析后 grid 行数:', parsed.grid.length, ', merges:', parsed.merges.length)
  return { ...parsed, excelFile }
}

// ============================================================================
// 四、IPC 处理器
// ============================================================================
ipcMain.handle('ocr:recognize', async (_evt, imageDataUrl: string) => {
  try {
    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      return {
        success: false,
        error: '未提供图片数据',
        grid: [],
        merges: [],
        excelFile: '',
        headerWords: [],
        footerWords: []
      }
    }
    const { grid, merges, excelFile, headerWords, footerWords } = await recognizeTable(imageDataUrl)
    if (!grid.length && !excelFile) {
      return {
        success: false,
        error: '未识别到表格内容，请确认图片中包含表格',
        grid: [],
        merges: [],
        excelFile: '',
        headerWords: [],
        footerWords: []
      }
    }
    return { success: true, grid, merges, excelFile, headerWords, footerWords }
  } catch (e) {
    return {
      success: false,
      error: (e as Error).message,
      grid: [],
      merges: [],
      excelFile: '',
      headerWords: [],
      footerWords: []
    }
  }
})

ipcMain.handle(
  'ocr:exportExcel',
  async (evt, data: { excelFileBase64: string; headerWords: string[]; footerWords: string[] }) => {
    try {
      const { excelFileBase64, headerWords, footerWords } = data
      if (!excelFileBase64 || typeof excelFileBase64 !== 'string') {
        return { success: false, error: '没有可导出的 Excel 数据，请先点击识别' }
      }
      console.log(
        '[Export] 收到导出请求, base64 长度:',
        excelFileBase64.length,
        ', header:',
        headerWords.length,
        ', footer:',
        footerWords.length
      )

      // ⚠️ 关键：必须把 BrowserWindow 绑定到 dialog，否则 macOS 下会触发
      // "representedObject is not a WeakPtrToElectronMenuModelAsNSObject" 警告，
      // 并可能导致对话框无法正常弹出 / 返回异常。
      const win = BrowserWindow.fromWebContents(evt.sender)
      // 文件名格式：ocr_result_YYYYMMDD + 3位随机数字.xlsx
      const now = new Date()
      const dateStr =
        `${now.getFullYear()}` +
        `${String(now.getMonth() + 1).padStart(2, '0')}` +
        `${String(now.getDate()).padStart(2, '0')}`
      const random3 = String(Math.floor(Math.random() * 1000)).padStart(3, '0')
      const showOpts = {
        title: '导出 Excel',
        defaultPath: `ocr_result_${dateStr}${random3}.xlsx`,
        filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
      }
      const result = win
        ? await dialog.showSaveDialog(win, showOpts)
        : await dialog.showSaveDialog(showOpts)
      console.log(
        '[Export] dialog 结果: canceled =',
        result.canceled,
        ', filePath =',
        result.filePath
      )

      if (result.canceled || !result.filePath) {
        return { success: false, error: '已取消导出' }
      }

      // 百度 excel_file 只含表格主体（body），不含表外的 header/footer。
      // ⚠️ SheetJS 社区版不支持写入单元格样式（边框/字体/颜色），用 xlsx 库修补会丢格式。
      // 这里用 JSZip 直接在 XML 层面操作：平移行号 + 插入 header/footer 行，
      // 完全保留百度原始 Excel 的所有格式（边框、列宽、合并单元格、字体等）。
      const buf = Buffer.from(excelFileBase64, 'base64')
      let outBuf: Buffer
      const headerOffset = headerWords.length
      const footerOffset = footerWords.length

      if (headerOffset || footerOffset) {
        const zip = await JSZip.loadAsync(buf)

        // 找到所有 sheet XML 文件（通常为 xl/worksheets/sheet1.xml）
        const sheetPaths = Object.keys(zip.files).filter((p) =>
          /^xl\/worksheets\/sheet\d+\.xml$/.test(p)
        )

        for (const sheetPath of sheetPaths) {
          const file = zip.file(sheetPath)
          if (!file) continue
          let xml = await file.async('string')

          // 提取原始最后一行号（用于计算 footer 插入位置）
          const dimMatch = xml.match(/<dimension ref="[A-Z]+\d+:[A-Z]+(\d+)"/)
          const origLastRow = dimMatch ? Number(dimMatch[1]) : 0

          // 1. 所有 <row r="N"> 行号 +headerOffset
          xml = xml.replace(/<row r="(\d+)"/g, (_m, n) => `<row r="${Number(n) + headerOffset}"`)

          // 2. 所有 <c r="A1"> 单元格行号 +headerOffset
          xml = xml.replace(
            /<c r="([A-Z]+)(\d+)"/g,
            (_m, col, row) => `<c r="${col}${Number(row) + headerOffset}"`
          )

          // 3. 合并单元格 <mergeCell ref="A1:N1"> 行号 +headerOffset
          xml = xml.replace(
            /<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g,
            (_m, c1, r1, c2, r2) =>
              `<mergeCell ref="${c1}${Number(r1) + headerOffset}:${c2}${Number(r2) + headerOffset}"`
          )

          // 4. <dimension ref="A1:N12"> 起始行不变，结束行 +headerOffset +footerOffset
          xml = xml.replace(
            /<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g,
            (_m, c1, r1, c2, r2) =>
              `<dimension ref="${c1}${r1}:${c2}${Number(r2) + headerOffset + footerOffset}"`
          )

          // 5. 在 <sheetData> 后插入 header 行（纯文本，无样式）
          if (headerOffset > 0) {
            const headerXml = headerWords
              .map((h, i) => {
                const r = i + 1
                return `<row r="${r}"><c r="A${r}" t="str"><v>${escapeXml(h)}</v></c></row>`
              })
              .join('')
            xml = xml.replace(/<sheetData>/, `<sheetData>${headerXml}`)
          }

          // 6. 在 </sheetData> 前插入 footer 行
          if (footerOffset > 0) {
            const footerXml = footerWords
              .map((f, i) => {
                const r = origLastRow + headerOffset + 1 + i
                return `<row r="${r}"><c r="A${r}" t="str"><v>${escapeXml(f)}</v></c></row>`
              })
              .join('')
            xml = xml.replace(/<\/sheetData>/, `${footerXml}</sheetData>`)
          }

          zip.file(sheetPath, xml)
        }

        outBuf = (await zip.generateAsync({
          type: 'nodebuffer',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 }
        })) as Buffer
        console.log(
          '[Export] ✅ XML 级修补完成 header',
          headerOffset,
          '行, footer',
          footerOffset,
          '行（完整保留原始格式）'
        )
      } else {
        // 无表外标题/备注，直接写入百度原始 Excel
        outBuf = buf
      }

      writeFileSync(result.filePath, outBuf)
      console.log('[Export] ✅ 文件已写入:', result.filePath)
      return { success: true, path: result.filePath }
    } catch (e) {
      console.error('[Export] ❌ 导出异常:', e)
      return { success: false, error: (e as Error).message }
    }
  }
)

// ============================================================================
// 四-B、PDF 合并 IPC 处理器
// ============================================================================
ipcMain.handle(
  'pdf:merge',
  async (
    _evt,
    data: { pdfBuffers: ArrayBuffer[]; outputFileName: string }
  ): Promise<{
    success: boolean
    error?: string
    base64?: string
    fileName?: string
  }> => {
    try {
      const { pdfBuffers, outputFileName } = data
      if (!pdfBuffers || !pdfBuffers.length) {
        return { success: false, error: '没有可合并的 PDF 文件' }
      }

      console.log('[PDF-Merge] 开始合并，文件数量:', pdfBuffers.length)
      const mergedPdfDoc = await PDFDocument.create()

      for (let i = 0; i < pdfBuffers.length; i++) {
        const buffer = pdfBuffers[i]
        try {
          // 防御性校验：必须是有效的 Uint8Array
          const uint8 = new Uint8Array(buffer)
          const srcDoc = await PDFDocument.load(uint8)
          const pageIndices = srcDoc.getPageIndices()
          console.log(
            `[PDF-Merge] 处理第 ${i + 1}/${pdfBuffers.length} 个文件，页数:`,
            pageIndices.length
          )

          // 优先使用 copyPages（兼容性更好）
          const copiedPages = await mergedPdfDoc.copyPages(srcDoc, pageIndices)
          copiedPages.forEach((page) => mergedPdfDoc.addPage(page))
        } catch (err) {
          console.error(`[PDF-Merge] 第 ${i + 1} 个文件加载/复制失败:`, err)
          return {
            success: false,
            error: `第 ${i + 1} 个 PDF 文件解析失败：${(err as Error).message || '未知错误'}`
          }
        }
      }

      // 保存为 Uint8Array 再转 base64
      const mergedBytes = await mergedPdfDoc.save()
      let base64 = ''
      // Node.js 环境使用 Buffer 转 base64
      if (typeof Buffer !== 'undefined') {
        base64 = Buffer.from(mergedBytes).toString('base64')
      } else {
        // 兜底浏览器环境（主进程不会走到这里）
        base64 = btoa(String.fromCharCode(...mergedBytes))
      }

      console.log('[PDF-Merge] ✅ 合并完成，base64 长度:', base64.length)
      return {
        success: true,
        base64,
        fileName: outputFileName
      }
    } catch (e) {
      console.error('[PDF-Merge] ❌ 合并异常:', e)
      return { success: false, error: (e as Error).message || '合并失败' }
    }
  }
)

ipcMain.handle(
  'pdf:save',
  async (
    evt,
    data: { pdfBase64: string; suggestedFileName: string }
  ): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const { pdfBase64, suggestedFileName } = data
      if (!pdfBase64) {
        return { success: false, error: '没有可保存的 PDF 数据' }
      }

      const win = BrowserWindow.fromWebContents(evt.sender)
      const showOpts = {
        title: '保存合并后的 PDF',
        defaultPath: suggestedFileName,
        filters: [{ name: 'PDF 文档', extensions: ['pdf'] }]
      }
      const result = win
        ? await dialog.showSaveDialog(win, showOpts)
        : await dialog.showSaveDialog(showOpts)

      if (result.canceled || !result.filePath) {
        return { success: false, error: '已取消保存' }
      }

      const buf = Buffer.from(pdfBase64, 'base64')
      writeFileSync(result.filePath, buf)
      console.log('[PDF-Save] ✅ 文件已写入:', result.filePath)
      return { success: true, path: result.filePath }
    } catch (e) {
      console.error('[PDF-Save] ❌ 保存异常:', e)
      return { success: false, error: (e as Error).message }
    }
  }
)

// ============================================================================
// 四-C、TCP IPC 处理器
// tcp:connect    → 对某 clientId 发起连接，返回 {success, error?}
// tcp:disconnect → 主动断开
// tcp:send       → 发送 16 进制字符串（自动转 Buffer），返回 {success, sentBytes?, error?}
// tcp:isConnected→ 查询是否已连接
// 通过 tcp:event 通道推送事件：
//   { clientId, type: 'connect' }
//   { clientId, type: 'close', hadError }
//   { clientId, type: 'error', message }
//   { clientId, type: 'data', hex }    hex 是空格分隔大写字符串
// ============================================================================
ipcMain.handle(
  'tcp:connect',
  async (
    evt,
    args: { clientId: string; host: string; port: number }
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const { clientId, host, port } = args || {}
      if (!clientId) return { success: false, error: '缺少 clientId' }
      if (tcpConns.has(clientId)) {
        const old = tcpConns.get(clientId)!
        if (old.connected) return { success: true }
        closeTcp(clientId)
      }
      const win = BrowserWindow.fromWebContents(evt.sender)
      const emit = (payload: unknown): void => {
        if (win && !win.isDestroyed()) win.webContents.send('tcp:event', payload)
      }
      const socket = net.createConnection({ host, port }, () => {
        const e = tcpConns.get(clientId)
        if (e) e.connected = true
        emit({ clientId, type: 'connect' })
      })
      socket.on('data', (chunk: Buffer) => {
        emit({ clientId, type: 'data', hex: bufToHex(chunk) })
      })
      socket.on('error', (err: Error) => {
        emit({ clientId, type: 'error', message: err?.message || String(err) })
      })
      socket.on('close', (hadError: boolean) => {
        const e = tcpConns.get(clientId)
        if (e) e.connected = false
        emit({ clientId, type: 'close', hadError })
        closeTcp(clientId)
      })
      tcpConns.set(clientId, { clientId, socket, host, port, connected: false })
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  }
)

ipcMain.handle(
  'tcp:disconnect',
  async (evt, args: { clientId: string }): Promise<{ success: boolean; error?: string }> => {
    try {
      const { clientId } = args || {}
      if (!tcpConns.has(clientId)) return { success: true }
      const win = BrowserWindow.fromWebContents(evt.sender)
      closeTcp(clientId)
      // 通知渲染层（closeTcp 里 destroy 会触发 socket 的 close 事件异步通知，但 destroy 前手动 emit 一次确保 UI 立即变化）
      if (win && !win.isDestroyed())
        win.webContents.send('tcp:event', { clientId, type: 'close', hadError: false })
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  }
)

ipcMain.handle(
  'tcp:send',
  async (
    _evt,
    args: { clientId: string; hex: string }
  ): Promise<{ success: boolean; sentBytes?: number; error?: string }> => {
    try {
      const { clientId, hex } = args || {}
      const entry = tcpConns.get(clientId)
      if (!entry) return { success: false, error: '未连接，请先连接服务端' }
      if (!entry.connected) return { success: false, error: '连接未就绪' }
      const buf = hexToBuf(hex || '')
      if (!buf.length) return { success: false, error: '没有要发送的数据' }
      entry.socket.write(buf)
      return { success: true, sentBytes: buf.length }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  }
)

ipcMain.handle(
  'tcp:isConnected',
  async (_evt, args: { clientId: string }): Promise<{ connected: boolean }> => {
    const entry = tcpConns.get(args?.clientId || '')
    return { connected: !!entry && entry.connected }
  }
)

// 应用退出时清理所有连接
app.on('before-quit', () => {
  for (const id of Array.from(tcpConns.keys())) closeTcp(id)
})

// ============================================================================
// 五、窗口
// ============================================================================
// 查找 preload 脚本的路径，兼容开发模式和生产模式
function resolvePreloadPath(): string {
  // 构建多个可能的路径
  const candidates: { path: string; desc: string }[] = [
    // 1. 基于 __dirname (开发模式: src/main 被编译到 out/main)
    { path: join(__dirname, '../preload/index.js'), desc: '基于 __dirname' },
    // 2. 基于 cwd + out/preload
    { path: join(process.cwd(), 'out', 'preload', 'index.js'), desc: '基于 cwd/out/preload' },
    // 3. 基于 app.getAppPath() + out/preload
    {
      path: join(app.getAppPath(), 'out', 'preload', 'index.js'),
      desc: '基于 getAppPath/out/preload'
    },
    // 4. 基于 app.getAppPath() + preload (有些打包方式)
    { path: join(app.getAppPath(), 'preload', 'index.js'), desc: '基于 getAppPath/preload' },
    // 5. 基于 resourcesPath (打包后)
    { path: join(process.resourcesPath, 'out', 'preload', 'index.js'), desc: '基于 resourcesPath' }
  ]

  console.log('[Preload] 尝试查找 preload 脚本:')
  for (const { path, desc } of candidates) {
    const exists = existsSync(path)
    console.log(`  ${exists ? '✅' : '❌'} ${desc}: ${path} ${exists ? '[存在]' : '[不存在]'}`)
    if (exists) {
      console.log(`[Preload] 找到 preload 脚本: ${path}`)
      return path
    }
  }

  // 如果都找不到，返回第一个候选（Electron 会报错，帮助定位问题）
  console.error('[Preload] ❌ 所有候选路径都找不到 preload 脚本！')
  console.error('[Preload] 请确保已运行 "npm run dev" 或 "electron-vite build" 来编译项目。')
  return candidates[0].path
}

function createWindow(): void {
  const preloadPath = resolvePreloadPath()
  console.log('[Preload] 最终使用的 preload 路径:', preloadPath)

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    title: APP_DISPLAY_NAME,
    // width: 900,
    // height: 670,
    width: 1060,
    height: 710,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      // 使用 Electron 标准安全模式：
      // contextIsolation: true + contextBridge.exposeInMainWorld
      // 这是最稳定的 preload → renderer 通信方式
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 兜底：如果 BrowserWindow 还没设 title（比如被 HTML <title> 覆盖之前的瞬间），
  // 显式再 set 一次，确保 macOS Dock/Windows 任务栏显示为 Lee tools
  mainWindow.setTitle(APP_DISPLAY_NAME)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 🔍 preload 加载失败诊断
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error('[Preload-Error] ❌ preload 脚本加载失败！')
    console.error('[Preload-Error] 路径:', preloadPath)
    console.error('[Preload-Error] 错误:', error?.message || error)
  })

  // 验证 ocrAPI 是否成功暴露到渲染层
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents
      .executeJavaScript('typeof window.ocrAPI')
      .then((result) => {
        console.log(`[OCR-Verify] window.ocrAPI 类型: ${result}`)
      })
      .catch((err: unknown) => {
        console.error('[OCR-Verify] 检测失败:', err)
      })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.leetools.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
