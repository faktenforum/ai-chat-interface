/**
 * Background job test, driven through the official MCP SDK client - the same client LibreChat uses,
 * so what passes here is what LibreChat gets.
 *
 * Needs a running server. Inside the container:
 *   podman exec <container> node test/jobs.mjs
 * Against a published port:
 *   MCP_URL=http://127.0.0.1:3015/mcp node test/jobs.mjs
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = process.env.MCP_URL || 'http://127.0.0.1:3015/mcp';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const json = (result) => JSON.parse(result.content[0].text);

const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
  requestInit: {
    headers: {
      'X-User-Email': 'job.suite@example.com',
      'X-User-ID': 'job-suite',
      'X-User-Username': 'jobsuite',
    },
  },
});
const client = new Client({ name: 'mcp-linux-job-test', version: '1.0.0' });
await client.connect(transport);

console.log('=== background jobs ===\n');

{
  const names = (await client.listTools()).tools.map((t) => t.name);
  for (const tool of ['start_job', 'job_status', 'read_job_output', 'wait_for_job', 'list_jobs', 'kill_job']) {
    assert(names.includes(tool), `${tool} is registered`);
  }
  console.log('✓ all six job tools are exposed');
}

{
  const started = json(await client.callTool({ name: 'start_job', arguments: { command: 'sleep 1; echo started-fine' } }));
  assert(/^[0-9a-f-]{36}$/.test(started.job_id), 'start_job returns a job id');
  assert(started.state === 'running', 'a fresh job is running');
  assert(typeof started.pid === 'number', 'start_job reports the pid');
  console.log('✓ start_job returns immediately with a job id');
}

{
  /* A client timeout far shorter than the job: it must survive on progress notifications alone,
   * which is exactly how LibreChat runs tool calls (resetTimeoutOnProgress). */
  const started = json(await client.callTool({ name: 'start_job', arguments: { command: 'sleep 6; echo slow-job-done; exit 3' } }));
  let progress = 0;
  const result = json(
    await client.callTool(
      { name: 'wait_for_job', arguments: { job_id: started.job_id, timeout_seconds: 30 } },
      undefined,
      { onprogress: () => { progress++; }, timeout: 4000, resetTimeoutOnProgress: true },
    ),
  );

  assert(progress >= 2, `progress notifications keep the call alive, got ${progress}`);
  assert(result.state === 'failed', `non-zero exit is reported as failed, got ${result.state}`);
  assert(result.exit_code === 3, `exit code survives an exit inside the command, got ${result.exit_code}`);
  assert(/slow-job-done/.test(result.output), 'output is returned with the result');
  console.log(`✓ wait_for_job outlives a 4s client timeout (${progress} progress events) and reports exit 3`);
}

{
  const started = json(await client.callTool({ name: 'start_job', arguments: { command: 'sleep 120' } }));
  const killed = json(await client.callTool({ name: 'kill_job', arguments: { job_id: started.job_id } }));
  assert(killed.killed === true, 'kill_job terminates a running job');

  const after = json(await client.callTool({ name: 'job_status', arguments: { job_id: started.job_id } }));
  assert(after.state !== 'running', `a killed job is no longer running, got ${after.state}`);
  console.log('✓ kill_job stops a running job');
}

{
  const started = json(await client.callTool({ name: 'start_job', arguments: { command: "python3 -c \"print('X'*200000)\"" } }));
  await client.callTool({ name: 'wait_for_job', arguments: { job_id: started.job_id, timeout_seconds: 60 } }, undefined, {
    onprogress: () => {},
    resetTimeoutOnProgress: true,
  });

  const capped = json(await client.callTool({ name: 'read_job_output', arguments: { job_id: started.job_id } }));
  assert(capped.output_truncated === true, 'large job output is capped');
  assert(capped.output.length < capped.total_chars, 'capped output is shorter than the whole log');

  const paged = json(await client.callTool({ name: 'read_job_output', arguments: { job_id: started.job_id, offset: 10, length: 25 } }));
  assert(paged.output.length === 25, `an explicit length is honoured, got ${paged.output.length}`);
  console.log('✓ read_job_output caps by default and pages on request');
}

{
  const listed = json(await client.callTool({ name: 'list_jobs', arguments: {} }));
  assert(listed.total >= 4, `list_jobs sees the jobs from this run, got ${listed.total}`);
  const timestamps = listed.jobs.map((j) => j.started_at);
  assert(
    timestamps.every((t, i) => i === 0 || timestamps[i - 1] >= t),
    'list_jobs returns newest first',
  );
  console.log('✓ list_jobs reports every job, newest first');
}

await client.close();
console.log('\n=== All tests passed ===');
