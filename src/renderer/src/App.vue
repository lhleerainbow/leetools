<template>
  <div class="app-layout">
    <!-- 左侧菜单区域：20% -->
    <div class="panel panel-left">
      <div class="panel-header">菜单</div>
      <div class="panel-body">
        <div
          v-for="item in mainMenuItems"
          :key="item.key"
          class="menu-item"
          :class="{ active: selectedMainMenu === item.key }"
          @click="selectMainMenu(item.key)"
        >
          <span class="menu-icon">{{ item.icon }}</span>
          <span class="menu-text">{{ item.label }}</span>
        </div>
      </div>
    </div>

    <!-- 中间区域：20% -->
    <div class="panel panel-middle">
      <!-- 选中"工具"时显示工具列表 -->
      <template v-if="selectedMainMenu === 'tools'">
        <div class="panel-header">工具列表</div>
        <div class="panel-body">
          <div
            v-for="tool in toolItems"
            :key="tool.key"
            class="menu-item"
            :class="{ active: selectedTool === tool.key }"
            @click="selectTool(tool.key)"
          >
            <span class="menu-icon">{{ tool.icon }}</span>
            <span class="menu-text">{{ tool.label }}</span>
          </div>
        </div>
      </template>
      <!-- 选中"TCP客户端"时显示客户端列表组件（自带标题+列表+按钮） -->
      <div v-else-if="selectedMainMenu === 'tcp-client'" class="tcp-list-panel">
        <TcpClientList
          :clients="tcpClients"
          :selected-id="selectedTcpClientId"
          @add="handleTcpAdd"
          @delete="handleTcpDelete"
          @select="handleTcpSelect"
        />
      </div>
      <!-- 默认 -->
      <template v-else>
        <div class="panel-header">&nbsp;</div>
        <div class="panel-body">
          <div class="placeholder-tip">请选择左侧菜单</div>
        </div>
      </template>
    </div>

    <!-- 右侧功能区域：60% -->
    <div class="panel panel-right">
      <!-- 工具菜单但未选工具：请选择工具的空态 -->
      <div v-if="selectedMainMenu === 'tools' && !selectedTool" class="placeholder-panel">
        <div class="placeholder-icon">🛠️</div>
        <div class="placeholder-title">请选择一个工具</div>
        <div class="placeholder-desc">请从左侧工具列表中选择具体工具开始使用</div>
      </div>
      <!-- 图片表格识别 -->
      <ImageTableOCR
        v-else-if="selectedMainMenu === 'tools' && selectedTool === 'image-table-ocr'"
      />
      <!-- PDF 合并 -->
      <PdfMerge v-else-if="selectedMainMenu === 'tools' && selectedTool === 'pdf-merge'" />
      <!-- TCP客户端详情 -->
      <TcpClientDetail
        v-else-if="selectedMainMenu === 'tcp-client'"
        :client="selectedTcpClient"
        @edit="handleTcpEdit"
      />
      <!-- 默认欢迎页 -->
      <div v-else class="placeholder-panel">
        <div class="placeholder-icon">👋</div>
        <div class="placeholder-title">欢迎使用 LeeTools</div>
        <div class="placeholder-desc">请从左侧菜单选择功能开始使用</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import ImageTableOCR from './components/ImageTableOCR.vue'
import PdfMerge from './components/PdfMerge.vue'
import TcpClientList, { type TcpClientConfig } from './components/TcpClientList.vue'
import TcpClientDetail from './components/TcpClientDetail.vue'

// --- 类型定义 ---
type MainMenuKey = 'tcp-client' | 'tools'
type ToolKey = 'pdf-merge' | 'image-table-ocr'

interface MainMenuItem {
  key: MainMenuKey
  label: string
  icon: string
}

interface ToolItem {
  key: ToolKey
  label: string
  icon: string
}

// --- 本地存储 key ---
const TCP_CLIENTS_STORAGE_KEY = 'leetools:tcp-clients:v1'

// --- 菜单数据 ---
const mainMenuItems: MainMenuItem[] = [
  { key: 'tcp-client', label: 'TCP客户端', icon: '🌐' },
  { key: 'tools', label: '工具', icon: '🛠️' }
]

const toolItems: ToolItem[] = [
  { key: 'pdf-merge', label: 'PDF合并', icon: '📄' },
  { key: 'image-table-ocr', label: '图片表格识别', icon: '📷' }
]

// --- 选中状态 ---
// 1) 首次进入默认选中第一个主菜单：TCP客户端
// 2) 工具默认不选任何一项，留空
// 3) TCP 客户端列表默认不自动选第一项，右侧保持"请选择一个客户端"
const selectedMainMenu = ref<MainMenuKey>('tcp-client')
const selectedTool = ref<ToolKey | null>(null)

// --- TCP 客户端状态 ---
const tcpClients = ref<TcpClientConfig[]>([])
const selectedTcpClientId = ref<string | null>(null)
const selectedTcpClient = computed<TcpClientConfig | null>(() => {
  if (!selectedTcpClientId.value) return null
  return tcpClients.value.find((c) => c.id === selectedTcpClientId.value) ?? null
})

// --- TCP 本地存储（启动时加载，变化时保存）---
onMounted(() => {
  try {
    const raw = localStorage.getItem(TCP_CLIENTS_STORAGE_KEY)
    if (!raw) return
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return
    // 基本字段校验，避免脏数据导致后续报错
    const valid: TcpClientConfig[] = []
    for (const item of arr) {
      if (
        item &&
        typeof item.id === 'string' &&
        typeof item.remark === 'string' &&
        typeof item.host === 'string' &&
        typeof item.port === 'number'
      ) {
        valid.push(item as TcpClientConfig)
      }
    }
    tcpClients.value = valid
    // 按需求：加载后不自动选中第一项，右侧保持"请选择一个客户端"的空态
    // 后续用户手动点击或新增/删除时再维护 selectedTcpClientId
  } catch (err) {
    console.error('[TCP-Storage] 加载失败:', err)
  }
})

watch(
  tcpClients,
  (list) => {
    try {
      localStorage.setItem(TCP_CLIENTS_STORAGE_KEY, JSON.stringify(list))
    } catch (err) {
      console.error('[TCP-Storage] 保存失败:', err)
    }
  },
  { deep: true }
)

// --- 菜单切换方法 ---
const selectMainMenu = (key: MainMenuKey): void => {
  selectedMainMenu.value = key
  // 按需求：切到"工具"时不再默认给用户选择工具，保持未选中状态
}

const selectTool = (key: ToolKey): void => {
  selectedTool.value = key
}

// --- TCP 事件处理 ---
const handleTcpAdd = (config: TcpClientConfig): void => {
  tcpClients.value.push(config)
  // 新增后自动选中
  selectedTcpClientId.value = config.id
}

const handleTcpDelete = (id: string): void => {
  const idx = tcpClients.value.findIndex((c) => c.id === id)
  if (idx >= 0) tcpClients.value.splice(idx, 1)
}

const handleTcpSelect = (id: string | null): void => {
  selectedTcpClientId.value = id
}

const handleTcpEdit = (updated: TcpClientConfig): void => {
  const idx = tcpClients.value.findIndex((c) => c.id === updated.id)
  if (idx >= 0) {
    tcpClients.value[idx] = updated
  }
}
</script>

<style scoped>
.app-layout {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* 通用面板样式 */
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  min-height: 0;
  overflow: hidden;
}

.panel-left {
  width: 20%;
  min-width: 160px;
  border-right: 1px solid #e4e7ed;
  background-color: #f5f7fa;
}

.panel-middle {
  width: 20%;
  min-width: 160px;
  border-right: 1px solid #e4e7ed;
  background-color: #fafbfc;
}

/* TCP 客户端列表外层容器：
   flex:1 + min-height:0 让它在 panel-middle(flex-column) 中占满剩余高度；
   自身也是 flex-column，把高度传递给子组件 .tcp-list-wrap(height:100%)。
   min-height:0 是必须的——否则 flex item 默认 min-height:auto 会阻止收缩。 */
.tcp-list-panel {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.panel-right {
  flex: 1;
  background-color: #ffffff;
  overflow: hidden;
}

.panel-header {
  padding: 14px 16px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  border-bottom: 1px solid #e4e7ed;
  background-color: #ffffff;
  flex-shrink: 0;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

/* 菜单项样式 */
.menu-item {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 14px;
  color: #606266;
  border-left: 3px solid transparent;
}

.menu-item:hover {
  background-color: #ecf5ff;
  color: #409eff;
}

.menu-item.active {
  background-color: #409eff;
  color: #ffffff;
  border-left-color: #337ecc;
  font-weight: 500;
}

.menu-icon {
  margin-right: 10px;
  font-size: 16px;
}

.menu-text {
  flex: 1;
}

/* 占位提示 */
.placeholder-tip {
  padding: 20px 16px;
  text-align: center;
  color: #909399;
  font-size: 13px;
}

.placeholder-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #909399;
  padding: 20px;
  box-sizing: border-box;
}

.placeholder-icon {
  font-size: 64px;
  margin-bottom: 20px;
  opacity: 0.6;
}

.placeholder-title {
  font-size: 22px;
  font-weight: 600;
  color: #606266;
  margin-bottom: 12px;
}

.placeholder-desc {
  font-size: 14px;
  color: #909399;
}
</style>
