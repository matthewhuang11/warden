import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Parser from 'web-tree-sitter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRAMMARS_DIR = path.join(__dirname, '..', '..', 'grammars');

let initPromise: Promise<void> | null = null;
let typescriptLanguage: Parser.Language | null = null;
let tsxLanguage: Parser.Language | null = null;

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init({
      locateFile: () => path.join(GRAMMARS_DIR, 'tree-sitter.wasm'),
    });
  }
  await initPromise;
}

export type Dialect = 'typescript' | 'tsx';

export async function loadLanguage(dialect: Dialect): Promise<Parser.Language> {
  await ensureInit();
  if (dialect === 'typescript') {
    if (!typescriptLanguage) {
      const bytes = readFileSync(path.join(GRAMMARS_DIR, 'tree-sitter-typescript.wasm'));
      typescriptLanguage = await Parser.Language.load(bytes);
    }
    return typescriptLanguage;
  }
  if (!tsxLanguage) {
    const bytes = readFileSync(path.join(GRAMMARS_DIR, 'tree-sitter-tsx.wasm'));
    tsxLanguage = await Parser.Language.load(bytes);
  }
  return tsxLanguage;
}

export async function createParser(dialect: Dialect): Promise<Parser> {
  const language = await loadLanguage(dialect);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}
