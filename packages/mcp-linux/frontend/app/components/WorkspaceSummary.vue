<script setup lang="ts">
import type { WorkspaceStatusResponse } from '../types/index';

defineProps<{
  data: WorkspaceStatusResponse;
}>();

const emit = defineEmits<{
  delete: [name: string];
}>();

async function confirmDelete(name: string) {
  if (!window.confirm(`Delete workspace "${name}"? This cannot be undone.`)) return;
  emit('delete', name);
}
</script>

<template>
  <UCard>
    <template #header>
      <span class="font-semibold">Summary</span>
    </template>
    <div class="space-y-2">
      <div class="flex flex-wrap gap-1.5">
        <UBadge v-if="data.meta.workspace">Workspace: {{ data.meta.workspace }}</UBadge>
        <UBadge v-if="data.meta.branch">Branch: {{ data.meta.branch }}</UBadge>
        <UBadge v-if="data.git.remote_url">Remote: {{ data.git.remote_url }}</UBadge>
        <UBadge :color="data.git.dirty ? 'warning' : 'success'">
          {{ data.git.dirty ? 'Dirty working tree' : 'Clean working tree' }}
        </UBadge>
      </div>

      <div v-if="data.git.ahead != null || data.git.behind != null" class="flex gap-3 text-sm">
        <span v-if="data.git.ahead != null">Ahead: {{ data.git.ahead }}</span>
        <span v-if="data.git.behind != null">Behind: {{ data.git.behind }}</span>
      </div>

      <div v-if="data.submodules" class="text-sm text-muted">
        Submodules: {{ data.submodules.status }}
        <span v-if="data.submodules.message"> - {{ data.submodules.message }}</span>
      </div>

      <div v-if="data.config?.code_index_enabled != null" class="text-sm text-muted">
        Code index enabled: {{ data.config.code_index_enabled ? 'yes' : 'no' }}
      </div>

      <div v-if="data.meta.path" class="text-xs text-muted">Path: {{ data.meta.path }}</div>

      <div
        v-if="data.meta.workspace && data.meta.workspace !== 'default'"
        class="pt-1"
      >
        <UButton
          variant="ghost"
          color="error"
          size="xs"
          @click="confirmDelete(data.meta.workspace)"
        >
          Delete workspace
        </UButton>
      </div>
    </div>
  </UCard>
</template>
