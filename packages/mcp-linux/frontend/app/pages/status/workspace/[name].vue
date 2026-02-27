<script setup lang="ts">
import type { WorkspaceStatusResponse, CodeSearchResult, PlanTask, WorkspaceStatusRaw } from '../../../types/index';
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

const searchResults = ref<CodeSearchResult[]>([]);
const searchMessage = ref('');
const lastQuery = ref('');
const lastPath = ref('');

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

function reindexWorkspace(name: string) {
  return handleAction(
    () => postJson('/status/api/reindex-workspace', { name, force: true }),
    'Code index rebuild started.',
  );
}

async function searchCode(query: string, path: string) {
  lastQuery.value = query;
  lastPath.value = path;
  try {
    const result = await postJson<{ results?: CodeSearchResult[]; message?: string }>(
      '/status/api/workspace-search',
      { name: workspaceName.value, query, path: path || undefined, limit: 10 },
    );
    searchResults.value = result.results ?? [];
    searchMessage.value = result.message ?? '';
  } catch (err) {
    toast.add({
      title: err instanceof Error ? err.message : 'Search failed',
      color: 'error',
    });
  }
}

async function savePlan(plan: string) {
  return handleAction(
    () => postJson('/status/api/update-plan', { name: workspaceName.value, plan }),
    'Plan saved.',
  );
}

async function addTask(title: string) {
  const tasks = [...(data.value?.tasks ?? []), { title, status: 'pending' as const }];
  return handleAction(
    () => postJson('/status/api/update-plan', { name: workspaceName.value, tasks }),
    'Task added.',
  );
}

async function removeTask(index: number) {
  const tasks = [...(data.value?.tasks ?? [])];
  tasks.splice(index, 1);
  return handleAction(
    () => postJson('/status/api/update-plan', { name: workspaceName.value, tasks }),
    'Task removed.',
  );
}

async function updateTaskStatus(index: number, status: PlanTask['status']) {
  try {
    await postJson('/status/api/update-plan', {
      name: workspaceName.value,
      task_updates: [{ index, status }],
    });
    await refresh();
  } catch (err) {
    toast.add({
      title: err instanceof Error ? err.message : 'Failed to update task',
      color: 'error',
    });
  }
}

async function updateTaskTitle(index: number, title: string) {
  const tasks = [...(data.value?.tasks ?? [])].map((t, i) =>
    i === index ? { ...t, title } : t,
  );
  try {
    await postJson('/status/api/update-plan', { name: workspaceName.value, tasks });
    await refresh();
  } catch (err) {
    toast.add({
      title: err instanceof Error ? err.message : 'Failed to update task',
      color: 'error',
    });
  }
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

      <CodeIndex
        :code-index="data.code_index"
        :workspace-name="workspaceName"
        @reindex="reindexWorkspace"
      />

      <CodeSearch
        :workspace-name="workspaceName"
        :results="searchResults"
        :message="searchMessage"
        :last-query="lastQuery"
        :last-path="lastPath"
        @search="searchCode"
      />

      <PlanEditor :plan="data.plan ?? ''" :workspace-name="workspaceName" @save="savePlan" />

      <TaskManager
        :tasks="data.tasks ?? []"
        :workspace-name="workspaceName"
        @add="addTask"
        @remove="removeTask"
        @update-status="updateTaskStatus"
        @update-title="updateTaskTitle"
      />
    </template>

    <div v-else-if="loading" class="text-center py-8 text-sm text-muted">Loading...</div>
  </div>
</template>
