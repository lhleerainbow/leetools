// Electron 标准 preload 模式：contextIsolation: true + contextBridge
// contextBridge.exposeInMainWorld 将 API 安全地暴露到渲染进程的 window 上
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('ocrAPI', {
  recognize: (imageDataUrl: string): Promise<unknown> =>
    ipcRenderer.invoke('ocr:recognize', imageDataUrl),

  exportExcel: (data: {
    excelFileBase64: string
    headerWords: string[]
    footerWords: string[]
  }): Promise<unknown> => ipcRenderer.invoke('ocr:exportExcel', data)
})

contextBridge.exposeInMainWorld('pdfAPI', {
  mergePdfs: (data: { pdfBuffers: ArrayBuffer[]; outputFileName: string }): Promise<unknown> =>
    ipcRenderer.invoke('pdf:merge', data),

  savePdf: (data: { pdfBase64: string; suggestedFileName: string }): Promise<unknown> =>
    ipcRenderer.invoke('pdf:save', data)
})

// TCP 客户端 API：invoke 调用 + on/off 事件
// 事件类型：
//   connect    → { clientId }
//   close      → { clientId, hadError }
//   error      → { clientId, message }
//   data       → { clientId, hex }  接收到的字节，已格式化为空格分隔的大写 hex
contextBridge.exposeInMainWorld('tcpAPI', {
  connect: (args: { clientId: string; host: string; port: number }): Promise<unknown> =>
    ipcRenderer.invoke('tcp:connect', args),

  disconnect: (args: { clientId: string }): Promise<unknown> =>
    ipcRenderer.invoke('tcp:disconnect', args),

  send: (args: { clientId: string; hex: string }): Promise<unknown> =>
    ipcRenderer.invoke('tcp:send', args),

  isConnected: (args: { clientId: string }): Promise<unknown> =>
    ipcRenderer.invoke('tcp:isConnected', args),

  onEvent: (
    listener: (evt: {
      clientId: string
      type: 'connect' | 'close' | 'error' | 'data'
      hadError?: boolean
      message?: string
      hex?: string
    }) => void
  ): (() => void) => {
    const handler = (
      _evt: Electron.IpcRendererEvent,
      payload: {
        clientId: string
        type: 'connect' | 'close' | 'error' | 'data'
        hadError?: boolean
        message?: string
        hex?: string
      }
    ): void => listener(payload)
    ipcRenderer.on('tcp:event', handler)
    return () => ipcRenderer.removeListener('tcp:event', handler)
  }
})

console.log('[Preload] ✅ contextBridge.exposeInMainWorld("ocrAPI"/"pdfAPI"/"tcpAPI") 已执行')
