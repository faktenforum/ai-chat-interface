<script setup lang="ts">
import type { CreateUploadResponse } from '../types/index';

const props = defineProps<{
  workspaces: string[];
}>();

const emit = defineEmits<{
  created: [response: CreateUploadResponse];
  cancel: [];
}>();

const { postJson } = useStatusApi();

const workspace = ref('default');
const expiresInMinutes = ref(15);
const maxFileSizeMb = ref(100);
const loading = ref(false);
const errorMsg = ref('');

const workspaceItems = computed(() =>
  (props.workspaces?.length ? props.workspaces : ['default']).map((w) => ({ label: w, value: w })),
);

async function submit() {
  errorMsg.value = '';
  loading.value = true;
  try {
    const res = await postJson<CreateUploadResponse>('/status/api/create-upload-session', {
      workspace: workspace.value,
      expires_in_minutes: expiresInMinutes.value,
      max_file_size_mb: maxFileSizeMb.value,
    });
    emit('created', res);
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to create upload session';
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
      <div>
        <label class="mb-1 block text-sm font-medium text-default">Expiry (minutes)</label>
        <UInput
          v-model.number="expiresInMinutes"
          type="number"
          min="1"
          max="60"
          size="sm"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium text-default">Max file size (MB)</label>
        <UInput
          v-model.number="maxFileSizeMb"
          type="number"
          min="1"
          max="500"
          size="sm"
        />
      </div>
    </div>
    <UAlert v-if="errorMsg" color="error" :description="errorMsg" icon="i-lucide-alert-circle" />
    <div class="flex gap-2">
      <UButton size="sm" :loading="loading" @click="submit">Create session</UButton>
      <UButton variant="ghost" size="sm" :disabled="loading" @click="emit('cancel')">Cancel</UButton>
    </div>
  </div>
</template>
