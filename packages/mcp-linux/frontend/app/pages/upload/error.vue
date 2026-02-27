<script setup lang="ts">
const route = useRoute();

const title = computed(() => {
  const t = route.query.title;
  return typeof t === 'string' ? t : 'Error';
});

const message = computed(() => {
  const m = route.query.message;
  return typeof m === 'string' ? m : 'An error occurred with this upload link.';
});
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-6">
    <div class="w-full max-w-md">
      <UCard>
        <template #header>
          <span class="font-semibold text-error">{{ title }}</span>
        </template>
        <p class="text-sm text-muted">{{ message }}</p>
      </UCard>
    </div>
  </div>
</template>
