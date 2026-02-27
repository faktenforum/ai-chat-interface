<script setup lang="ts">
import type { UploadConfig } from '../types/index';

const props = defineProps<{
  config: UploadConfig;
  baseUrl: string;
}>();

const expiresAt = computed(() => new Date(props.config.expiresAt));
const maxSize = computed(() => props.config.maxSizeMb * 1024 * 1024);

const selectedFile = ref<File | null>(null);
const uploading = ref(false);
const uploadComplete = ref(false);
const progress = ref(0);
const progressLabel = ref('');
const statusType = ref<'success' | 'error' | ''>('');
const statusTitle = ref('');
const statusDetail = ref('');
const expiryText = ref('');
const expired = ref(false);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.substring(idx).toLowerCase() : '';
}

function validateFile(file: File): string | null {
  if (file.size > maxSize.value) {
    return `File exceeds maximum size of ${formatBytes(maxSize.value)}`;
  }
  if (props.config.allowedExtensions.length > 0) {
    const ext = getExtension(file.name);
    if (!props.config.allowedExtensions.includes(ext)) {
      return `File type ${ext} is not allowed. Accepted: ${props.config.allowedExtensions.join(', ')}`;
    }
  }
  return null;
}

function updateExpiry() {
  const diff = expiresAt.value.getTime() - Date.now();
  if (diff <= 0) {
    expiryText.value = 'Expired';
    expired.value = true;
    return;
  }
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  expiryText.value = `Expires in ${mins}:${String(secs).padStart(2, '0')}`;
}

onMounted(() => {
  updateExpiry();
  const interval = setInterval(updateExpiry, 1000);
  onUnmounted(() => clearInterval(interval));
});

const isDragOver = ref(false);

function handleDrop(e: DragEvent) {
  e.preventDefault();
  isDragOver.value = false;
  if (uploading.value) return;
  const files = e.dataTransfer?.files;
  if (files && files.length > 0 && files[0]) selectFile(files[0]);
}

function handleFileInput(e: Event) {
  const files = (e.target as HTMLInputElement).files;
  if (files && files.length > 0 && files[0]) selectFile(files[0]);
}

function selectFile(file: File) {
  const error = validateFile(file);
  if (error) {
    statusType.value = 'error';
    statusTitle.value = 'Invalid file';
    statusDetail.value = error;
    return;
  }
  selectedFile.value = file;
  statusType.value = '';
  statusTitle.value = '';
  statusDetail.value = '';
}

function clearFile() {
  selectedFile.value = null;
}

function upload() {
  if (uploadComplete.value) {
    window.close();
    return;
  }
  if (!selectedFile.value || uploading.value || expired.value) return;

  uploading.value = true;
  progress.value = 0;
  progressLabel.value = 'Uploading...';
  statusType.value = '';

  const formData = new FormData();
  formData.append('file', selectedFile.value);

  const xhr = new XMLHttpRequest();

  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      progress.value = Math.round((e.loaded / e.total) * 100);
      progressLabel.value = `Uploading... ${formatBytes(e.loaded)} / ${formatBytes(e.total)}`;
    }
  });

  xhr.addEventListener('load', () => {
    uploading.value = false;
    progress.value = 100;
    progressLabel.value = 'Complete';

    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const result = JSON.parse(xhr.responseText) as {
          filename: string;
          size: number;
          path: string;
        };
        statusType.value = 'success';
        statusTitle.value = 'Upload successful';
        statusDetail.value = `${result.filename} (${formatBytes(result.size)}) saved to ${result.path}`;
      } catch {
        statusType.value = 'success';
        statusTitle.value = 'Upload successful';
        statusDetail.value = '';
      }
      uploadComplete.value = true;
    } else {
      try {
        const err = JSON.parse(xhr.responseText) as { error?: string };
        statusType.value = 'error';
        statusTitle.value = 'Upload failed';
        statusDetail.value = err.error ?? 'Unknown error';
      } catch {
        statusType.value = 'error';
        statusTitle.value = 'Upload failed';
        statusDetail.value = `HTTP ${xhr.status}`;
      }
    }
  });

  xhr.addEventListener('error', () => {
    uploading.value = false;
    statusType.value = 'error';
    statusTitle.value = 'Upload failed';
    statusDetail.value = 'Network error. Please check your connection.';
  });

  xhr.addEventListener('abort', () => {
    uploading.value = false;
    statusType.value = 'error';
    statusTitle.value = 'Upload cancelled';
    statusDetail.value = '';
  });

  xhr.open('POST', `${props.baseUrl}/upload/${props.config.token}`);
  xhr.send(formData);
}
</script>

<template>
  <UCard class="w-full">
    <div class="space-y-4">
      <!-- Expiry badge -->
      <div class="flex justify-end">
        <UBadge :color="expired ? 'error' : 'neutral'" variant="subtle">
          {{ expiryText }}
        </UBadge>
      </div>

      <!-- Hints -->
      <div v-if="config.allowedExtensions.length > 0 || config.maxSizeMb" class="text-xs text-muted space-x-3">
        <span v-if="config.maxSizeMb">Max size: {{ config.maxSizeMb }} MB</span>
        <span v-if="config.allowedExtensions.length > 0">
          Accepted: {{ config.allowedExtensions.join(', ') }}
        </span>
      </div>

      <!-- Dropzone -->
      <div
        :class="[
          'border-2 border-dashed rounded-xl p-8 text-center transition cursor-pointer select-none',
          isDragOver ? 'border-primary bg-primary/5' : 'border-default hover:border-primary/50',
          (uploading || expired) ? 'pointer-events-none opacity-50' : '',
        ]"
        @dragover.prevent="isDragOver = true"
        @dragleave="isDragOver = false"
        @drop="handleDrop"
        @click="!uploading && ($refs.fileInput as HTMLInputElement)?.click()"
      >
        <input
          ref="fileInput"
          type="file"
          class="hidden"
          @change="handleFileInput"
        />
        <div class="space-y-2 text-muted">
          <div class="text-3xl">↑</div>
          <p class="text-sm">Drag and drop a file here, or click to select</p>
        </div>
      </div>

      <!-- File preview -->
      <div v-if="selectedFile" class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-elevated border border-default">
        <div class="text-sm">
          <span class="font-medium">{{ selectedFile.name }}</span>
          <span class="text-muted ml-2">{{ formatBytes(selectedFile.size) }}</span>
        </div>
        <UButton
          v-if="!uploading"
          variant="ghost"
          color="error"
          size="xs"
          icon="i-lucide-x"
          @click="clearFile"
        />
      </div>

      <!-- Progress -->
      <div v-if="uploading || uploadComplete" class="space-y-1">
        <UProgress :value="progress" :max="100" size="sm" />
        <div class="flex justify-between text-xs text-muted">
          <span>{{ progressLabel }}</span>
          <span>{{ progress }}%</span>
        </div>
      </div>

      <!-- Status -->
      <UAlert
        v-if="statusType"
        :color="statusType === 'success' ? 'success' : 'error'"
        :title="statusTitle"
        :description="statusDetail || undefined"
        :icon="statusType === 'success' ? 'i-lucide-check-circle' : 'i-lucide-x-circle'"
      />

      <!-- Expired overlay message -->
      <UAlert
        v-if="expired"
        color="error"
        title="Session expired"
        description="This upload session has expired."
      />

      <!-- Upload button -->
      <UButton
        v-if="selectedFile && !expired"
        class="w-full justify-center"
        size="md"
        :loading="uploading"
        :disabled="!selectedFile || uploading || expired"
        @click="upload"
      >
        {{ uploadComplete ? 'Done' : uploading ? 'Uploading...' : 'Upload' }}
      </UButton>
    </div>
  </UCard>
</template>
