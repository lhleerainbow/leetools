<template>
  <div class="pdf-insert-layout">
    <!-- 左侧区域：两个上传 + 插入位置 + 合并按钮 -->
    <div class="pi-panel pi-panel-left">
      <div class="pi-title">PDF 插入</div>

      <div class="pi-scroll">
        <!-- ① 原 PDF -->
        <div class="pi-block">
          <div class="pi-block-title">① 原 PDF 文件</div>
          <div
            v-if="!basePdf"
            class="upload-zone"
            :class="{ 'is-dragover': dragTarget === 'base' }"
            @click="triggerFileInput('base')"
            @dragover.prevent="dragTarget = 'base'"
            @dragleave.prevent="dragTarget = null"
            @drop.prevent="handleDrop($event, 'base')"
          >
            <el-icon class="upload-icon"><UploadFilled /></el-icon>
            <div class="upload-text">拖拽PDF到此处</div>
            <div class="upload-sub">或 <span class="upload-link">点击选择文件</span></div>
          </div>
          <div v-else class="file-card">
            <el-icon class="file-card-icon" color="#e6a23c"><Document /></el-icon>
            <div class="file-card-info">
              <el-tooltip
                :content="basePdf.name"
                :disabled="!isNameOverflow(basePdf.name)"
                placement="top"
              >
                <div class="file-card-name">{{ basePdf.name }}</div>
              </el-tooltip>
              <div class="file-card-meta">
                <template v-if="loadingBaseCount">正在读取页数...</template>
                <template v-else>共 {{ basePdf.pageCount }} 页</template>
              </div>
            </div>
            <el-button type="danger" size="small" text @click="clearFile('base')">移除</el-button>
          </div>
        </div>

        <!-- ② 待插入的 PDF / 图片 -->
        <div class="pi-block">
          <div class="pi-block-title">② 待插入的 PDF 或图片</div>
          <div
            v-if="!insertSource"
            class="upload-zone"
            :class="{ 'is-dragover': dragTarget === 'insert' }"
            @click="triggerFileInput('insert')"
            @dragover.prevent="dragTarget = 'insert'"
            @dragleave.prevent="dragTarget = null"
            @drop.prevent="handleDrop($event, 'insert')"
          >
            <el-icon class="upload-icon"><UploadFilled /></el-icon>
            <div class="upload-text">拖拽PDF或图片到此处</div>
            <div class="upload-sub">或 <span class="upload-link">点击选择文件</span></div>
          </div>
          <div v-else class="file-card">
            <el-icon class="file-card-icon" color="#e6a23c">
              <Picture v-if="insertSource.kind === 'image'" />
              <Document v-else />
            </el-icon>
            <div class="file-card-info">
              <el-tooltip
                :content="insertSource.name"
                :disabled="!isNameOverflow(insertSource.name)"
                placement="top"
              >
                <div class="file-card-name">{{ insertSource.name }}</div>
              </el-tooltip>
              <div class="file-card-meta">
                <template v-if="loadingInsertCount">正在读取...</template>
                <template v-else-if="insertSource.kind === 'image'">
                  共 {{ insertSource.pageCount }} 张图片（合为 {{ insertSource.pageCount }} 页）
                </template>
                <template v-else>共 {{ insertSource.pageCount }} 页</template>
              </div>
            </div>
            <el-button type="danger" size="small" text @click="clearFile('insert')">移除</el-button>
          </div>
        </div>

        <!-- ③ 插入位置 -->
        <div class="pi-block">
          <div class="pi-block-title">③ 插入位置</div>
          <el-select
            v-model="insertPosition"
            class="position-select"
            placeholder="请选择插入位置"
            :disabled="!basePdf || loadingBaseCount"
            no-data-text="请先上传原 PDF"
          >
            <el-option
              v-for="opt in positionOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <div v-if="basePdf && !loadingBaseCount" class="position-tip">
            可选范围：最前面 ~ 第 {{ basePdf.pageCount }} 页之后
          </div>
        </div>
      </div>

      <!-- 合并按钮 -->
      <div class="merge-action">
        <el-button
          type="primary"
          size="large"
          :disabled="!canMerge || isMerging"
          :loading="isMerging"
          @click="handleMerge"
        >
          {{ isMerging ? '合并中...' : '合并生成新PDF' }}
        </el-button>
        <div v-if="!canMerge && !isMerging" class="merge-tip">
          请上传原 PDF、待插入的 PDF 或图片，并选择插入位置
        </div>
      </div>

      <!-- 隐藏的文件输入 -->
      <input
        ref="baseInput"
        type="file"
        accept="application/pdf,.pdf"
        style="display: none"
        @change="handleFileSelect($event, 'base')"
      />
      <input
        ref="insertInput"
        type="file"
        accept="application/pdf,.pdf,image/*"
        multiple
        style="display: none"
        @change="handleFileSelect($event, 'insert')"
      />
    </div>

    <!-- 右侧区域：合并结果 -->
    <div class="pi-panel pi-panel-right">
      <div class="pi-title">合并结果</div>
      <div class="result-wrap">
        <template v-if="!mergedResult">
          <div class="result-placeholder">
            <el-icon class="result-icon"><Document /></el-icon>
            <div class="result-text">等待合并</div>
          </div>
        </template>
        <template v-else>
          <div class="result-card">
            <div class="result-file-icon">
              <el-icon :size="48" color="#e6a23c"><Files /></el-icon>
            </div>
            <div class="result-file-name">{{ mergedResult.fileName }}</div>
            <div class="result-file-meta">共 {{ mergedResult.pageCount }} 页</div>
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
import { computed, ref, toRaw, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled, Document, Files, Download, Picture } from '@element-plus/icons-vue'

interface PdfSlotFile {
  name: string
  buffer: ArrayBuffer
  pageCount: number
}

/**
 * 待插入内容：可以是 PDF 文件，也可以是一组图片。
 * 图片会在合并时先转成 PDF（每张图一页），再整体插入到原 PDF 的指定位置。
 */
interface InsertSource {
  kind: 'pdf' | 'image'
  name: string
  pageCount: number
  /** kind === 'pdf' 时有效 */
  buffer?: ArrayBuffer
  /** kind === 'image' 时有效：各图片可嵌入的字节（JPEG/PNG，其它格式已转 PNG） */
  images?: ArrayBuffer[]
}

interface MergedResult {
  base64: string
  fileName: string
  pageCount: number
}

type SlotKey = 'base' | 'insert'

// --- DOM 引用 ---
const baseInput = ref<HTMLInputElement | null>(null)
const insertInput = ref<HTMLInputElement | null>(null)

// --- 状态 ---
const basePdf = ref<PdfSlotFile | null>(null)
const insertSource = ref<InsertSource | null>(null)
const loadingBaseCount = ref(false)
const loadingInsertCount = ref(false)
const dragTarget = ref<SlotKey | null>(null)
const isMerging = ref(false)
const mergedResult = ref<MergedResult | null>(null)

/**
 * 插入位置：0 = 最前面（第 1 页之前）；N = 第 N 页之后。
 * 上限即原 PDF 的总页数，与选择框边界一致。
 */
const insertPosition = ref<number | null>(null)

// --- 插入位置选项：根据原 PDF 页数动态生成 ---
const positionOptions = computed<{ value: number; label: string }[]>(() => {
  const total = basePdf.value?.pageCount ?? 0
  if (total <= 0) return []
  const options: { value: number; label: string }[] = [{ value: 0, label: '最前面（第 1 页之前）' }]
  for (let i = 1; i <= total; i++) {
    options.push({ value: i, label: `第 ${i} 页之后` })
  }
  return options
})

const canMerge = computed(
  () =>
    !!basePdf.value &&
    !!insertSource.value &&
    basePdf.value.pageCount > 0 &&
    insertPosition.value !== null
)

// --- 工具函数 ---
const isNameOverflow = (name: string): boolean => name.length > 24

const isPdfFile = (file: File): boolean => {
  if (file.type === 'application/pdf') return true
  return /\.pdf$/i.test(file.name)
}

const isImageFile = (file: File): boolean => {
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)
}

/** 本身就是 pdf-lib 可直接嵌入的格式（JPEG / PNG）时无需重新编码 */
const isDirectEmbeddable = (file: File): boolean => {
  if (file.type === 'image/jpeg' || file.type === 'image/png') return true
  return /\.(jpe?g|png)$/i.test(file.name)
}

/** 把 webp/bmp/gif 等格式用 canvas 转成 PNG 字节（铺白底，避免透明区域在 PDF 中变黑） */
const convertImageToPng = async (file: File): Promise<ArrayBuffer> => {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建 canvas 画布')
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

const readImageBuffer = async (file: File): Promise<ArrayBuffer> => {
  if (isDirectEmbeddable(file)) return await file.arrayBuffer()
  return await convertImageToPng(file)
}

/** base64 → ArrayBuffer（把主进程返回的图片合成 PDF 交给后续插入使用） */
const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer as ArrayBuffer
}

/** 文件名格式与 PDF 合并保持一致：pdf_YYYYMMDD + 3位随机数 */
const genOutputFileName = (): string => {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  return `pdf_${y}${m}${d}${rand}.pdf`
}

/** 读取 PDF 页数 */
const readPageCount = async (buffer: ArrayBuffer): Promise<number> => {
  if (!window.pdfAPI?.pageCount) return 0
  const res = await window.pdfAPI.pageCount({ buffer })
  if (!res.success || typeof res.pageCount !== 'number') {
    throw new Error(res.error || 'PDF 解析失败')
  }
  return res.pageCount
}

// --- 处理上传文件（原 PDF 只接受 PDF；待插入区域接受 PDF 或图片）---
const handleFiles = async (
  fileList: FileList | File[] | null | undefined,
  slot: SlotKey
): Promise<void> => {
  if (!fileList) return
  const files = Array.from(fileList)
  if (!files.length) return

  if (slot === 'base') {
    const pdf = files.find(isPdfFile)
    if (!pdf) {
      ElMessage.error('原文件请选择 PDF')
      return
    }
    if (files.length > 1) ElMessage.warning('原 PDF 仅支持单个文件，已取第一个 PDF')
    if (!window.pdfAPI?.pageCount) {
      ElMessage.error('PDF 解析服务未就绪，请重启 Electron 应用。')
      return
    }
    loadingBaseCount.value = true
    try {
      const buffer = await pdf.arrayBuffer()
      const pageCount = await readPageCount(buffer)
      if (pageCount <= 0) {
        ElMessage.error(`PDF 中没有可用的页面：${pdf.name}`)
        return
      }
      basePdf.value = { name: pdf.name, buffer, pageCount }
      // 原 PDF 变化后，位置选项整体重建：默认插入到最后
      insertPosition.value = pageCount
      mergedResult.value = null
      ElMessage.success(`已读取：${pdf.name}（${pageCount} 页）`)
    } catch (err) {
      console.error('[PDF-Insert] 读取 PDF 失败:', err)
      ElMessage.error(`读取 PDF 失败：${(err as Error).message || '未知错误'}`)
    } finally {
      loadingBaseCount.value = false
    }
    return
  }

  // ===== 待插入区域 =====
  const pdfs = files.filter(isPdfFile)
  const images = files.filter(isImageFile)

  // 同时选了 PDF 与图片时，优先按 PDF 处理
  if (pdfs.length > 0) {
    if (images.length) ElMessage.warning('同时选择了 PDF 与图片，本次只使用 PDF 文件')
    if (!window.pdfAPI?.pageCount) {
      ElMessage.error('PDF 解析服务未就绪，请重启 Electron 应用。')
      return
    }
    loadingInsertCount.value = true
    try {
      const buffer = await pdfs[0].arrayBuffer()
      const pageCount = await readPageCount(buffer)
      if (pageCount <= 0) {
        ElMessage.error(`PDF 中没有可用的页面：${pdfs[0].name}`)
        return
      }
      insertSource.value = { kind: 'pdf', name: pdfs[0].name, pageCount, buffer }
      mergedResult.value = null
      ElMessage.success(`已读取：${pdfs[0].name}（${pageCount} 页）`)
    } catch (err) {
      console.error('[PDF-Insert] 读取 PDF 失败:', err)
      ElMessage.error(`读取 PDF 失败：${(err as Error).message || '未知错误'}`)
    } finally {
      loadingInsertCount.value = false
    }
    return
  }

  if (!images.length) {
    ElMessage.error('请选择 PDF 或图片文件')
    return
  }

  loadingInsertCount.value = true
  try {
    const buffers: ArrayBuffer[] = []
    for (const img of images) {
      try {
        buffers.push(await readImageBuffer(img))
      } catch (err) {
        console.error('[PDF-Insert] 读取图片失败:', img.name, err)
        ElMessage.error(`读取图片失败：${img.name}`)
      }
    }
    if (!buffers.length) return

    // 已经是图片模式时继续追加，避免逐张拖拽时丢失前一张
    const prev = insertSource.value?.kind === 'image' ? insertSource.value : null
    const mergedImages = prev?.images ? [...prev.images, ...buffers] : buffers
    insertSource.value = {
      kind: 'image',
      name: mergedImages.length === 1 ? images[0].name : `${mergedImages.length} 张图片`,
      pageCount: mergedImages.length,
      images: mergedImages
    }
    mergedResult.value = null
    ElMessage.success(`已添加 ${buffers.length} 张图片（合为 ${mergedImages.length} 页）`)
  } finally {
    loadingInsertCount.value = false
  }
}

// --- 事件：点击触发文件选择 ---
const triggerFileInput = (slot: SlotKey): void => {
  if (slot === 'base') baseInput.value?.click()
  else insertInput.value?.click()
}

// --- 事件：文件选择 ---
const handleFileSelect = (event: Event, slot: SlotKey): void => {
  const target = event.target as HTMLInputElement
  void handleFiles(target.files, slot)
  target.value = ''
}

// --- 事件：拖拽放下 ---
const handleDrop = (event: DragEvent, slot: SlotKey): void => {
  dragTarget.value = null
  void handleFiles(event.dataTransfer?.files, slot)
}

// --- 事件：移除已选文件 ---
const clearFile = (slot: SlotKey): void => {
  if (slot === 'base') {
    basePdf.value = null
    insertPosition.value = null
  } else {
    insertSource.value = null
  }
  mergedResult.value = null
}

// --- 事件：合并 ---
const handleMerge = async (): Promise<void> => {
  if (!basePdf.value || !insertSource.value) {
    ElMessage.warning('请上传原 PDF，以及待插入的 PDF 或图片')
    return
  }
  if (insertPosition.value === null) {
    ElMessage.warning('请选择插入位置')
    return
  }
  if (!window.pdfAPI?.insertPdf) {
    ElMessage.error('PDF 插入服务未就绪，请重启 Electron 应用。')
    return
  }

  const outputFileName = genOutputFileName()
  const totalPageCount = basePdf.value.pageCount + insertSource.value.pageCount

  isMerging.value = true
  mergedResult.value = null
  try {
    // 待插入内容是图片时，先合成为一个临时 PDF（每张图一页），再整体插入
    let insertBuffer: ArrayBuffer
    if (insertSource.value.kind === 'image') {
      if (!window.imageAPI?.toPdf) {
        ElMessage.error('图片转 PDF 服务未就绪，请重启 Electron 应用。')
        return
      }
      // 注意：images 在 ref 中是被 Vue 响应式代理过的数组（Proxy），
      // Proxy 不能被 IPC 的结构化克隆序列化，会抛 "An object could not be cloned"。
      // 这里用 toRaw 取出原始数组并复制成普通数组后再发送。
      const rawImages = Array.from(toRaw(insertSource.value).images ?? [])
      const converted = await window.imageAPI.toPdf({
        images: rawImages,
        outputFileName
      })
      if (!converted.success || !converted.base64) {
        ElMessage.error(converted.error || '图片合成 PDF 失败')
        return
      }
      insertBuffer = base64ToArrayBuffer(converted.base64)
    } else {
      insertBuffer = toRaw(insertSource.value).buffer as ArrayBuffer
    }

    const result = await window.pdfAPI.insertPdf({
      baseBuffer: basePdf.value.buffer,
      insertBuffer,
      position: insertPosition.value,
      outputFileName
    })
    if (result.success && result.base64 && result.fileName) {
      mergedResult.value = {
        base64: result.base64,
        fileName: result.fileName,
        pageCount: totalPageCount
      }
      ElMessage.success('合并成功！')
    } else {
      ElMessage.error(result.error || '合并失败')
    }
  } catch (err) {
    console.error('[PDF-Insert] 调用异常:', err)
    ElMessage.error(`合并失败：${(err as Error).message || '未知错误'}`)
  } finally {
    isMerging.value = false
  }
}

// --- 事件：下载 / 保存 ---
const handleDownload = async (): Promise<void> => {
  if (!mergedResult.value) {
    ElMessage.warning('没有可下载的合并结果')
    return
  }
  if (!window.pdfAPI?.savePdf) {
    ElMessage.error('保存服务未就绪，请重启应用。')
    return
  }
  try {
    const result = await window.pdfAPI.savePdf({
      pdfBase64: mergedResult.value.base64,
      suggestedFileName: mergedResult.value.fileName
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

// --- 窗口级拖拽拦截：避免拖到非投放区时 Electron 导航到文件把界面刷掉 ---
const preventDragDefault = (e: DragEvent): void => {
  e.preventDefault()
}

onMounted(() => {
  document.addEventListener('dragover', preventDragDefault)
  document.addEventListener('drop', preventDragDefault)
})

onUnmounted(() => {
  document.removeEventListener('dragover', preventDragDefault)
  document.removeEventListener('drop', preventDragDefault)
  basePdf.value = null
  insertSource.value = null
  mergedResult.value = null
})
</script>

<style scoped>
.pdf-insert-layout {
  display: flex;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

.pi-panel {
  display: flex;
  flex-direction: column;
  width: 50%;
  height: 100%;
  box-sizing: border-box;
  padding: 16px 20px;
}

.pi-panel-left {
  border-right: 1px solid #e4e7ed;
}

.pi-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
}

/* ========== 左侧 ========== */
.pi-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.pi-block {
  margin-bottom: 16px;
}
.pi-block-title {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  margin-bottom: 8px;
}

/* 上传区 */
.upload-zone {
  border: 2px dashed #dcdfe6;
  border-radius: 8px;
  padding: 18px 16px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
  background: #fafafa;
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
  font-size: 30px;
  color: #409eff;
  margin-bottom: 6px;
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

/* 已选文件卡片 */
.file-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fff;
}
.file-card-icon {
  font-size: 26px;
  flex-shrink: 0;
}
.file-card-info {
  flex: 1;
  min-width: 0;
}
.file-card-name {
  font-size: 13px;
  color: #303133;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.file-card-meta {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}

/* 插入位置 */
.position-select {
  width: 100%;
}
.position-tip {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
}

/* 合并按钮区 */
.merge-action {
  flex-shrink: 0;
  text-align: center;
  padding-top: 10px;
  border-top: 1px solid #ebeef5;
}
.merge-tip {
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
  margin-bottom: 6px;
  word-break: break-all;
  line-height: 1.4;
}
.result-file-meta {
  font-size: 13px;
  color: #909399;
  margin-bottom: 22px;
}
</style>
