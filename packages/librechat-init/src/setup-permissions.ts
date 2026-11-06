import { execSync } from 'child_process';

const PATHS = [
  '/logs',
  '/images',
  '/icons',
  '/uploads',
  '/mongo_data',
  '/mongo_configdb',
  '/meili_data'
];

export async function setupPermissions(): Promise<void> {
  const uid = parseInt(process.env.UID || '1000');
  const gid = parseInt(process.env.GID || '1000');
  
  // Check if running as root
  const isRoot = process.getuid?.() === 0;
  
  if (!isRoot) {
    console.log('⚠ Not running as root, skipping permissions setup');
    return;
  }

  console.log(`Setting permissions for UID:GID ${uid}:${gid}...`);

  for (const path of PATHS) {
    try {
      // Use system chown/chmod for recursive operations (more reliable)
      execSync(`chown -R ${uid}:${gid} ${path} 2>/dev/null || true`);
      execSync(`chmod -R 775 ${path} 2>/dev/null || true`);
    } catch (error) {
      // Non-critical - some paths might not exist yet
      console.log(`  ⚠ Could not set permissions for ${path}`);
    }
  }

  console.log('✓ Permissions configured');
}
