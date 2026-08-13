<template>
  <div class="pdf-merge-layout">
    <!-- 左侧区域：上传 + 列表 + 合并按钮 -->
    <div class="pm-panel pm-panel-left">
      <div class="pm-title">上传PDF文件</div>

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
        <div class="upload-text">拖拽PDF文件到此处</div>
        <div class="upload-sub">或 <span class="upload-link">点击选择文件</span></div>
        <input
          ref="fileInput"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          style="display: none"
          @change="handleFileSelect"
        />
      </div>

      <!-- 中：文件列表 -->
      <div class="file-list-wrap">
        <div class="file-list-header">已上传文件（{{ pdfFiles.length }}）</div>
        <div v-if="pdfFiles.length === 0" class="file-empty">暂无文件，请上传PDF</div>
        <div v-else class="file-list">
          <div v-for="(item, index) in pdfFiles" :key="item.id" class="file-item">
            <span class="file-order">{{ index + 1 }}</span>
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

      <!-- 下：合并按钮 -->
      <div class="merge-action">
        <el-button
          type="primary"
          size="large"
          :disabled="pdfFiles.length < 2 || isMerging"
          :loading="isMerging"
          @click="handleMerge"
        >
          {{ isMerging ? '合并中...' : '合并' }}
        </el-button>
        <div v-if="pdfFiles.length === 1 && !isMerging" class="merge-tip">
          请至少上传 2 个 PDF 文件
        </div>
      </div>
    </div>

    <!-- 右侧区域：合并结果 -->
    <div class="pm-panel pm-panel-right">
      <div class="pm-title">合并结果</div>
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
            <div class="result-file-name">
              {{ mergedResult.fileName }}
            </div>
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
import { ref, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled, Document, Files, Download } from '@element-plus/icons-vue'

interface PdfFileItem {
  id: string
  name: string
  size: number
  buffer: ArrayBuffer
}

interface MergedResult {
  base64: string
  fileName: string
}

// --- DOM 引用 ---
const fileInput = ref<HTMLInputElement | null>(null)

// --- 状态 ---
const isDragging = ref(false)
const isMerging = ref(false)
const pdfFiles = ref<PdfFileItem[]>([])
const mergedResult = ref<MergedResult | null>(null)

// --- 工具：生成唯一 ID ---
let idSeq = 0
const genId = (): string => `pdf_${Date.now()}_${++idSeq}`

// --- 工具：文件名超长判断（按字符估算，实际以CSS溢出为准，但tooltip用此做初筛）---
const isNameOverflow = (name: string): boolean => name.length > 22

// --- 工具：生成合并文件名 pdf_YYYYMMDD + 3位随机数 ---
const genOutputFileName = (): string => {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  return `pdf_${y}${m}${d}${rand}.pdf`
}

// --- 工具：校验是否为 PDF ---
const isPdfFile = (file: File): boolean => {
  if (file.type === 'application/pdf') return true
  return /\.pdf$/i.test(file.name)
}

// --- 添加文件（通用处理）---
const addFiles = (fileList: FileList | File[] | null): void => {
  if (!fileList) return
  const files = Array.from(fileList)
  const pdfs = files.filter(isPdfFile)
  if (pdfs.length !== files.length) {
    ElMessage.warning(`${files.length - pdfs.length} 个非 PDF 文件已被忽略`)
  }
  if (!pdfs.length) {
    if (files.length) ElMessage.error('请选择 PDF 文件')
    return
  }
  // 依次读取为 ArrayBuffer
  let loadedCount = 0
  pdfs.forEach((file) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const buf = e.target?.result as ArrayBuffer
      if (buf) {
        pdfFiles.value.push({
          id: genId(),
          name: file.name,
          size: file.size,
          buffer: buf
        })
      }
      loadedCount++
      if (loadedCount === pdfs.length) {
        // 合并完成后清掉旧结果
        mergedResult.value = null
        ElMessage.success(`已添加 ${pdfs.length} 个 PDF 文件`)
      }
    }
    reader.onerror = () => {
      loadedCount++
      ElMessage.error(`读取文件失败：${file.name}`)
    }
    reader.readAsArrayBuffer(file)
  })
}

// --- 事件：触发文件选择 ---
const triggerFileInput = (): void => {
  fileInput.value?.click()
}

// --- 事件：文件选择 ---
const handleFileSelect = (event: Event): void => {
  const target = event.target as HTMLInputElement
  addFiles(target.files)
  target.value = ''
}

// --- 事件：拖拽放下 ---
const handleDrop = (event: DragEvent): void => {
  isDragging.value = false
  addFiles(event.dataTransfer?.files ?? null)
}

// --- 事件：删除文件 ---
const removeFile = (id: string): void => {
  pdfFiles.value = pdfFiles.value.filter((f) => f.id !== id)
  // 删除后旧结果可能对应不上，一并清空
  mergedResult.value = null
}

// --- 事件：合并 ---
const handleMerge = async (): Promise<void> => {
  if (pdfFiles.value.length < 2) {
    ElMessage.warning('请至少上传 2 个 PDF 文件')
    return
  }
  if (!window.pdfAPI || !window.pdfAPI.mergePdfs) {
    ElMessage.error('PDF 合并服务未就绪，请重启 Electron 应用。')
    return
  }
  const outputFileName = genOutputFileName()
  const buffers = pdfFiles.value.map((f) => f.buffer)

  isMerging.value = true
  mergedResult.value = null
  try {
    const result = await window.pdfAPI.mergePdfs({
      pdfBuffers: buffers,
      outputFileName
    })
    if (result.success && result.base64 && result.fileName) {
      mergedResult.value = {
        base64: result.base64,
        fileName: result.fileName
      }
      ElMessage.success('合并成功！')
    } else {
      ElMessage.error(result.error || '合并失败')
    }
  } catch (err) {
    console.error('[PDF-Merge] 调用异常:', err)
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
  if (!window.pdfAPI || !window.pdfAPI.savePdf) {
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

// --- 卸载：清空大对象释放内存 ---
onUnmounted(() => {
  pdfFiles.value = []
  mergedResult.value = null
})
</script>

<style scoped>
.pdf-merge-layout {
  display: flex;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

.pm-panel {
  display: flex;
  flex-direction: column;
  width: 50%;
  height: 100%;
  box-sizing: border-box;
  padding: 16px 20px;
}

.pm-panel-left {
  border-right: 1px solid #e4e7ed;
}

.pm-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
}

/* ========== 左侧 ========== */

/* 上传区 */
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

/* 合并按钮区 */
.merge-action {
  flex-shrink: 0;
  text-align: center;
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
  margin-bottom: 24px;
  word-break: break-all;
  line-height: 1.4;
}
</style>
