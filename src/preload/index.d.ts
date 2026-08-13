// 兼容未使用的模板组件 Versions.vue（它引用 window.electron.process.versions）
// 我们不再从 preload 实际暴露它，但保留类型声明让 typecheck 通过。
// 运行时该组件未被挂载，不会触发错误。

declare global {
  interface Window {
    // 兼容模板组件 Versions.vue（运行时该组件未挂载，不会报错）
    electron: {
      process: {
        versions: {
          electron: string
          chrome: string
          node: string
        }
      }
    }
    // 百度 OCR API（由 preload 脚本通过 contextBridge 暴露）
    ocrAPI: {
      /** 调用主进程进行百度表格 OCR 识别（return_excel=true，返回 excel_file） */
      recognize: (imageDataUrl: string) => Promise<{
        success: boolean
        error?: string
        grid: string[][]
        merges: { r: number; c: number; rowspan: number; colspan: number }[]
        excelFile: string
        headerWords: string[]
        footerWords: string[]
      }>
      /** 调用主进程弹出保存对话框，将百度返回的 base64 Excel 写入文件（含 header/footer 修补） */
      exportExcel: (data: {
        excelFileBase64: string
        headerWords: string[]
        footerWords: string[]
      }) => Promise<{ success: boolean; path?: string; error?: string }>
    }
    // PDF 合并 API（由 preload 脚本通过 contextBridge 暴露）
    pdfAPI: {
      /** 合并多个 PDF，传入 PDF 文件的 ArrayBuffer 数组，返回合并后 PDF 的 base64 与文件名 */
      mergePdfs: (data: { pdfBuffers: ArrayBuffer[]; outputFileName: string }) => Promise<{
        success: boolean
        error?: string
        base64?: string
        fileName?: string
      }>
      /** 调用主进程保存合并后的 PDF（弹出保存对话框） */
      savePdf: (data: {
        pdfBase64: string
        suggestedFileName: string
      }) => Promise<{ success: boolean; path?: string; error?: string }>
    }
    // TCP 客户端 API（由 preload 脚本通过 contextBridge 暴露）
    tcpAPI: {
      connect: (args: { clientId: string; host: string; port: number }) => Promise<{
        success: boolean
        error?: string
      }>
      disconnect: (args: { clientId: string }) => Promise<{
        success: boolean
        error?: string
      }>
      send: (args: { clientId: string; hex: string }) => Promise<{
        success: boolean
        sentBytes?: number
        error?: string
      }>
      isConnected: (args: { clientId: string }) => Promise<{ connected: boolean }>
      /** 注册 tcp 事件监听，返回取消订阅函数；payload.type ∈ {connect|close|error|data} */
      onEvent: (
        listener: (evt: {
          clientId: string
          type: 'connect' | 'close' | 'error' | 'data'
          hadError?: boolean
          message?: string
          hex?: string
        }) => void
      ) => () => void
    }
  }
}

export {}
