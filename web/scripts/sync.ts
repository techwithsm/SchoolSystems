/**
 * Command-line sync, using the same code as the admin "Sync data" button.
 *
 *   npm run sync                         preview all sources (writes nothing)
 *   npm run sync -- world_bank           preview one source
 *   npm run sync -- --apply              really write (all sources)
 *   npm run sync -- --apply country_files
 *
 * Needs web/.env.local (uses the service_role key, so maintainers only).
 * Runs sources directly (no core.sync_runs row, no admin check).
 */
import { createServiceClient } from '@/lib/supabase/admin';
import { getSources } from '@/lib/sync/registry';
import { createSourceRun } from '@/lib/sync/runner';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const keys = args.filter((a) => !a.startsWith('--'));
  const db = createServiceClient();

  console.log(apply ? 'MODE: APPLY (writing to the database)\n' : 'MODE: PREVIEW (nothing is written)\n');
  let failed = false;

  for (const source of getSources(keys)) {
    const { result, ctx } = createSourceRun(source, db, !apply);
    const t0 = Date.now();
    try {
      await source.run(ctx);
    } catch (err) {
      failed = true;
      result.status = 'failed';
      result.error = err instanceof Error ? err.message : String(err);
    }
    console.log(`== ${source.label} [${result.status}] ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (result.error) console.log(`   ERROR: ${result.error}`);
    for (const [table, t] of Object.entries(result.tables)) {
      console.log(`   ${table.padEnd(36)} +${t.inserted}  ~${t.updated}  =${t.unchanged}  -${t.deleted}`);
    }
    for (const c of result.conflicts) {
      console.log(`   CONFLICT ${c.entity} ${c.field}: current ${String(c.current)}, incoming ${String(c.incoming)}`);
    }
    for (const w of result.warnings) console.log(`   warning: ${w}`);
    console.log();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
