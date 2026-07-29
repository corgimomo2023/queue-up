import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const examplePath = fileURLToPath(new URL('../.env.example', import.meta.url));
const requiredSecrets = ['SESSION_SECRET', 'SUPER_ADMIN_KEY'];
const generated = [];

let contents = existsSync(envPath)
  ? readFileSync(envPath, 'utf8')
  : readFileSync(examplePath, 'utf8');

function effectiveValue(value) {
  const trimmed = value.trim();
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  return quoted ? trimmed.slice(1, -1) : trimmed;
}

function needsReplacement(value) {
  const effective = effectiveValue(value);
  return effective.length < 32 || /^(replace-with|change-me|example)/i.test(effective);
}

for (const name of requiredSecrets) {
  const pattern = new RegExp(`^${name}=(.*)$`, 'm');
  const match = contents.match(pattern);
  if (!match || needsReplacement(match[1] ?? '')) {
    const replacement = `${name}=${randomBytes(32).toString('hex')}`;
    contents = match
      ? contents.replace(pattern, replacement)
      : `${contents.trimEnd()}\n${replacement}\n`;
    generated.push(name);
  }
}

writeFileSync(envPath, contents.endsWith('\n') ? contents : `${contents}\n`, { mode: 0o600 });
chmodSync(envPath, 0o600);

console.log(
  generated.length
    ? `Updated .env: generated ${generated.join(', ')} and set permissions to 600.`
    : 'Checked .env: required secrets are valid and permissions are 600.',
);
