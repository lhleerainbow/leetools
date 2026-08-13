<template>
  <div class="tcp-detail-wrap">
    <!-- 未选中客户端 -->
    <div v-if="!client" class="detail-empty">
      <el-icon :size="56" class="empty-icon"><Monitor /></el-icon>
      <div class="empty-title">请在左侧选择一个 TCP 客户端</div>
      <div class="empty-desc">或点击 + 添加新的客户端配置</div>
    </div>

    <!-- 选中客户端：三段式 1:3:1 布局 -->
    <div v-else class="detail-layout">
      <!-- ======== 上：1/5（1:3:1 中的 1） ======== -->
      <section class="detail-section detail-top">
        <!-- 左：备注 + IP:端口 + 连接状态（已连接高亮） -->
        <div class="top-info">
          <div class="top-remark" :title="client.remark">{{ client.remark }}</div>
          <div class="top-addr" :title="`${client.host}:${client.port}`">
            <el-icon><Monitor /></el-icon>
            <span class="addr-mono">{{ client.host }}:{{ client.port }}</span>
          </div>
          <div class="top-status">
            <span class="status-label">连接状态：</span>
            <el-tag
              v-if="connected"
              type="success"
              effect="dark"
              size="default"
              round
              class="status-tag status-tag-online"
            >
              <span class="status-dot" />
              已连接
            </el-tag>
            <el-tag v-else type="info" size="default" round class="status-tag"> 未连接 </el-tag>
          </div>
        </div>
        <!-- 右：三个按钮 -->
        <div class="top-actions">
          <el-button :icon="Edit" @click="openEditDialog">编辑</el-button>
          <el-button
            v-if="!connected"
            type="primary"
            :icon="Connection"
            :loading="connecting"
            @click="doConnect"
          >
            连接
          </el-button>
          <el-button v-else type="danger" :icon="Close" @click="doDisconnect">断开连接</el-button>
          <el-button :icon="Delete" @click="doClearMessages">清空消息</el-button>
        </div>
      </section>

      <!-- ======== 中：3/5（1:3:1 中的 3，聊天窗口） ======== -->
      <section ref="chatWrap" class="detail-section detail-mid">
        <div v-if="!messages.length" class="chat-empty">
          暂无通讯记录，连接后可与服务端进行 16 进制数据交互
        </div>
        <div v-else class="chat-list">
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="chat-item"
            :class="msg.direction === 'send' ? 'chat-item-send' : 'chat-item-recv'"
          >
            <div class="chat-time">{{ formatTime(msg.time) }}</div>
            <div
              class="chat-bubble"
              :title="`${msg.direction === 'send' ? '发送' : '接收'}：${msg.hex}`"
            >
              <span class="chat-meta">{{ msg.direction === 'send' ? '发送' : '接收' }}</span>
              <div class="chat-hex">{{ msg.hex }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- ======== 下：1/5（1:3:1 中的 1，输入+发送） ======== -->
      <section class="detail-section detail-bottom">
        <div class="bottom-input-wrap">
          <el-input
            v-model="hexInputRaw"
            type="textarea"
            :rows="3"
            resize="none"
            placeholder="请输入16进制内容，允许空格分隔，例如：01 02 03  或 010203"
            :disabled="!connected"
            class="hex-input"
            @input="onHexInput"
            @keydown.enter.ctrl="doSend"
          />
          <div class="hex-tip">
            仅允许 0-9 / a-f / A-F。Ctrl + Enter 快速发送。
            <span v-if="sendBytes" class="hex-counter">已输入 {{ sendBytes }} 字节</span>
          </div>
        </div>
        <div class="bottom-send-wrap">
          <el-button
            type="primary"
            size="large"
            :icon="Promotion"
            :disabled="!connected || !sendBytes"
            :loading="sending"
            @click="doSend"
          >
            发送
          </el-button>
        </div>
      </section>
    </div>

    <!-- ======== 编辑弹窗（同添加配置的表单） ======== -->
    <el-dialog
      v-model="editDialogVisible"
      title="编辑配置"
      width="420px"
      :close-on-click-modal="false"
      @closed="resetEditForm"
    >
      <el-form
        ref="editFormRef"
        :model="editForm"
        :rules="editRules"
        label-width="80px"
        label-position="right"
      >
        <el-form-item label="备注" prop="remark">
          <el-input
            v-model="editForm.remark"
            placeholder="请输入备注，例如：测试服务器"
            maxlength="64"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="主机地址" prop="host">
          <el-input v-model="editForm.host" placeholder="请输入 IP 地址，例如：192.168.1.100" />
        </el-form-item>
        <el-form-item label="端口" prop="port">
          <el-input-number
            v-model="editForm.port"
            :min="0"
            :max="65535"
            :step="1"
            :precision="0"
            controls-position="right"
            style="width: 100%"
            placeholder="请输入 0 ~ 65535 之间的端口"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { Connection, Close, Delete, Edit, Monitor, Promotion } from '@element-plus/icons-vue'
import type { TcpClientConfig } from './TcpClientList.vue'

// ============================================================
// 类型定义
// ============================================================
export interface TcpChatMessage {
  id: string
  direction: 'send' | 'recv' | 'system'
  hex: string
  time: number
}

interface Props {
  client: TcpClientConfig | null
}
const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'edit', updated: TcpClientConfig): void
}>()

// ============================================================
// 状态：连接 / 加载
// ============================================================
const connected = ref(false)
const connecting = ref(false)
const sending = ref(false)

// ============================================================
// 聊天消息（per clientId 的 sessionStorage 持久化）
// sessionStorage 在关闭应用/标签时清空，符合“切换菜单保留但关闭应用丢弃”。
// ============================================================
const MSG_STORAGE_PREFIX = 'leetools:tcp-chat:'
const messages = ref<TcpChatMessage[]>([])

const msgStorageKey = computed<string>(() => MSG_STORAGE_PREFIX + (props.client?.id || '__none__'))

function loadMessages(): void {
  if (!props.client) {
    messages.value = []
    return
  }
  try {
    const raw = sessionStorage.getItem(msgStorageKey.value)
    if (!raw) {
      messages.value = []
      return
    }
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) {
      messages.value = []
      return
    }
    messages.value = arr.filter(
      (m) =>
        m &&
        typeof m.id === 'string' &&
        typeof m.time === 'number' &&
        typeof m.hex === 'string' &&
        ['send', 'recv', 'system'].includes(String(m.direction))
    ) as TcpChatMessage[]
  } catch {
    messages.value = []
  }
}

function saveMessages(): void {
  try {
    sessionStorage.setItem(msgStorageKey.value, JSON.stringify(messages.value))
  } catch {
    /* ignore quota */
  }
}

function pushMessage(direction: TcpChatMessage['direction'], hex: string): void {
  messages.value.push({
    id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    direction,
    hex,
    time: Date.now()
  })
  saveMessages()
  // 滚动到底部
  nextTick(() => {
    const el = chatWrap.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// 切换 client 时重新从 sessionStorage 载入，并刷新连接状态显示
watch(
  () => props.client?.id,
  async (newId) => {
    loadMessages()
    if (newId && typeof window !== 'undefined' && window.tcpAPI) {
      try {
        const r = await window.tcpAPI.isConnected({ clientId: newId })
        connected.value = !!r?.connected
      } catch {
        connected.value = false
      }
    } else {
      connected.value = false
    }
  },
  { immediate: true }
)

// ============================================================
// 编辑弹窗
// ============================================================
const editDialogVisible = ref(false)
const submitting = ref(false)
const editFormRef = ref<FormInstance>()
const editForm = reactive<{ remark: string; host: string; port: number | null }>({
  remark: '',
  host: '',
  port: null
})

const ipv4Regex = /^((25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/

const editRules: FormRules = {
  remark: [
    { required: true, message: '请输入备注', trigger: 'blur' },
    { type: 'string', max: 64, message: '备注最长 64 个字符', trigger: 'blur' }
  ],
  host: [
    { required: true, message: '请输入主机地址', trigger: 'blur' },
    {
      validator: (_r, v, cb) => {
        if (!v) return cb()
        ipv4Regex.test(String(v)) ? cb() : cb(new Error('请输入合法的 IPv4 地址'))
      },
      trigger: 'blur'
    }
  ],
  port: [
    { required: true, message: '请输入端口', trigger: 'blur' },
    {
      type: 'number',
      min: 0,
      max: 65535,
      message: '端口必须是 0 ~ 65535 之间的整数',
      trigger: 'blur'
    }
  ]
}

function openEditDialog(): void {
  if (!props.client) return
  // 如果已连接，修改连接参数前先断开，避免旧连接继续通信
  if (connected.value) {
    doDisconnect()
  }
  editForm.remark = props.client.remark
  editForm.host = props.client.host
  editForm.port = props.client.port
  editDialogVisible.value = true
}

function resetEditForm(): void {
  editForm.remark = ''
  editForm.host = ''
  editForm.port = null
  editFormRef.value?.resetFields()
  submitting.value = false
}

async function submitEdit(): Promise<void> {
  if (!props.client || !editFormRef.value) return
  try {
    await editFormRef.value.validate()
  } catch {
    return
  }
  if (editForm.port === null || editForm.port === undefined) {
    ElMessage.warning('请输入端口')
    return
  }
  submitting.value = true
  try {
    const updated: TcpClientConfig = {
      id: props.client.id,
      remark: editForm.remark.trim(),
      host: editForm.host.trim(),
      port: Number(editForm.port)
    }
    emit('edit', updated)
    ElMessage.success('保存成功')
    editDialogVisible.value = false
  } finally {
    submitting.value = false
  }
}

// ============================================================
// 连接 / 断开
// ============================================================
async function doConnect(): Promise<void> {
  if (!props.client) return
  if (connected.value || connecting.value) return
  if (typeof window === 'undefined' || !window.tcpAPI) {
    ElMessage.error('当前环境不支持 TCP API，请在 Electron 中使用')
    return
  }
  connecting.value = true
  try {
    const r = await window.tcpAPI.connect({
      clientId: props.client.id,
      host: props.client.host,
      port: props.client.port
    })
    if (!r?.success) {
      ElMessage.error(r?.error || '连接失败')
    } else {
      pushMessage('system', `→ 正在连接 ${props.client.host}:${props.client.port} ...`)
    }
  } catch (err) {
    ElMessage.error(`连接失败：${(err as Error).message}`)
  } finally {
    // connecting 状态会在 connect/close 事件中真正重置（异步）
    setTimeout(() => {
      connecting.value = false
    }, 500)
  }
}

async function doDisconnect(): Promise<void> {
  if (!props.client) return
  if (typeof window === 'undefined' || !window.tcpAPI) {
    connected.value = false
    return
  }
  try {
    await window.tcpAPI.disconnect({ clientId: props.client.id })
  } catch (err) {
    console.error('[TCP] 断开失败:', err)
  }
  connected.value = false
  pushMessage('system', '← 已断开连接')
}

// ============================================================
// 清空消息
// ============================================================
function doClearMessages(): void {
  messages.value = []
  saveMessages()
  ElMessage.success('已清空消息')
}

// ============================================================
// 16 进制输入 + 发送
// ============================================================
const hexInputRaw = ref('')
const sendBytes = computed<number>(() => {
  const clean = hexInputRaw.value.replace(/[^0-9a-fA-F]/g, '')
  return clean.length % 2 === 0 ? clean.length / 2 : Math.floor(clean.length / 2)
})

/** 16 进制输入自动格式化：保留 0-9a-fA-F，每两位加空格，大写 */
function onHexInput(): void {
  const raw = hexInputRaw.value || ''
  const clean = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
  if (clean === raw.replace(/\s+/g, '').toUpperCase()) {
    // 格式化成 "41 42 43" 形式展示
    const formatted = clean.replace(/(.{2})/g, '$1 ').trim()
    if (formatted !== raw) hexInputRaw.value = formatted
  }
}

async function doSend(): Promise<void> {
  if (!props.client) return
  if (!connected.value) {
    ElMessage.warning('请先连接服务端')
    return
  }
  const clean = hexInputRaw.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
  if (!clean.length) {
    ElMessage.warning('请输入要发送的 16 进制数据')
    return
  }
  if (clean.length % 2 !== 0) {
    ElMessage.warning('16 进制长度必须为偶数（两位一个字节）')
    return
  }
  if (typeof window === 'undefined' || !window.tcpAPI) {
    ElMessage.error('当前环境不支持 TCP API，请在 Electron 中使用')
    return
  }
  sending.value = true
  try {
    const r = await window.tcpAPI.send({ clientId: props.client.id, hex: clean })
    if (!r?.success) {
      ElMessage.error(r?.error || '发送失败')
      return
    }
    // 展示格式化后的 hex（空格分隔）
    const displayHex = clean.replace(/(.{2})/g, '$1 ').trim()
    pushMessage('send', displayHex)
    hexInputRaw.value = ''
  } catch (err) {
    ElMessage.error(`发送失败：${(err as Error).message}`)
  } finally {
    sending.value = false
  }
}

// ============================================================
// 事件监听：连接/关闭/错误/接收数据
// ============================================================
let offTcpEvent: (() => void) | null = null

function handleTcpEvent(evt: {
  clientId: string
  type: 'connect' | 'close' | 'error' | 'data'
  hadError?: boolean
  message?: string
  hex?: string
}): void {
  if (!props.client || evt.clientId !== props.client.id) return
  switch (evt.type) {
    case 'connect':
      connecting.value = false
      connected.value = true
      pushMessage('system', `✓ 已连接到 ${props.client.host}:${props.client.port}`)
      break
    case 'close':
      connecting.value = false
      connected.value = false
      pushMessage('system', evt.hadError ? '✗ 连接异常断开' : '← 连接已关闭')
      break
    case 'error':
      if (!connected.value) connecting.value = false
      pushMessage('system', `✗ 错误：${evt.message || '未知错误'}`)
      ElMessage.error(`连接错误：${evt.message || '未知错误'}`)
      break
    case 'data':
      if (evt.hex !== undefined && evt.hex !== null && evt.hex !== '') {
        pushMessage('recv', evt.hex)
      }
      break
  }
}

function bindTcpEvent(): void {
  if (typeof window === 'undefined' || !window.tcpAPI) return
  if (offTcpEvent) return
  offTcpEvent = window.tcpAPI.onEvent(handleTcpEvent)
}

bindTcpEvent()

onBeforeUnmount(() => {
  if (offTcpEvent) {
    offTcpEvent()
    offTcpEvent = null
  }
})

// ============================================================
// 工具函数
// ============================================================
const chatWrap = ref<HTMLElement | null>(null)

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}
function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}
</script>

<style scoped>
/* ============================================================
   外层容器：占满整个右侧 panel（panel-right）
   ============================================================ */
.tcp-detail-wrap {
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  box-sizing: border-box;
}

/* 未选中空状态 */
.detail-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #909399;
  min-height: 0;
}
.empty-icon {
  opacity: 0.45;
  margin-bottom: 16px;
}
.empty-title {
  font-size: 18px;
  font-weight: 500;
  color: #606266;
  margin-bottom: 6px;
}
.empty-desc {
  font-size: 13px;
  color: #909399;
}

/* ============================================================
   选中客户端：三段式 1:3:1 布局
   使用 flex + 权重 flex 实现 1:3:1；加 min-height:0 防溢出
   ============================================================ */
.detail-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  overflow: hidden;
}

.detail-section {
  width: 100%;
  box-sizing: border-box;
  min-height: 0;
}

/* 上：1/5 */
.detail-top {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid #e4e7ed;
  background: #fafbfc;
  flex-shrink: 0;
}

/* 中：3/5 —— 聊天窗口 */
.detail-mid {
  flex: 3;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 16px 20px;
  background: #f5f7fa;
}

/* 下：1/5 —— 输入 + 发送 */
.detail-bottom {
  flex: 1;
  display: flex;
  align-items: stretch;
  gap: 16px;
  padding: 14px 20px;
  border-top: 1px solid #e4e7ed;
  background: #ffffff;
  flex-shrink: 0;
}

/* ============================================================
   顶部：左侧信息 + 右侧按钮
   ============================================================ */
.top-info {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto auto;
  column-gap: 10px;
  row-gap: 4px;
  align-items: center;
}
.top-remark {
  grid-column: 1 / -1;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.top-addr {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
  white-space: nowrap;
  overflow: hidden;
}
.addr-mono {
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  color: #409eff;
}
.top-status {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
  margin-top: 2px;
}
.status-label {
  color: #909399;
}
.status-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.status-tag-online {
  background: #67c23a;
  border-color: #67c23a;
  color: #fff;
  padding: 0 12px;
  box-shadow: 0 0 0 3px rgba(103, 194, 58, 0.12);
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 0 6px #fff;
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(1.15);
  }
}

.top-actions {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

/* ============================================================
   聊天窗口（微信风格）
   ============================================================ */
.chat-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
  font-size: 13px;
  padding: 30px;
  text-align: center;
}

.chat-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chat-item {
  display: flex;
  flex-direction: column;
  max-width: 100%;
}
.chat-item-recv {
  align-items: flex-start;
}
.chat-item-send {
  align-items: flex-end;
}

.chat-time {
  font-size: 11px;
  color: #b1b3b8;
  margin-bottom: 4px;
  padding: 0 6px;
}

.chat-bubble {
  max-width: 80%;
  min-width: 120px;
  padding: 8px 12px;
  border-radius: 10px;
  word-break: break-all;
  box-sizing: border-box;
  position: relative;
  font-size: 13px;
  line-height: 1.55;
}

.chat-item-recv .chat-bubble {
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-top-left-radius: 4px;
  color: #303133;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}

.chat-item-send .chat-bubble {
  background: #409eff;
  color: #fff;
  border-top-right-radius: 4px;
  box-shadow: 0 1px 2px rgba(64, 158, 255, 0.18);
}

.chat-meta {
  display: block;
  font-size: 11px;
  margin-bottom: 4px;
  opacity: 0.75;
}
.chat-hex {
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  letter-spacing: 0.5px;
  word-break: break-all;
  white-space: pre-wrap;
}

/* 系统气泡（居中灰色） */
.chat-item:has(.chat-bubble .chat-meta:empty) {
  /* system message 通过样式另做处理，这里统一走 recv 样式即可 */
}

/* ============================================================
   底部：输入 + 发送
   ============================================================ */
.bottom-input-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hex-input :deep(.el-textarea__inner) {
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  letter-spacing: 0.5px;
  font-size: 13px;
  line-height: 1.5;
}
.hex-tip {
  font-size: 12px;
  color: #909399;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hex-counter {
  color: #606266;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
}

.bottom-send-wrap {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 100px;
}
</style>
