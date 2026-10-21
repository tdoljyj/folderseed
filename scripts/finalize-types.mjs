import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist-lib/types/', import.meta.url));

/** Make declarations usable with both Bundler and NodeNext module resolution. */
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.name.endsWith('.d.ts')) {
      const source = readFileSync(file, 'utf8')
        // Styles have their own public package export and no runtime type dependency.
        .replace(/^import\s+['"][^'"]+\.css['"];?\s*$/gm, '')
        .replace(/(['"])(\.{1,2}\/[^'"]+)\1/g, (match, quote, specifier) => {
          if (/\.[a-z]+$/i.test(specifier)) return match;
          const target = resolve(dirname(file), specifier);
          if (existsSync(`${target}.d.ts`)) return `${quote}${specifier}.js${quote}`;
          if (existsSync(join(target, 'index.d.ts'))) return `${quote}${specifier}/index.js${quote}`;
          throw new Error(`Unresolved declaration import: ${specifier} in ${file}`);
        });
      writeFileSync(file, source);
    }
  }
}

visit(root);
writeFileSync(new URL('../dist-lib/styles.d.ts', import.meta.url), 'export {};\n');

// Keep the bundled brand font license with redistributable library output.
copyFileSync(new URL('../public/SourceSans3-OFL.txt', import.meta.url), new URL('../dist-lib/SourceSans3-OFL.txt', import.meta.url));
