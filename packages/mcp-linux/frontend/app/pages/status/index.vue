<script setup lang="ts">
import type { StatusOverview } from '../../types/index';

const { apiFetch, postJson, token } = useStatusApi();
const toast = useToast();

const loading = ref(false);
const errorMsg = ref('');
const data = ref<StatusOverview | null>(null);

async function refresh() {
  if (!token.value) {
    errorMsg.value =
      'Open the personal status link from the agent in LibreChat (it contains your access token).';
    return;
  }

  loading.value = true;
  errorMsg.value = '';

  try {
    data.value = await apiFetch<StatusOverview>('/status/api/overview');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load status';
    if (msg.includes('401') || msg.includes('403')) {
      errorMsg.value =
        'Your access token is invalid or has expired. Ask the agent in LibreChat for a fresh status link.';
      data.value = null;
    } else {
      errorMsg.value = msg;
    }
  } finally {
    loading.value = false;
  }
}

async function handleAction(action: () => Promise<void>, successMsg: string) {
  try {
    await action();
    toast.add({ title: successMsg, color: 'success' });
    await refresh();
  } catch (err) {
    toast.add({
      title: err instanceof Error ? err.message : 'Action failed',
      color: 'error',
    });
  }
}

function closeUploadSession(uploadToken: string) {
  return handleAction(
    () => postJson('/status/api/close-upload-session', { token: uploadToken }),
    'Upload session closed.',
  );
}

function closeDownloadLink(downloadToken: string) {
  return handleAction(
    () => postJson('/status/api/close-download-link', { token: downloadToken }),
    'Download link revoked.',
  );
}

function killTerminal(terminalId: string) {
  return handleAction(
    () => postJson('/status/api/kill-terminal', { terminal_id: terminalId }),
    'Terminal killed.',
  );
}

function deleteWorkspace(name: string) {
  return handleAction(
    () => postJson('/status/api/delete-workspace', { name }),
    'Workspace deleted.',
  );
}

onMounted(() => refresh());
</script>

<template>
  <div class="max-w-3xl mx-auto p-6 space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold">Account Status</h1>
      <UButton
        variant="ghost"
        size="sm"
        icon="i-lucide-refresh-cw"
        :loading="loading"
        @click="refresh"
      >
        Refresh
      </UButton>
    </div>

    <UAlert v-if="errorMsg" color="error" :description="errorMsg" icon="i-lucide-alert-circle" />

    <template v-if="data">
      <!-- User card -->
      <UCard>
        <template #header>
          <span class="font-semibold">Account</span>
        </template>
        <div v-if="data.user">
          <p class="font-medium">{{ data.user.email }}</p>
          <div class="flex flex-wrap gap-1.5 mt-2">
            <UBadge v-if="data.user.username">User: {{ data.user.username }}</UBadge>
            <UBadge v-if="data.user.diskUsage">Disk: {{ data.user.diskUsage }}</UBadge>
            <UBadge v-if="data.user.home">Home: {{ data.user.home }}</UBadge>
          </div>
          <div
            v-if="data.user.runtimes && Object.keys(data.user.runtimes).length > 0"
            class="mt-3"
          >
            <p class="text-sm text-muted mb-1">Installed runtimes</p>
            <div class="flex flex-wrap gap-2">
              <span
                v-for="(version, name) in data.user.runtimes"
                :key="name"
                class="text-sm text-default"
              >
                {{ name }}: {{ version }}
              </span>
            </div>
          </div>
        </div>
        <p v-else class="text-sm text-muted">No account information available.</p>
      </UCard>

      <WorkspaceList
        :workspaces="data.workspaces"
        :token="token"
        @delete="deleteWorkspace"
      />

      <UploadSessionList :sessions="data.upload_sessions" @close="closeUploadSession" />

      <DownloadSessionList :sessions="data.download_sessions" @close="closeDownloadLink" />

      <TerminalList :terminals="data.terminals" @kill="killTerminal" />
    </template>

    <div v-else-if="loading" class="text-center py-8 text-sm text-muted">Loading...</div>
  </div>
</template>
