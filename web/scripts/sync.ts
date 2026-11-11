/**
 * Command-line sync, using the same code as the admin "Sync data" button.
 *
 *   npm run sync                          preview all sources (writes nothing)
 *   npm run sync -- world_bank            preview one source
 *   npm run sync -- --apply               really write (all sources)
 *   npm run sync -- --apply mx_sep        one source, then the website check
 *   npm run sync -- --apply mx_sep --no-website-check
 *
 * When sources that load institutions are applied, the website check
 * ("Data quality: check websites & find phone numbers") runs automatically
 * afterwards, for up to WEBSITE_CHECK_SECONDS (default 14400 = 4 hours here).
 *
 * Needs web/.env.local (uses the service_role key, so maintainers only).
 * Runs sources directly (no core.sync_runs row, no admin check).
 */
import { createServiceClient } from '@/lib/supabase/admin';
import { getSources } from '@/lib/sync/registry';
import { createSourceRun, needsWebsiteCheck, WEBSITE_CHECK_KEY } from '@/lib/sync/runner';
import type { SyncSource } from '@/lib/sync/types';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const skipWebsiteCheck = args.includes('--no-website-check');
  const keys = args.filter((a) => !a.startsWith('--'));
  const db = createServiceClient();

  // The command line has no page time limit: give the website check up to 4 hours.
  process.env.WEBSITE_CHECK_SECONDS ??= '14400';

  console.log(apply ? 'MODE: APPLY (writing to the database)\n' : 'MODE: PREVIEW (nothing is written)\n');
  let failed = false;

  const runOne = async (source: SyncSource, label = source.label) => {
    const { result, ctx } = createSourceRun({ key: source.key, label }, db, !apply);
    const t0 = Date.now();
    try {
      await source.run(ctx);
    } catch (err) {
      failed = true;
      result.status = 'failed';
      result.error = err instanceof Error ? err.message : String(err);
    }
    console.log(`== ${label} [${result.status}] ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (result.error) console.log(`   ERROR: ${result.error}`);
    for (const [table, t] of Object.entries(result.tables)) {
      console.log(`   ${table.padEnd(36)} +${t.inserted}  ~${t.updated}  =${t.unchanged}  -${t.deleted}`);
    }
    for (const c of result.conflicts) {
      console.log(`   CONFLICT ${c.entity} ${c.field}: current ${String(c.current)}, incoming ${String(c.incoming)}`);
    }
    for (const w of result.warnings) console.log(`   warning: ${w}`);
    console.log();
  };

  const sources = getSources(keys);
  for (const source of sources) await runOne(source);

  if (!skipWebsiteCheck && needsWebsiteCheck(sources, !apply)) {
    console.log(`Website check follows automatically (up to ${Number(process.env.WEBSITE_CHECK_SECONDS) / 60} minutes). Stop any time with Ctrl+C; it resumes where it left off next time.\n`);
    const [check] = getSources([WEBSITE_CHECK_KEY]);
    await runOne(check, `${check.label} (automatic)`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
