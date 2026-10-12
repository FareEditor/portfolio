// Сверка ключей опций формы: константы сайта и воркера обязаны совпадать побайтно.
//   node scripts/check-form-options.mjs [formOptions.js] [worker index.js]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = (arg, fallback) => arg || fileURLToPath(new URL(fallback, import.meta.url));
const files = {
  site: path(process.argv[2], '../src/formOptions.js'),
  worker: path(process.argv[3], '../../worker/src/index.js'),
};

function literal(file, name) {
  const match = new RegExp(`^(?:export )?const ${name} = (\\[[^\\]]*\\]);$`, 'm').exec(readFileSync(file, 'utf8'));
  if (!match) throw new Error(`check-form-options: в ${file} не найдена константа ${name}`);
  return match[1];
}

let failed = false;
for (const name of ['PROJECT_TYPES', 'BUDGETS']) {
  const site = literal(files.site, name);
  const worker = literal(files.worker, name);
  if (site !== worker) {
    failed = true;
    console.error(`check-form-options: ${name} расходится\n  сайт:   ${site}\n  воркер: ${worker}`);
  }
}
if (failed) {
  console.error('Сборка остановлена: форма отправляла бы ключи, которые воркер отвергнет.');
  process.exit(1);
}
console.log('form options: site = worker');
