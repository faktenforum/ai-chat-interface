<script setup lang="ts">
import type { ExecuteCommandResponse, ReadTerminalOutputResponse, TerminalInfo } from '../types/index';
import { stripAnsi } from '../composables/useTerminalOutput';

const props = defineProps<{
  terminal: TerminalInfo;
}>();

const { postJson } = useStatusApi();

const terminalId = computed(() => props.terminal.terminal_id ?? props.terminal.id ?? '');
const workspace = computed(() => props.terminal.workspace ?? 'default');

const output = ref('');
const command = ref('');
const loading = ref(false);
const loadingOutput = ref(false);
const errorMsg = ref('');
const outputEl = ref<HTMLPreElement | null>(null);

function scrollOutputToBottom() {
  nextTick(() => {
    if (outputEl.value) outputEl.value.scrollTop = outputEl.value.scrollHeight;
  });
}

async function fetchOutput() {
  if (!terminalId.value) return;
  loadingOutput.value = true;
  errorMsg.value = '';
  try {
    const res = await postJson<ReadTerminalOutputResponse>('/status/api/read-terminal-output', {
      terminal_id: terminalId.value,
      offset: 0,
    });
    output.value = stripAnsi(res.output ?? '');
    scrollOutputToBottom();
  } catch {
    output.value = '(failed to load output)';
  } finally {
    loadingOutput.value = false;
  }
}

async function runCommand() {
  const cmd = command.value.trim();
  if (!cmd) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    const res = await postJson<ExecuteCommandResponse>('/status/api/execute-command', {
      command: cmd,
      terminal_id: terminalId.value,
      workspace: workspace.value,
      timeout_ms: 60000,
    });
    output.value += (stripAnsi(res.output ?? '') || '') + '\n';
    command.value = '';
    scrollOutputToBottom();
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Command failed';
  } finally {
    loading.value = false;
  }
}

onMounted(() => fetchOutput());
</script>

<template>
  <div class="space-y-2 rounded-md border border-default bg-muted/30 p-3">
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs font-medium text-muted">Output</span>
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-refresh-cw"
        :loading="loadingOutput"
        @click="fetchOutput"
      >
        Refresh
      </UButton>
    </div>
    <pre
      ref="outputEl"
      class="max-h-64 overflow-auto overflow-x-auto whitespace-pre-wrap break-words rounded border border-default bg-default/50 p-2 text-sm"
    >{{ loadingOutput && !output ? 'Loading...' : output || '(no output yet)' }}</pre>
    <div class="flex gap-2">
      <UInput
        v-model="command"
        placeholder="Enter command..."
        size="sm"
        class="min-w-0 flex-1"
        :disabled="loading"
        @keydown.enter.prevent="runCommand"
      />
      <UButton size="sm" :loading="loading" @click="runCommand">Run</UButton>
    </div>
    <UAlert v-if="errorMsg" color="error" :description="errorMsg" icon="i-lucide-alert-circle" />
  </div>
</template>
