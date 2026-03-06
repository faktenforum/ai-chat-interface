<script setup lang="ts">
import type { CodeSearchResult } from '../types/index';

defineProps<{
  workspaceName: string;
  results: CodeSearchResult[];
  message: string;
  lastQuery: string;
  lastPath: string;
}>();

const emit = defineEmits<{
  search: [query: string, path: string];
}>();

const query = ref('');
const pathFilter = ref('');
const searching = ref(false);

async function doSearch() {
  const q = query.value.trim();
  if (!q) return;
  searching.value = true;
  try {
    emit('search', q, pathFilter.value.trim());
  } finally {
    searching.value = false;
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <span class="font-semibold">Code Search</span>
    </template>
    <div class="space-y-3">
      <div class="flex gap-2">
        <UInput
          v-model="query"
          placeholder='Search code (e.g. "HTTP handler")'
          class="flex-1"
          size="sm"
          @keyup.enter="doSearch"
        />
        <UInput
          v-model="pathFilter"
          placeholder="Path filter (e.g. src/)"
          class="w-36"
          size="sm"
          @keyup.enter="doSearch"
        />
        <UButton size="sm" icon="i-lucide-search" :loading="searching" @click="doSearch">
          Search
        </UButton>
      </div>

      <template v-if="lastQuery">
        <p class="text-xs text-muted">
          Last search: <span class="font-medium text-default">{{ lastQuery }}</span>
          <span v-if="lastPath"> (in {{ lastPath }})</span>
        </p>

        <p v-if="message && !results.length" class="text-sm text-muted">{{ message }}</p>

        <div v-if="results.length" class="space-y-2">
          <div
            v-for="(r, i) in results"
            :key="i"
            class="rounded-md border border-default p-3 space-y-1"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-mono text-primary">{{ r.file_path }}</span>
              <div class="flex gap-2 text-xs text-muted shrink-0">
                <span v-if="r.start_line != null && r.end_line != null">
                  Lines {{ r.start_line }}-{{ r.end_line }}
                </span>
                <span v-if="r.score != null">Score {{ r.score.toFixed(3) }}</span>
              </div>
            </div>
            <pre
              v-if="r.code_chunk"
              class="text-xs text-default bg-elevated rounded p-2 overflow-x-auto whitespace-pre-wrap break-all"
            >{{ r.code_chunk.slice(0, 260) }}{{ r.code_chunk.length > 260 ? '…' : '' }}</pre>
          </div>
        </div>
      </template>
    </div>
  </UCard>
</template>
