<script setup lang="ts">
import type { CreateDownloadResponse } from '../types/index';

const props = defineProps<{
  workspaces: string[];
}>();

const emit = defineEmits<{
  created: [response: CreateDownloadResponse];
  cancel: [];
}>();

const { postJson } = useStatusApi();

const workspace = ref('default');
const filePath = ref('');
const expiresInMinutes = ref(60);
const loading = ref(false);
const errorMsg = ref('');

const workspaceItems = computed(() =>
  (props.workspaces?.length ? props.workspaces : ['default']).map((w) => ({ label: w, value: w })),
);

async function submit() {
  const path = filePath.value.trim();
  if (!path) {
    errorMsg.value = 'File path is required';
    return;
  }
  errorMsg.value = '';
  loading.value = true;
  try {
    const res = await postJson<CreateDownloadResponse>('/status/api/create-download-link', {
      workspace: workspace.value,
      file_path: path,
      expires_in_minutes: expiresInMinutes.value,
    });
    emit('created', res);
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to create download link';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="grid gap-2 sm:grid-cols-3">
      <div>
        <label class="mb-1 block text-sm font-medium text-default">Workspace</label>
        <USelect
          v-model="workspace"
          :items="workspaceItems"
          size="sm"
          class="w-full"
        />
      </div>
      <div class="sm:col-span-2">
        <label class="mb-1 block text-sm font-medium text-default">File path (relative to workspace)</label>
        <UInput
          v-model="filePath"
          placeholder="e.g. uploads/file.zip"
          size="sm"
          class="w-full"
        />
      </div>
    </div>
    <div>
      <label class="mb-1 block text-sm font-medium text-default">Expiry (minutes)</label>
      <UInput
        v-model.number="expiresInMinutes"
        type="number"
        min="1"
        max="1440"
        size="sm"
        class="w-32"
      />
    </div>
    <UAlert v-if="errorMsg" color="error" :description="errorMsg" icon="i-lucide-alert-circle" />
    <div class="flex gap-2">
      <UButton size="sm" :loading="loading" @click="submit">Create link</UButton>
      <UButton variant="ghost" size="sm" :disabled="loading" @click="emit('cancel')">Cancel</UButton>
    </div>
  </div>
</template>
