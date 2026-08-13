<template>
  <div class="tcp-list-wrap">
    <!-- 上：标题（顶部固定） -->
    <div class="tcp-header">客户端列表</div>

    <!-- 中：列表（仅此区域滚动） -->
    <div class="tcp-body">
      <div v-if="!clients.length" class="tcp-empty">暂无客户端，请点击 + 添加</div>
      <div v-else class="tcp-list">
        <div
          v-for="item in clients"
          :key="item.id"
          class="tcp-item"
          :class="{ active: item.id === selectedId }"
          @click="handleSelect(item.id)"
        >
          <div class="tcp-item-remark" :title="item.remark">
            {{ item.remark }}
          </div>
          <div class="tcp-item-addr" :title="`${item.host}:${item.port}`">
            {{ item.host }}:{{ item.port }}
          </div>
        </div>
      </div>
    </div>

    <!-- 下：+ / - 按钮（底部固定） -->
    <div class="tcp-actions">
      <el-button type="primary" :icon="Plus" circle size="large" @click="openAddDialog" />
      <el-button
        type="danger"
        :icon="Minus"
        circle
        size="large"
        :disabled="!selectedId"
        @click="confirmDelete"
      />
    </div>

    <!-- 添加对话框 -->
    <el-dialog
      v-model="addDialogVisible"
      title="添加配置"
      width="420px"
      :close-on-click-modal="false"
      @closed="resetAddForm"
    >
      <el-form
        ref="addFormRef"
        :model="addForm"
        :rules="addRules"
        label-width="80px"
        label-position="right"
      >
        <el-form-item label="备注" prop="remark">
          <el-input
            v-model="addForm.remark"
            placeholder="请输入备注，例如：测试服务器"
            maxlength="64"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="主机地址" prop="host">
          <el-input v-model="addForm.host" placeholder="请输入 IP 地址，例如：192.168.1.100" />
        </el-form-item>
        <el-form-item label="端口" prop="port">
          <el-input-number
            v-model="addForm.port"
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
        <el-button @click="addDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitAdd">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { Plus, Minus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'

export interface TcpClientConfig {
  id: string
  remark: string
  host: string
  port: number
}

interface Props {
  clients: TcpClientConfig[]
  selectedId: string | null
}
const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'add', config: TcpClientConfig): void
  (e: 'delete', id: string): void
  (e: 'select', id: string | null): void
}>()

// ============== 选中 ==============
const handleSelect = (id: string): void => {
  emit('select', id)
}

// ============== 添加对话框 ==============
const addDialogVisible = ref(false)
const submitting = ref(false)
const addFormRef = ref<FormInstance>()
const addForm = reactive<{ remark: string; host: string; port: number | null }>({
  remark: '',
  host: '',
  port: null
})

// 简单 IPv4 校验（4 段 0~255）；如需要支持 IPv6 可扩展
const ipv4Regex = /^((25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/

const addRules: FormRules = {
  remark: [
    { required: true, message: '请输入备注', trigger: 'blur' },
    { type: 'string', max: 64, message: '备注最长 64 个字符', trigger: 'blur' }
  ],
  host: [
    { required: true, message: '请输入主机地址', trigger: 'blur' },
    {
      validator: (_rule, value, cb) => {
        if (!value) return cb()
        if (ipv4Regex.test(String(value))) return cb()
        cb(new Error('请输入合法的 IPv4 地址'))
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

const openAddDialog = (): void => {
  addDialogVisible.value = true
}

const resetAddForm = (): void => {
  addForm.remark = ''
  addForm.host = ''
  addForm.port = null
  addFormRef.value?.resetFields()
  submitting.value = false
}

let idSeq = 0
const genId = (): string => `tcp_${Date.now()}_${++idSeq}`

const submitAdd = async (): Promise<void> => {
  if (!addFormRef.value) return
  try {
    await addFormRef.value.validate()
  } catch {
    return
  }
  submitting.value = true
  try {
    if (addForm.port === null || addForm.port === undefined) {
      ElMessage.warning('请输入端口')
      return
    }
    const config: TcpClientConfig = {
      id: genId(),
      remark: addForm.remark.trim(),
      host: addForm.host.trim(),
      port: Number(addForm.port)
    }
    emit('add', config)
    ElMessage.success('添加成功')
    addDialogVisible.value = false
  } catch (err) {
    console.error('[TCP-Add] 校验或保存失败:', err)
  } finally {
    submitting.value = false
  }
}

// ============== 删除确认 ==============
const confirmDelete = (): void => {
  if (!props.selectedId) return
  const target = props.clients.find((c) => c.id === props.selectedId)
  if (!target) return
  const remark = target.remark
  ElMessageBox.confirm(`确定要删除 ${remark} 客户端吗？`, '删除确认', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    confirmButtonClass: 'el-button--danger'
  })
    .then(() => {
      emit('delete', props.selectedId as string)
      ElMessage.success(`已删除 ${remark}`)
    })
    .catch(() => {
      // 用户取消
    })
}

// 当列表清空后，如果当前选中已被删，应通知父级取消选中
watch(
  () => props.clients,
  (list) => {
    if (props.selectedId && !list.some((c) => c.id === props.selectedId)) {
      emit('select', null)
    }
  },
  { deep: true }
)
</script>

<style scoped>
/* ============================================================
   标准 flexbox 三段式布局（全链路 flex:1 + min-height:0，不依赖 height:100%）：
   .tcp-list-wrap   flex:1; min-height:0; display:flex; flex-direction:column
   ├── .tcp-header   flex-shrink:0; height:50px     —— 标题固定顶部
   ├── .tcp-body     flex:1; min-height:0; overflow-y:auto  —— 中间自适应，独立滚动
   └── .tcp-actions  flex-shrink:0; height:72px     —— 按钮固定底部

   关键：min-height:0 是让 flex item 能缩小到内容以下的核心属性，
   没有它 flex item 默认 min-height:auto 会导致内容撑破容器、滚动条溢出到窗口。
   注意：不能用 height:100%——父级是 flex:1（无显式 height 属性），
   Chromium 会把 height:100% 解析为 auto，导致整条高度链断裂。
   ============================================================ */

.tcp-list-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
  overflow: hidden;
}

/* ========= 顶部标题 ========= */
.tcp-header {
  flex-shrink: 0;
  height: 50px;
  padding: 14px 16px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  border-bottom: 1px solid #e4e7ed;
  background-color: #ffffff;
  box-sizing: border-box;
  line-height: 1.4;
}

/* ========= 中间列表区（唯一可滚动的区域） ========= */
.tcp-body {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 8px 0;
  border-bottom: 1px solid #ebeef5;
  box-sizing: border-box;
  background: #fff;
}

.tcp-empty {
  padding: 20px 16px;
  text-align: center;
  color: #909399;
  font-size: 13px;
}

.tcp-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 6px;
}

.tcp-item {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition:
    background 0.15s,
    border-left-color 0.15s;
  border-left: 3px solid transparent;
  background: #fff;
}
.tcp-item:hover {
  background: #ecf5ff;
}
.tcp-item.active {
  background: #409eff;
  border-left-color: #337ecc;
}
.tcp-item.active .tcp-item-remark,
.tcp-item.active .tcp-item-addr {
  color: #fff;
}

.tcp-item-remark {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
  margin-bottom: 4px;
}

.tcp-item-addr {
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
}

/* ========= 底部按钮区（固定在最下方） ========= */
.tcp-actions {
  flex-shrink: 0;
  height: 72px;
  box-sizing: border-box;
  padding: 12px 0 14px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  background: #fafbfc;
}
</style>
