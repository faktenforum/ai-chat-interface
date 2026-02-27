<script setup lang="ts">
import type { CodeIndexState } from '../types/index';

defineProps<{
  codeIndex?: CodeIndexState;
  workspaceName: string;
}>();

const emit = defineEmits<{
  reindex: [workspace: string];
}>();
</script>

<template>
  <UCard>
    <template #header>
      <span class="font-semibold">Code Index</span>
    </template>
    <div v-if="codeIndex" class="space-y-2">
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span v-if="codeIndex.enabled != null">
          Enabled: {{ codeIndex.enabled ? 'yes' : 'no' }}
        </span>
        <span v-if="codeIndex.status">Status: {{ codeIndex.status }}</span>
        <span v-if="codeIndex.files_processed != null && codeIndex.files_total != null">
          Files: {{ codeIndex.files_processed }} / {{ codeIndex.files_total }}
        </span>
      </div>
      <p v-if="codeIndex.message" class="text-sm text-muted">{{ codeIndex.message }}</p>
    </div>
    <p v-else class="text-sm text-muted">No code index information available.</p>
    <div class="mt-3">
      <UButton
        variant="outline"
        size="xs"
        icon="i-lucide-refresh-cw"
        @click="emit('reindex', workspaceName)"
      >
        Rebuild code index
      </UButton>
    </div>
  </UCard>
</template>
