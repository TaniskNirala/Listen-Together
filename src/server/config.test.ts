import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDatabaseUrl } from './config.ts';

test('normalizeDatabaseUrl cleans Neon psql snippets, quotes, and env prefixes', () => {
  const clean =
    'postgresql://neondb_owner:secret@ep-cool-river-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

  assert.equal(normalizeDatabaseUrl(clean), clean);
  assert.equal(normalizeDatabaseUrl(`  ${clean}  `), clean);
  assert.equal(normalizeDatabaseUrl(`psql '${clean}'`), clean);
  assert.equal(normalizeDatabaseUrl(`psql "${clean}"`), clean);
  assert.equal(normalizeDatabaseUrl(`'${clean}'`), clean);
  assert.equal(normalizeDatabaseUrl(`"${clean}"`), clean);
  assert.equal(normalizeDatabaseUrl(`DATABASE_URL=${clean}`), clean);
  assert.equal(normalizeDatabaseUrl(`DATABASE_URL="${clean}"`), clean);
  assert.equal(normalizeDatabaseUrl(''), '');
  assert.equal(normalizeDatabaseUrl(undefined), '');
});
