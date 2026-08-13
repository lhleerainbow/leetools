<template>
  <div class="ocr-container">
    <h1 class="ocr-title">📷 图片表格识别</h1>

    <!-- OCR 状态标识 -->
    <div v-if="ocrStatus === 'pending'" class="status-tip status-pending">⏳ OCR 服务加载中...</div>
    <div v-else-if="ocrStatus === 'ready'" class="status-tip status-ready">✅ OCR 服务已就绪</div>
    <div v-else class="status-tip status-error">
      ❌ OCR 服务不可用 — 请确保在 <strong>Electron 桌面窗口</strong> 中操作（不是浏览器），
      并<strong>彻底关闭后重新打开</strong>应用
    </div>

    <div class="upload-area">
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        style="display: none"
        @change="handleFileSelect"
      />
      <el-button type="primary" @click="triggerFileInput">选择图片</el-button>
      <el-button
        type="success"
        :disabled="!imageSrc || isRecognizing"
        :loading="isRecognizing"
        @click="startRecognition"
      >
        {{ isRecognizing ? '识别中...' : '开始识别' }}
      </el-button>
      <el-button type="warning" :disabled="!hasResult" @click="exportToExcel">
        导出Excel
      </el-button>
    </div>

    <!-- 图片预览 -->
    <div v-if="imageSrc" class="preview">
      <div class="preview-label">
        待识别图片{{
          normalizedImageSrc && normalizedImageSrc !== imageSrc
            ? '（已归一化至最长边≤8000px）：'
            : '：'
        }}
      </div>
      <img :src="normalizedImageSrc || imageSrc" alt="待识别图片" />
    </div>

    <!-- 识别结果：以 CSV 格式展示，支持滚动 -->
    <div v-if="hasResult" class="result">
      <h3>识别结果（CSV 格式）：</h3>
      <div class="csv-wrapper">
        <pre class="csv-view">{{ csvText }}</pre>
      </div>
    </div>
    <div v-else-if="emptyTip" class="empty-tip">{{ emptyTip }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'

// --- 数据状态 ---
const fileInput = ref<HTMLInputElement | null>(null)
const imageSrc = ref<string>('')
const normalizedImageSrc = ref<string>('')
const tableGrid = ref<string[][]>([])
const excelFileBase64 = ref<string>('')
const headerWords = ref<string[]>([])
const footerWords = ref<string[]>([])
const isRecognizing = ref<boolean>(false)
const emptyTip = ref<string>('')
const ocrStatus = ref<'pending' | 'ready' | 'error'>('pending')

const hasResult = computed(() => tableGrid.value.length > 0)

// --- 生命周期：轮询等待 window.ocrAPI 就绪 ---
onMounted(() => {
  let attempts = 0
  const maxAttempts = 50
  const checkInterval = setInterval(() => {
    attempts++
    if (window.ocrAPI && typeof window.ocrAPI.recognize === 'function') {
      clearInterval(checkInterval)
      ocrStatus.value = 'ready'
      console.log(`[OCR-Check] ✅ window.ocrAPI 已就绪 (第 ${attempts} 次检测)`)
      return
    }
    if (attempts >= maxAttempts) {
      clearInterval(checkInterval)
      ocrStatus.value = 'error'
      console.error('[OCR-Check] ❌ window.ocrAPI 超时不可用')
    }
  }, 200)
})

// --- 方法 ---
const triggerFileInput = (): void => {
  fileInput.value?.click()
}

/**
 * 图片归一化：百度表格 OCR 限制最长边 ≤ 8192px、base64 编码后 ≤ 8M。
 * 对超长边图片等比缩小到 8000px 以内，避免触发限制；小图保持原样。
 */
const normalizeImage = (dataUrl: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const maxEdge = Math.max(img.width, img.height)
      const MAX_EDGE = 8000
      if (maxEdge <= MAX_EDGE) {
        resolve(dataUrl)
        return
      }
      const scale = MAX_EDGE / maxEdge
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

const handleFileSelect = (event: Event): void => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = async (e) => {
    const originalDataUrl = e.target?.result as string
    imageSrc.value = originalDataUrl
    tableGrid.value = []
    excelFileBase64.value = ''
    emptyTip.value = ''

    try {
      normalizedImageSrc.value = await normalizeImage(originalDataUrl)
      ElMessage.success('图片加载成功！')
    } catch (err) {
      console.error('图片归一化失败，使用原图:', err)
      normalizedImageSrc.value = originalDataUrl
      ElMessage.success('图片加载成功！')
    }
  }
  reader.readAsDataURL(file)
  target.value = ''
}

const startRecognition = async (): Promise<void> => {
  if (!imageSrc.value) {
    ElMessage.warning('请先选择一张图片')
    return
  }

  // 防御性检查
  if (!window.ocrAPI || !window.ocrAPI.recognize) {
    ElMessage.error('OCR 服务未就绪，请完全重启 Electron 应用。')
    return
  }

  const imageToRecognize = normalizedImageSrc.value || imageSrc.value

  isRecognizing.value = true
  tableGrid.value = []
  excelFileBase64.value = ''
  headerWords.value = []
  footerWords.value = []
  emptyTip.value = ''

  try {
    const result = await window.ocrAPI.recognize(imageToRecognize)
    if (result.success && (result.grid.length || result.excelFile)) {
      tableGrid.value = result.grid || []
      excelFileBase64.value = result.excelFile || ''
      headerWords.value = result.headerWords || []
      footerWords.value = result.footerWords || []
      ElMessage.success('识别完成！')
    } else {
      emptyTip.value = result.error || '未识别到表格内容，请尝试更清晰的图片。'
      ElMessage.warning(result.error || '未识别到表格内容')
    }
  } catch (error) {
    console.error('OCR识别失败:', error)
    emptyTip.value = '识别失败，请查看控制台错误信息。'
    ElMessage.error('识别失败，请查看控制台错误信息。')
  } finally {
    isRecognizing.value = false
  }
}

const exportToExcel = async (): Promise<void> => {
  if (!hasResult.value) {
    ElMessage.warning('没有可导出的识别结果')
    return
  }
  if (!window.ocrAPI || !window.ocrAPI.exportExcel) {
    ElMessage.error('OCR 服务未就绪，无法导出。请完全重启应用。')
    return
  }
  if (!excelFileBase64.value) {
    ElMessage.error('没有可导出的 Excel 数据，请重新点击识别')
    return
  }
  try {
    const result = await window.ocrAPI.exportExcel({
      excelFileBase64: excelFileBase64.value,
      headerWords: [...headerWords.value],
      footerWords: [...footerWords.value]
    })
    if (result.success) {
      ElMessage.success(`Excel 导出成功：${result.path}`)
    } else if (result.error && result.error !== '已取消导出') {
      console.error('[Export] 主进程返回错误:', result.error)
      ElMessage.error(`导出失败：${result.error}`)
    }
  } catch (error) {
    console.error('[Export] IPC 调用异常:', error)
    ElMessage.error(`导出失败：${(error as Error).message || '未知错误'}`)
  }
}

// --- CSV 转换 ---
// 将二维数组 grid 转为 CSV 文本，遵循 RFC 4180：
// - 字段含逗号、双引号、换行 → 用双引号包裹
// - 字段内的双引号 → 转义为两个双引号
const csvText = computed(() => {
  return tableGrid.value
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell ?? '')
          if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
            return `"${s.replace(/"/g, '""')}"`
          }
          return s
        })
        .join(',')
    )
    .join('\n')
})
</script>

<style scoped>
.ocr-container {
  height: 100%;
  padding: 16px 24px;
  font-family: Arial, sans-serif;
  overflow-y: auto;
  box-sizing: border-box;
}
.ocr-title {
  margin: 0 0 16px 0;
  font-size: 22px;
}
.upload-area {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.preview-label {
  font-size: 12px;
  color: #909399;
  margin-bottom: 6px;
}
.preview img {
  max-width: 100%;
  max-height: 360px;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-bottom: 16px;
}
.result {
  margin-top: 8px;
}
.result h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
}
.csv-wrapper {
  border: 1px solid #ddd;
  border-radius: 4px;
  max-height: 400px;
  overflow: auto;
  background: #fafafa;
}
.csv-view {
  margin: 0;
  padding: 12px;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre;
  color: #333;
}
.empty-tip {
  padding: 16px;
  text-align: center;
  color: #909399;
  border: 1px dashed #ddd;
  border-radius: 4px;
  margin-top: 8px;
}
.status-tip {
  padding: 10px 14px;
  border-radius: 6px;
  margin-bottom: 14px;
  font-size: 14px;
}
.status-pending {
  background: #ecf5ff;
  border: 1px solid #d9ecff;
  color: #409eff;
}
.status-ready {
  background: #f0f9eb;
  border: 1px solid #e1f3d8;
  color: #67c23a;
}
.status-error {
  background: #fef0f0;
  border: 1px solid #fde2e2;
  color: #f56c6c;
}
</style>
