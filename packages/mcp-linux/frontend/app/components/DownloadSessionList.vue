<script setup lang="ts">
import type { CreateDownloadResponse, DownloadSession } from '../types/index';

defineProps<{
  sessions: DownloadSession[];
  workspaces: string[];
}>();

const emit = defineEmits<{
  close: [token: string];
  create: [response: CreateDownloadResponse];
}>();

const showCreateForm = ref(false);

function badgeColor(status: string) {
  if (status === 'downloaded') return 'success';
  if (status === 'expired' || status === 'closed') return 'error';
  return 'neutral';
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold">Download Links</span>
        <UButton
          v-if="!showCreateForm"
          variant="ghost"
          size="xs"
          icon="i-lucide-plus"
          @click="showCreateForm = true"
        >
          New download link
        </UButton>
      </div>
    </template>
    <CreateDownloadForm
      v-if="showCreateForm"
      :workspaces="workspaces"
      @created="(r) => { emit('create', r); showCreateForm = false; }"
      @cancel="showCreateForm = false"
    />
    <template v-else>
      <p v-if="!sessions.length" class="text-sm text-muted">No download links.</p>
      <div v-else class="divide-y divide-default">
        <div
          v-for="s in sessions"
          :key="s.token"
          class="py-2 first:pt-0 last:pb-0 space-y-1"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-medium">{{ s.filename }}</span>
            <UBadge :color="badgeColor(s.status)">{{ s.status }}</UBadge>
          </div>
          <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
            <span>Workspace: {{ s.workspace }}</span>
            <span>Size: {{ formatBytes(s.file_size) }}</span>
            <span>Path: {{ s.file_path }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <NuxtLink
              :to="`/download/${s.token}`"
              target="_blank"
              class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open download URL
              <span class="i-lucide-external-link h-3 w-3 shrink-0" />
            </NuxtLink>
            <UButton
              v-if="s.status === 'active'"
              variant="ghost"
              color="error"
              size="xs"
              @click="emit('close', s.token)"
            >
              Revoke link
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UCard>
</template>
