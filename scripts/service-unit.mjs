#!/usr/bin/env node
/**
 * Print the systemd user unit scripts/install.sh installs on Linux (bc-obucr.3).
 *
 *   node scripts/service-unit.mjs --node /usr/bin/node --root /srv/beadcause --log ~/.local/state/beadcause/beadcause.log
 *
 * A thin shell over renderSystemdUnit in lib/service.js, so the unit text has exactly one
 * author and test/service.mjs can parse back the same bytes install.sh writes — with no
 * systemd on the machine running the test.
 */
import { renderSystemdUnit } from '../lib/service.js';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

try {
  process.stdout.write(renderSystemdUnit({ node: opt('node'), root: opt('root'), log: opt('log'), envPath: opt('path') }));
} catch (e) {
  console.error(`service-unit: ${e.message}`);
  process.exit(1);
}
