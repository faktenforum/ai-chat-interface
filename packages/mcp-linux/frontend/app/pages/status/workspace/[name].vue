<script setup lang="ts">
import type { WorkspaceStatusResponse, WorkspaceStatusRaw } from '../../../types/index';
import { normalizeWorkspaceStatus } from '../../../types/index';

const route = useRoute();
const { apiFetch, postJson, token } = useStatusApi();
const toast = useToast();

const workspaceName = computed(() => {
  const n = route.params.name;
  return typeof n === 'string' ? n : Array.isArray(n) ? (n[0] ?? '') : '';
});

const loading = ref(false);
const errorMsg = ref('');
const data = ref<WorkspaceStatusResponse | null>(null);

async function refresh() {
  loading.value = true;
  errorMsg.value = '';

  try {
    const encoded = encodeURIComponent(workspaceName.value);
    const raw = await apiFetch<WorkspaceStatusResponse | WorkspaceStatusRaw>(
      `/status/api/workspace/${encoded}`,
    );
    data.value = normalizeWorkspaceStatus(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load workspace status';
    errorMsg.value =
      msg.includes('401') && !token.value
        ? 'Open the personal status link from the agent in LibreChat (it contains your access token).'
        : msg;
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
      <div class="flex items-center gap-2">
        <NuxtLink
          :to="`/status/${token ? '?token=' + token : ''}`"
          class="text-sm text-muted hover:text-default"
        >
          ← Back
        </NuxtLink>
        <h1 class="text-xl font-semibold">Workspace: {{ workspaceName }}</h1>
      </div>
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
      <WorkspaceSummary :data="data" @delete="deleteWorkspace" />
    </template>

    <div v-else-if="loading" class="text-center py-8 text-sm text-muted">Loading...</div>
  </div>
</template>
