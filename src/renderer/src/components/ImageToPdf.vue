<template>
  <div class="image-to-pdf-layout">
    <!-- 左侧区域：上传 + 列表 + 转换按钮 -->
    <div class="ip-panel ip-panel-left">
      <div class="ip-title">上传图片</div>

      <!-- 上：拖拽/点击上传区域 -->
      <div
        class="upload-zone"
        :class="{ 'is-dragover': isDragging }"
        @click="triggerFileInput"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="handleDrop"
      >
        <el-icon class="upload-icon"><UploadFilled /></el-icon>
        <div class="upload-text">拖拽图片到此处</div>
        <div class="upload-sub">或 <span class="upload-link">点击选择图片</span></div>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          multiple
          style="display: none"
          @change="handleFileSelect"
        />
      </div>

      <!-- 中：图片列表 -->
      <div class="file-list-wrap">
        <div class="file-list-header">已上传图片（{{ imageFiles.length }}）</div>
        <div v-if="imageFiles.length === 0" class="file-empty">暂无图片，请上传图片</div>
        <div v-else class="file-list">
          <div v-for="(item, index) in imageFiles" :key="item.id" class="file-item">
            <span class="file-order">{{ index + 1 }}</span>
            <img
              v-if="item.thumbUrl"
              class="file-thumb"
              :src="item.thumbUrl"
              :alt="item.name"
              @error="item.thumbUrl = ''"
            />
            <div v-else class="file-thumb file-thumb-fallback">
              <el-icon><Picture /></el-icon>
            </div>
            <el-tooltip :content="item.name" :disabled="!isNameOverflow(item.name)" placement="top">
              <span class="file-name">{{ item.name }}</span>
            </el-tooltip>
            <el-button
              class="file-delete"
              type="danger"
              size="small"
              text
              @click.stop="removeFile(item.id)"
            >
              删除
            </el-button>
          </div>
        </div>
      </div>

      <!-- 下：转换按钮 -->
      <div class="convert-action">
        <el-button
          type="primary"
          size="large"
          :disabled="imageFiles.length === 0 || isConverting"
          :loading="isConverting"
          @click="handleConvert"
        >
          {{ isConverting ? '转换中...' : '转换为 PDF' }}
        </el-button>
        <div v-if="imageFiles.length === 0 && !isConverting" class="convert-tip">
          请至少上传 1 张图片
        </div>
      </div>
    </div>

    <!-- 右侧区域：转换结果 -->
    <div class="ip-panel ip-panel-right">
      <div class="ip-title">转换结果</div>
      <div class="result-wrap">
        <template v-if="!convertedResult">
          <div class="result-placeholder">
            <el-icon class="result-icon"><Document /></el-icon>
            <div class="result-text">等待转换</div>
          </div>
        </template>
        <template v-else>
          <div class="result-card">
            <div class="result-file-icon">
              <el-icon :size="48" color="#e6a23c"><Files /></el-icon>
            </div>
            <div class="result-file-name">{{ convertedResult.fileName }}</div>
            <el-button type="success" size="large" @click="handleDownload">
              <el-icon style="margin-right: 6px"><Download /></el-icon>
              下载 PDF
            </el-button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled, Document, Files, Download, Picture } from '@element-plus/icons-vue'

interface ImageFileItem {
  id: string
  name: string
  size: number
  /** 图片字节：JPEG/PNG 直接用原文件，其它格式已转为 PNG */
  buffer: ArrayBuffer
  /** 列表缩略图（dataURL；为空时列表显示占位图标） */
  thumbUrl: string
}

interface ConvertedResult {
  base64: string
  fileName: string
}

// --- DOM 引用 ---
const fileInput = ref<HTMLInputElement | null>(null)

// --- 状态 ---
const isDragging = ref(false)
const isConverting = ref(false)
const imageFiles = ref<ImageFileItem[]>([])
const convertedResult = ref<ConvertedResult | null>(null)

// --- 工具：生成唯一 ID ---
let idSeq = 0
const genId = (): string => `img_${Date.now()}_${++idSeq}`

// --- 工具：文件名超长判断（tooltip 初筛，实际以 CSS 溢出为准）---
const isNameOverflow = (name: string): boolean => name.length > 22

// --- 工具：生成输出文件名 image_YYYYMMDD + 3位随机数 ---
const genOutputFileName = (): string => {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  return `image_${y}${m}${d}${rand}.pdf`
}

// --- 工具：校验是否为图片 ---
const isImageFile = (file: File): boolean => {
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)
}

// --- 工具：判断是否本身就是 PDF 可直接嵌入的格式（JPEG / PNG）---
const isDirectEmbeddable = (file: File): boolean => {
  if (file.type === 'image/jpeg' || file.type === 'image/png') return true
  return /\.(jpe?g|png)$/i.test(file.name)
}

// --- 工具：把其它格式（webp/bmp/gif 等）用 canvas 转成 PNG ---
const convertToPngBuffer = async (file: File): Promise<ArrayBuffer> => {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建 canvas 画布')
    // 透明背景先铺白，避免转 PDF 后透明区域变黑
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('图片编码为 PNG 失败')
    return await blob.arrayBuffer()
  } finally {
    bitmap.close()
  }
}

// --- 读取单张图片为可嵌入的字节 ---
const readImage = async (file: File): Promise<ArrayBuffer> => {
  if (isDirectEmbeddable(file)) return await file.arrayBuffer()
  return await convertToPngBuffer(file)
}

/** 由文件头判断图片真实类型，用于构造正确的 Blob / dataURL */
const sniffMime = (buffer: ArrayBuffer, fallback: string): string => {
  const b = new Uint8Array(buffer)
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return 'image/png'
  }
  return fallback || 'image/png'
}

/**
 * 由已读取的图片字节生成缩略图 dataURL。
 * 关键点：不使用 URL.createObjectURL(file)。
 * 拖拽来源的 File 其底层文件句柄在 drop 事件结束后会被释放，
 * 生成的 blob: URL 再交给 <img> 加载时常常取不到数据导致预览空白；
 * 这里改用已经读入内存的字节生成 dataURL，拖拽与点击选择表现一致。
 */
const makeThumbDataUrl = async (buffer: ArrayBuffer, mimeHint: string): Promise<string> => {
  const mime = sniffMime(buffer, mimeHint)
  const blob = new Blob([buffer], { type: mime })
  const bitmap = await createImageBitmap(blob)
  try {
    const maxSide = 96
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建 canvas 画布')
    ctx.drawImage(bitmap, 0, 0, w, h)
    return canvas.toDataURL('image/png')
  } finally {
    bitmap.close()
  }
}

// --- 添加图片（通用处理）---
const addFiles = async (fileList: FileList | File[] | null): Promise<void> => {
  if (!fileList) return
  const files = Array.from(fileList)
  const images = files.filter(isImageFile)
  if (images.length !== files.length) {
    ElMessage.warning(`${files.length - images.length} 个非图片文件已被忽略`)
  }
  if (!images.length) {
    if (files.length) ElMessage.error('请选择图片文件')
    return
  }

  let added = 0
  for (const file of images) {
    try {
      const buffer = await readImage(file)
      // 缩略图生成失败不影响主流程，列表显示占位图标即可
      let thumbUrl = ''
      try {
        thumbUrl = await makeThumbDataUrl(buffer, file.type)
      } catch (thumbErr) {
        console.warn('[Image-ToPdf] 生成缩略图失败:', file.name, thumbErr)
      }
      imageFiles.value.push({
        id: genId(),
        name: file.name,
        size: file.size,
        buffer,
        thumbUrl
      })
      added++
    } catch (err) {
      console.error('[Image-ToPdf] 读取图片失败:', file.name, err)
      ElMessage.error(`读取图片失败：${file.name}`)
    }
  }

  if (added > 0) {
    // 有新图片加入，之前的结果已不对应当前列表
    convertedResult.value = null
    ElMessage.success(`已添加 ${added} 张图片`)
  }
}

// --- 事件：触发文件选择 ---
const triggerFileInput = (): void => {
  fileInput.value?.click()
}

// --- 事件：文件选择 ---
const handleFileSelect = (event: Event): void => {
  const target = event.target as HTMLInputElement
  void addFiles(target.files)
  target.value = ''
}

// --- 事件：拖拽放下 ---
const handleDrop = (event: DragEvent): void => {
  isDragging.value = false
  void addFiles(event.dataTransfer?.files ?? null)
}

// --- 事件：删除图片 ---
const removeFile = (id: string): void => {
  imageFiles.value = imageFiles.value.filter((f) => f.id !== id)
  convertedResult.value = null
}

// --- 事件：转换为 PDF ---
const handleConvert = async (): Promise<void> => {
  if (!imageFiles.value.length) {
    ElMessage.warning('请至少上传 1 张图片')
    return
  }
  if (!window.imageAPI || !window.imageAPI.toPdf) {
    ElMessage.error('图片转 PDF 服务未就绪，请重启 Electron 应用。')
    return
  }
  const outputFileName = genOutputFileName()
  const buffers = imageFiles.value.map((f) => f.buffer)

  isConverting.value = true
  convertedResult.value = null
  try {
    const result = await window.imageAPI.toPdf({
      images: buffers,
      outputFileName
    })
    if (result.success && result.base64 && result.fileName) {
      convertedResult.value = {
        base64: result.base64,
        fileName: result.fileName
      }
      ElMessage.success('转换成功！')
    } else {
      ElMessage.error(result.error || '转换失败')
    }
  } catch (err) {
    console.error('[Image-ToPdf] 调用异常:', err)
    ElMessage.error(`转换失败：${(err as Error).message || '未知错误'}`)
  } finally {
    isConverting.value = false
  }
}

// --- 事件：下载 / 保存 ---
const handleDownload = async (): Promise<void> => {
  if (!convertedResult.value) {
    ElMessage.warning('没有可下载的转换结果')
    return
  }
  if (!window.pdfAPI || !window.pdfAPI.savePdf) {
    ElMessage.error('保存服务未就绪，请重启应用。')
    return
  }
  try {
    const result = await window.pdfAPI.savePdf({
      pdfBase64: convertedResult.value.base64,
      suggestedFileName: convertedResult.value.fileName
    })
    if (result.success) {
      ElMessage.success(`PDF 已保存：${result.path}`)
    } else if (result.error && result.error !== '已取消保存') {
      ElMessage.error(`保存失败：${result.error}`)
    }
  } catch (err) {
    console.error('[PDF-Save] 调用异常:', err)
    ElMessage.error(`保存失败：${(err as Error).message || '未知错误'}`)
  }
}

// --- 窗口级拖拽拦截 ---
// Electron 中若未阻止默认行为，文件被拖到非投放区（或拖出后释放）会触发
// 渲染进程导航到该文件，导致整个界面被替换、看起来像"预览不出来"。
// 这里在 document 上统一兜底阻止默认行为，仅在投放区内部处理真正逻辑。
const preventDragDefault = (e: DragEvent): void => {
  e.preventDefault()
}

onMounted(() => {
  document.addEventListener('dragover', preventDragDefault)
  document.addEventListener('drop', preventDragDefault)
})

// --- 卸载：释放内存 ---
onUnmounted(() => {
  document.removeEventListener('dragover', preventDragDefault)
  document.removeEventListener('drop', preventDragDefault)
  imageFiles.value = []
  convertedResult.value = null
})
</script>

<style scoped>
.image-to-pdf-layout {
  display: flex;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

.ip-panel {
  display: flex;
  flex-direction: column;
  width: 50%;
  height: 100%;
  box-sizing: border-box;
  padding: 16px 20px;
}

.ip-panel-left {
  border-right: 1px solid #e4e7ed;
}

.ip-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
}

/* ========== 左侧 ========== */

.upload-zone {
  flex-shrink: 0;
  border: 2px dashed #dcdfe6;
  border-radius: 8px;
  padding: 24px 16px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
  background: #fafafa;
  margin-bottom: 14px;
}
.upload-zone:hover {
  border-color: #409eff;
  background: #ecf5ff;
}
.upload-zone.is-dragover {
  border-color: #67c23a;
  background: #f0f9eb;
}
.upload-icon {
  font-size: 36px;
  color: #409eff;
  margin-bottom: 8px;
}
.upload-text {
  font-size: 14px;
  color: #606266;
  margin-bottom: 4px;
}
.upload-sub {
  font-size: 12px;
  color: #909399;
}
.upload-link {
  color: #409eff;
}

/* 文件列表 */
.file-list-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-bottom: 14px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fff;
}
.file-list-header {
  flex-shrink: 0;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  border-bottom: 1px solid #ebeef5;
  background: #f5f7fa;
  border-radius: 6px 6px 0 0;
}
.file-empty {
  padding: 30px 12px;
  text-align: center;
  color: #909399;
  font-size: 13px;
}
.file-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.file-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  font-size: 13px;
  border-bottom: 1px dashed #f0f0f0;
  transition: background 0.15s;
}
.file-item:last-child {
  border-bottom: none;
}
.file-item:hover {
  background: #f5f7fa;
}
.file-order {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  line-height: 22px;
  text-align: center;
  background: #ecf5ff;
  color: #409eff;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 600;
  margin-right: 10px;
}
.file-thumb {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #ebeef5;
  background: #fafafa;
  margin-right: 10px;
}
.file-thumb-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c0c4cc;
  font-size: 16px;
  box-sizing: border-box;
}
.file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: #303133;
  margin-right: 8px;
}
.file-delete {
  flex-shrink: 0;
}

/* 转换按钮区 */
.convert-action {
  flex-shrink: 0;
  text-align: center;
}
.convert-tip {
  margin-top: 8px;
  font-size: 12px;
  color: #e6a23c;
}

/* ========== 右侧 ========== */
.result-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fafafa;
  overflow: hidden;
}
.result-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #909399;
}
.result-icon {
  font-size: 64px;
  margin-bottom: 14px;
  opacity: 0.5;
}
.result-text {
  font-size: 16px;
}

.result-card {
  width: 100%;
  max-width: 360px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 30px 24px;
  text-align: center;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.04);
}
.result-file-icon {
  margin-bottom: 14px;
}
.result-file-name {
  font-size: 16px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 24px;
  word-break: break-all;
  line-height: 1.4;
}
</style>
