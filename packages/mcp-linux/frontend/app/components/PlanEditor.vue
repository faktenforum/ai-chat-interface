<script setup lang="ts">
const props = defineProps<{
  plan: string;
  workspaceName: string;
}>();

const emit = defineEmits<{
  save: [value: string];
}>();

const localPlan = ref('');
const saving = ref(false);

watch(
  () => props.plan,
  (val) => {
    localPlan.value = val;
  },
  { immediate: true },
);

async function save() {
  saving.value = true;
  try {
    emit('save', localPlan.value);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <span class="font-semibold">Plan</span>
    </template>
    <div class="space-y-2">
      <UTextarea
        v-model="localPlan"
        :rows="4"
        placeholder="Describe the goal, context, or high-level plan for this workspace..."
        class="w-full font-mono text-sm"
      />
      <UButton size="sm" icon="i-lucide-save" :loading="saving" @click="save">
        Save plan
      </UButton>
    </div>
  </UCard>
</template>
