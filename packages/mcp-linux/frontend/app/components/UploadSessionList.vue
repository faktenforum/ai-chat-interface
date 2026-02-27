<script setup lang="ts">
import type { UploadSession } from '../types/index';

defineProps<{
  sessions: UploadSession[];
}>();

const emit = defineEmits<{
  close: [token: string];
}>();

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function badgeColor(status: string) {
  if (status === 'completed') return 'success';
  if (status === 'expired' || status === 'closed') return 'error';
  return 'neutral';
}
</script>

<template>
  <UCard>
    <template #header>
      <span class="font-semibold">Upload Sessions</span>
    </template>
    <p v-if="!sessions.length" class="text-sm text-muted">No upload sessions.</p>
    <div v-else class="divide-y divide-default">
      <div
        v-for="s in sessions"
        :key="s.token"
        class="py-2 first:pt-0 last:pb-0 space-y-1"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-medium">{{ s.workspace }}</span>
          <UBadge :color="badgeColor(s.status)">{{ s.status }}</UBadge>
        </div>
        <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
          <span>Token: {{ s.token.slice(0, 8) }}…</span>
          <span>Expires: {{ s.expires_at }}</span>
          <span v-if="s.uploaded_file">
            File: {{ s.uploaded_file.name }} ({{ formatBytes(s.uploaded_file.size) }})
          </span>
        </div>
        <div v-if="s.status === 'active'">
          <UButton
            variant="ghost"
            color="error"
            size="xs"
            @click="emit('close', s.token)"
          >
            Close session
          </UButton>
        </div>
      </div>
    </div>
  </UCard>
</template>
