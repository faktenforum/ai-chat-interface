<script setup lang="ts">
import type { PlanTask, TaskStatus } from '../types/index';

defineProps<{
  tasks: PlanTask[];
  workspaceName: string;
}>();

const emit = defineEmits<{
  add: [title: string];
  remove: [index: number];
  'update-status': [index: number, status: TaskStatus];
  'update-title': [index: number, title: string];
}>();

const newTaskTitle = ref('');

const statusOptions = [
  { label: 'Pending', value: 'pending' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Done', value: 'done' },
  { label: 'Cancelled', value: 'cancelled' },
];

function statusColor(status: TaskStatus) {
  if (status === 'done') return 'text-success';
  if (status === 'in_progress') return 'text-info';
  if (status === 'cancelled') return 'text-error';
  return 'text-muted';
}

function addTask() {
  const title = newTaskTitle.value.trim();
  if (!title) return;
  emit('add', title);
  newTaskTitle.value = '';
}
</script>

<template>
  <UCard>
    <template #header>
      <span class="font-semibold">Tasks</span>
    </template>
    <div class="space-y-3">
      <p v-if="!tasks.length" class="text-sm text-muted">
        No tasks yet. Add tasks to track progress on this plan.
      </p>

      <div v-else class="space-y-2">
        <div
          v-for="(task, i) in tasks"
          :key="i"
          class="flex items-center gap-2"
        >
          <span :class="['text-xs shrink-0', statusColor(task.status)]">●</span>
          <UInput
            :model-value="task.title"
            size="sm"
            class="flex-1 min-w-0"
            @blur="(e: FocusEvent) => {
              const val = (e.target as HTMLInputElement).value.trim();
              if (val && val !== task.title) emit('update-title', i, val);
            }"
          />
          <USelect
            :model-value="task.status"
            :items="statusOptions"
            size="sm"
            class="w-36 shrink-0"
            @update:model-value="(val) => val != null && emit('update-status', i, val as TaskStatus)"
          />
          <UButton
            variant="ghost"
            color="error"
            size="xs"
            icon="i-lucide-x"
            @click="emit('remove', i)"
          />
        </div>
      </div>

      <div class="flex gap-2 pt-1">
        <UInput
          v-model="newTaskTitle"
          placeholder="New task title"
          size="sm"
          class="flex-1"
          @keyup.enter="addTask"
        />
        <UButton size="sm" icon="i-lucide-plus" @click="addTask">Add task</UButton>
      </div>
    </div>
  </UCard>
</template>
