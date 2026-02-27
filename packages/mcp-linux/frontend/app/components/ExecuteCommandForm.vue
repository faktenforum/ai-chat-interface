<script setup lang="ts">
import type { ExecuteCommandResponse } from '../types/index';

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
const lastResult = ref<ExecuteCommandResponse | null>(null);

const workspaceItems = computed(() =>
  (props.workspaces?.length ? props.workspaces : ['default']).map((w) => ({ label: w, value: w })),
);

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
    lastResult.value = res;
    emit('executed', res);
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to execute command';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="space-y-3">
    <div>
      <label class="mb-1 block text-sm font-medium text-default">Command</label>
      <UInput
        v-model="command"
        placeholder="e.g. ls -la"
        size="sm"
        class="w-full"
        @keydown.enter.prevent="submit"
      />
    </div>
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
    <div v-if="lastResult" class="rounded-md border border-default bg-muted/50 p-3">
      <p class="mb-1 text-xs font-medium text-muted">Output ({{ lastResult.workspace }})</p>
      <pre class="max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm">{{ lastResult.output || '(no output)' }}</pre>
    </div>
    <div class="flex gap-2">
      <UButton size="sm" :loading="loading" @click="submit">Execute</UButton>
      <UButton variant="ghost" size="sm" :disabled="loading" @click="emit('cancel')">
        {{ lastResult ? 'Close' : 'Cancel' }}
      </UButton>
    </div>
  </div>
</template>
