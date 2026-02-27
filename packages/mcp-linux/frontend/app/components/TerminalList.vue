<script setup lang="ts">
import type { TerminalInfo } from '../types/index';

defineProps<{
  terminals: TerminalInfo[];
}>();

const emit = defineEmits<{
  kill: [terminalId: string];
}>();
</script>

<template>
  <UCard>
    <template #header>
      <span class="font-semibold">Active Terminals</span>
    </template>
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
  </UCard>
</template>
