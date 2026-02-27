<script setup lang="ts">
import type { ExecuteCommandResponse } from '../types/index';
import { stripAnsi } from '../composables/useTerminalOutput';

const props = defineProps<{
  workspaces: string[];
}>();

const emit = defineEmits<{
  executed: [response: ExecuteCommandResponse];
  cancel: [];
}>();

const { postJson } = useStatusApi();

const command = ref('');
const workspace = ref('default');
const timeoutMs = ref(60000);
const loading = ref(false);
const errorMsg = ref('');
const outputHistory = ref('');
const outputEl = ref<HTMLPreElement | null>(null);

const workspaceItems = computed(() =>
  (props.workspaces?.length ? props.workspaces : ['default']).map((w) => ({ label: w, value: w })),
);

function scrollOutputToBottom() {
  nextTick(() => {
    if (outputEl.value) outputEl.value.scrollTop = outputEl.value.scrollHeight;
  });
}

async function submit() {
  const cmd = command.value.trim();
  if (!cmd) {
    errorMsg.value = 'Command is required';
    return;
  }
  errorMsg.value = '';
  loading.value = true;
  try {
    const res = await postJson<ExecuteCommandResponse>('/status/api/execute-command', {
      command: cmd,
      workspace: workspace.value,
      timeout_ms: timeoutMs.value,
    });
    const text = stripAnsi(res.output ?? '') || '';
    outputHistory.value += (outputHistory.value ? '\n' : '') + text;
    command.value = '';
    emit('executed', res);
    scrollOutputToBottom();
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to execute command';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="grid gap-2 sm:grid-cols-2">
      <div>
        <label class="mb-1 block text-sm font-medium text-default">Workspace</label>
        <USelect
          v-model="workspace"
          :items="workspaceItems"
          size="sm"
          class="w-full"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium text-default">Timeout (ms)</label>
        <UInput
          v-model.number="timeoutMs"
          type="number"
          min="1000"
          size="sm"
          class="w-32"
        />
      </div>
    </div>
    <UAlert v-if="errorMsg" color="error" :description="errorMsg" icon="i-lucide-alert-circle" />
    <div class="rounded-md border border-default bg-muted/50 p-3">
      <p class="mb-1 text-xs font-medium text-muted">Output ({{ workspace }})</p>
      <pre
        ref="outputEl"
        class="max-h-64 overflow-auto overflow-x-auto whitespace-pre-wrap break-words text-sm"
      >{{ outputHistory || '(no output yet)' }}</pre>
    </div>
    <div class="flex gap-2">
      <UInput
        v-model="command"
        placeholder="e.g. ls -la"
        size="sm"
        class="min-w-0 flex-1"
        :disabled="loading"
        @keydown.enter.prevent="submit"
      />
      <UButton size="sm" :loading="loading" @click="submit">Execute</UButton>
    </div>
    <div class="flex gap-2">
      <UButton variant="ghost" size="sm" :disabled="loading" @click="emit('cancel')">
        {{ outputHistory ? 'Close' : 'Cancel' }}
      </UButton>
    </div>
  </div>
</template>
