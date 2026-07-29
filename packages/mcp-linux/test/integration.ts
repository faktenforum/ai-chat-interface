/**
 * Integration Tests for MCP Linux Server
 *
 * Tests utility functions and module-level logic (does not require root or Docker).
 * Run: node --experimental-strip-types --experimental-transform-types --no-warnings test/integration.ts
 */

import { deriveUsername, addUsernameSuffix, sanitizeWorkspaceName, validateWorkspaceName } from '../src/utils/security.ts';
import { extractUserContext } from '../src/utils/http-server.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTests(): void {
  console.log('=== MCP Linux Integration Tests ===\n');

  // ── deriveUsername ──────────────────────────────────────────────────────────

  {
    const result = deriveUsername('pascal.garber@correctiv.org');
    assert(result === 'lc_pascal_garber', `deriveUsername: expected lc_pascal_garber, got ${result}`);
    console.log('✓ deriveUsername: pascal.garber@correctiv.org -> lc_pascal_garber');
  }

  {
    const result = deriveUsername('jane.doe@example.com');
    assert(result === 'lc_jane_doe', `deriveUsername: expected lc_jane_doe, got ${result}`);
    console.log('✓ deriveUsername: jane.doe@example.com -> lc_jane_doe');
  }

  {
    const result = deriveUsername('user+tag@example.com');
    assert(result === 'lc_user_tag', `deriveUsername: expected lc_user_tag, got ${result}`);
    console.log('✓ deriveUsername: user+tag@example.com -> lc_user_tag');
  }

  {
    const result = deriveUsername('ALL.CAPS@EXAMPLE.COM');
    assert(result === 'lc_all_caps', `deriveUsername: expected lc_all_caps, got ${result}`);
    console.log('✓ deriveUsername: ALL.CAPS@EXAMPLE.COM -> lc_all_caps (lowercase)');
  }

  {
    // Very long email local part
    const longLocal = 'a'.repeat(40) + '@example.com';
    const result = deriveUsername(longLocal);
    assert(result.length <= 32, `deriveUsername: length ${result.length} exceeds 32`);
    assert(result.startsWith('lc_'), `deriveUsername: should start with lc_`);
    console.log(`✓ deriveUsername: truncates long local part to ${result.length} chars`);
  }

  // ── addUsernameSuffix ──────────────────────────────────────────────────────

  {
    const result = addUsernameSuffix('lc_pascal_garber', 2);
    assert(result === 'lc_pascal_garber_2', `addUsernameSuffix: expected lc_pascal_garber_2, got ${result}`);
    console.log('✓ addUsernameSuffix: lc_pascal_garber + 2 -> lc_pascal_garber_2');
  }

  // ── sanitizeWorkspaceName ──────────────────────────────────────────────────

  {
    const result = sanitizeWorkspaceName('My Project');
    assert(result === 'my_project', `sanitizeWorkspaceName: expected my_project, got ${result}`);
    console.log('✓ sanitizeWorkspaceName: "My Project" -> my_project');
  }

  {
    const result = sanitizeWorkspaceName('test@#$repo');
    assert(result === 'test_repo', `sanitizeWorkspaceName: expected test_repo, got ${result}`);
    console.log('✓ sanitizeWorkspaceName: "test@#$repo" -> test_repo');
  }

  // ── validateWorkspaceName ──────────────────────────────────────────────────

  {
    const result = validateWorkspaceName('my-project');
    assert(result === null, `validateWorkspaceName: expected null (valid), got ${result}`);
    console.log('✓ validateWorkspaceName: "my-project" is valid');
  }

  {
    const result = validateWorkspaceName('');
    assert(result !== null, 'validateWorkspaceName: expected error for empty name');
    console.log('✓ validateWorkspaceName: empty string is invalid');
  }

  {
    const result = validateWorkspaceName('..');
    assert(result !== null, 'validateWorkspaceName: expected error for ".."');
    console.log('✓ validateWorkspaceName: ".." is invalid');
  }

  {
    const result = validateWorkspaceName('path/traversal');
    assert(result !== null, 'validateWorkspaceName: expected error for path separator');
    console.log('✓ validateWorkspaceName: path separator is invalid');
  }

  // ── extractUserContext ──────────────────────────────────────────────────────

  {
    const context = extractUserContext({
      'x-user-email': 'jane.doe@example.com',
      'x-user-github-pat': 'ghp_usertoken',
    } as never);
    assert(context?.githubPat === 'ghp_usertoken', 'extractUserContext: own PAT should be read');
    console.log('✓ extractUserContext: reads the user GitHub token');
  }

  {
    /* LibreChat drops the header for an unset optional var, but an older build sends the literal
     * placeholder - which is not a credential. */
    for (const value of ['{{GITHUB_PAT}}', '', '   ', undefined]) {
      const context = extractUserContext({
        'x-user-email': 'jane.doe@example.com',
        ...(value === undefined ? {} : { 'x-user-github-pat': value }),
      } as never);
      assert(
        context?.githubPat === null,
        `extractUserContext: ${JSON.stringify(value)} should count as no token`,
      );
    }
    console.log('✓ extractUserContext: placeholder, blank and absent all mean no token');
  }

  {
    const context = extractUserContext({ 'x-user-github-pat': 'ghp_usertoken' } as never);
    assert(context === null, 'extractUserContext: email stays required');
    console.log('✓ extractUserContext: a token without an email is not a user context');
  }

  console.log('\n=== All tests passed ===');
}

runTests();
