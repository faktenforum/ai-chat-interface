<script setup lang="ts">
import type { ExecuteCommandResponse, TerminalInfo } from '../types/index';

defineProps<{
  terminals: TerminalInfo[];
  workspaces: string[];
}>();

const emit = defineEmits<{
  kill: [terminalId: string];
  execute: [response: ExecuteCommandResponse];
}>();

const showExecuteForm = ref(false);
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold">Active Terminals</span>
        <UButton
          v-if="!showExecuteForm"
          variant="ghost"
          size="xs"
          icon="i-lucide-terminal"
          @click="showExecuteForm = true"
        >
          Execute command
        </UButton>
      </div>
    </template>
    <ExecuteCommandForm
      v-if="showExecuteForm"
      :workspaces="workspaces"
      @executed="(r) => { emit('execute', r); showExecuteForm = false; }"
      @cancel="showExecuteForm = false"
    />
    <template v-else>
      <p v-if="!terminals.length" class="text-sm text-muted">No active terminals.</p>
    <div v-else class="divide-y divide-default">
      <div
        v-for="t in terminals"
        :key="t.terminal_id ?? t.id"
        class="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
      >
        <div class="space-y-0.5">
          <p class="text-sm font-medium">Terminal {{ t.terminal_id ?? t.id }}</p>
          <div class="flex flex-wrap gap-x-3 text-xs text-muted">
            <span v-if="t.workspace">Workspace: {{ t.workspace }}</span>
            <span v-if="t.cwd">CWD: {{ t.cwd }}</span>
          </div>
        </div>
        <UButton
          variant="ghost"
          color="error"
          size="xs"
          @click="emit('kill', t.terminal_id ?? t.id ?? '')"
        >
          Kill
        </UButton>
      </div>
    </div>
    </template>
  </UCard>
</template>
