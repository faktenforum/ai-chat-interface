<script setup lang="ts">
defineProps<{
  workspaces: string[];
  token: string;
}>();

const emit = defineEmits<{
  delete: [name: string];
}>();

const toast = useToast();

async function confirmDelete(name: string) {
  if (!window.confirm(`Delete workspace "${name}"? This cannot be undone.`)) return;
  emit('delete', name);
}

function workspaceLink(name: string, token: string) {
  const base = `/status/workspace/${encodeURIComponent(name)}`;
  return token ? `${base}?token=${token}` : base;
}
</script>

<template>
  <UCard>
    <template #header>
      <span class="font-semibold">Workspaces</span>
    </template>
    <p v-if="!workspaces.length" class="text-sm text-muted">No workspaces found yet.</p>
    <div v-else class="divide-y divide-default">
      <div
        v-for="name in workspaces"
        :key="name"
        class="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
      >
        <NuxtLink
          :to="workspaceLink(name, token)"
          class="text-sm text-primary hover:underline underline-offset-2"
        >
          {{ name }}
        </NuxtLink>
        <div class="flex items-center gap-2">
          <UBadge>{{ name === 'default' ? 'Default workspace' : 'Custom workspace' }}</UBadge>
          <UButton
            v-if="name !== 'default'"
            variant="ghost"
            color="error"
            size="xs"
            @click="confirmDelete(name)"
          >
            Delete
          </UButton>
        </div>
      </div>
    </div>
  </UCard>
</template>
