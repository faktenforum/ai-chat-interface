<script setup lang="ts">
import type { UploadConfig } from '../../types/index';

const route = useRoute();
const config = useRuntimeConfig();
const baseUrl = config.public.apiBase as string;

const uploadToken = computed(() => {
  const t = route.params.token;
  return typeof t === 'string' ? t : Array.isArray(t) ? (t[0] ?? '') : '';
});

const loading = ref(true);
const errorTitle = ref('');
const errorMessage = ref('');
const uploadConfig = ref<UploadConfig | null>(null);

onMounted(async () => {
  try {
    const res = await fetch(`${baseUrl}/upload/${uploadToken.value}/config`);
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      errorTitle.value = 'Error';
      errorMessage.value = (body as { error?: string }).error ?? `Error ${res.status}`;
      return;
    }

    const cfg = body as UploadConfig;

    if (cfg.status === 'expired') {
      errorTitle.value = 'Session Expired';
      errorMessage.value =
        'This upload session has expired. Please request a new upload link.';
      return;
    }
    if (cfg.status === 'completed') {
      errorTitle.value = 'Upload Complete';
      errorMessage.value =
        'A file has already been uploaded in this session. The session is now closed.';
      return;
    }
    if (cfg.status === 'closed') {
      errorTitle.value = 'Session Closed';
      errorMessage.value =
        'This upload session has been closed. Please request a new upload link.';
      return;
    }

    uploadConfig.value = cfg;
  } catch {
    errorTitle.value = 'Connection Error';
    errorMessage.value = 'Could not load upload session. Please check your connection.';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-6">
    <div class="w-full max-w-md space-y-4">
      <div v-if="loading" class="text-center py-8 text-sm text-muted">Loading...</div>

      <template v-else-if="errorTitle">
        <UCard>
          <template #header>
            <span class="font-semibold text-error">{{ errorTitle }}</span>
          </template>
          <p class="text-sm text-muted">{{ errorMessage }}</p>
        </UCard>
      </template>

      <template v-else-if="uploadConfig">
        <div class="text-center mb-2">
          <h1 class="text-xl font-semibold">File Upload</h1>
          <p v-if="uploadConfig.workspace" class="text-sm text-muted">
            Workspace: {{ uploadConfig.workspace }}
          </p>
        </div>
        <FileUploader :config="uploadConfig" :base-url="baseUrl" />
      </template>
    </div>
  </div>
</template>
