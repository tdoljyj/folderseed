/** Framework-independent, immutable directory model. No filesystem or network access. */
export interface FolderNode {
  id: string;
  name: string;
  comment?: string;
  children: FolderNode[];
}

export interface DirectoryDocument {
  version: 1;
  root: FolderNode;
}

export type Indent = 2 | 4 | 'tabs';
export type ParseIndent = Indent | 'auto';
export type TextFormat = 'auto' | 'plain' | 'markdown' | 'ascii' | 'unicode';
export interface FlatFolder {
  node: FolderNode;
  parentId: string | null;
  depth: number;
  path: string;
}

export const LIMITS = Object.freeze({ nodes: 500, depth: 32, nameLength: 100, nameBytes: 255, commentLength: 500, commentBytes: 262_144, textBytes: 1_000_000 });

export class DirectoryError extends Error {
  readonly code: string;
  readonly line?: number;

  constructor(code: string, message: string, line?: number) {
    super(line === undefined ? message : `Line ${line}: ${message}`);
    this.name = 'DirectoryError';
    this.code = code;
    this.line = line;
  }
}

function fail(code: string, message: string, line?: number): never {
  throw new DirectoryError(code, message, line);
}

let counter = 0;
function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `folder-${Date.now().toString(36)}-${(++counter).toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function nameKey(name: string): string {
  return name.normalize('NFC').toLocaleLowerCase('en-US');
}

/** Reject names that would become unsafe or incompatible ZIP paths on common systems. */
export function validateName(value: unknown, line?: number): string {
  if (typeof value !== 'string' || !value.length) fail('INVALID_NAME', 'Folder names cannot be empty.', line);
  const name = value.normalize('NFC');
  if ([...name].some(char => {
    const point = char.codePointAt(0)!;
    return (point >= 0xd800 && point <= 0xdfff) || (point >= 0xfdd0 && point <= 0xfdef) || (point & 0xffff) >= 0xfffe;
  })) {
    fail('UNSAFE_NAME', 'The name contains invalid Unicode characters. Please enter it again.', line);
  }
  if ([...name].length > LIMITS.nameLength) fail('NAME_TOO_LONG', `Names cannot exceed ${LIMITS.nameLength} characters.`, line);
  if (new TextEncoder().encode(name).byteLength > LIMITS.nameBytes) fail('NAME_TOO_LONG', `Names cannot exceed ${LIMITS.nameBytes} UTF-8 bytes. Please shorten the name.`, line);
  if (name !== name.trim() || name.endsWith('.')) fail('INVALID_NAME', 'Names cannot start or end with whitespace, or end with a period.', line);
  if (name === '.' || name === '..' || /[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)) {
    fail('UNSAFE_NAME', 'Enter a folder name, not a path. Do not use control characters or < > : " / \\ | ? *.', line);
  }
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:\.|$)/iu.test(name)) {
    fail('RESERVED_NAME', 'This name is reserved by the operating system. Please choose another name.', line);
  }
  return name;
}

function checkSize(text: string): void {
  if (new TextEncoder().encode(text).byteLength > LIMITS.textBytes) fail('TEXT_TOO_LARGE', `Input cannot exceed ${LIMITS.textBytes / 1_000_000} MB.`);
}

/** Comments are literal single-line text, never names, paths, or markup. */
export function validateComment(value: unknown, line?: number): string {
  if (typeof value !== 'string') fail('INVALID_COMMENT', 'Folder comments must be text.', line);
  if ([...value].length > LIMITS.commentLength) fail('COMMENT_TOO_LONG', `Folder comments cannot exceed ${LIMITS.commentLength} characters.`, line);
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value) || [...value].some(char => {
    const point = char.codePointAt(0)!;
    return (point >= 0xd800 && point <= 0xdfff) || (point >= 0xfdd0 && point <= 0xfdef) || (point & 0xffff) >= 0xfffe;
  })) fail('UNSAFE_COMMENT', 'Folder comments must be one line without control characters or invalid Unicode.', line);
  return value;
}

/** The first exact delimiter is unambiguous because slashes are invalid in names. */
function parseFolderLabel(label: string, line: number): Pick<FolderNode, 'name' | 'comment'> {
  const delimiter = label.indexOf(' // ');
  let name = delimiter < 0 ? label : label.slice(0, delimiter);
  const comment = delimiter < 0 ? '' : validateComment(label.slice(delimiter + 4), line);
  // A single trailing slash is an optional folder marker, never a path separator.
  if (name.endsWith('/') && !name.endsWith('//')) name = name.slice(0, -1);
  return { name: validateName(name, line), ...(comment === '' ? {} : { comment }) };
}

export function formatFolderLabel(node: Pick<FolderNode, 'name' | 'comment'>): string {
  const name = validateName(node.name);
  const comment = node.comment === undefined ? '' : validateComment(node.comment);
  return comment === '' ? name : `${name} // ${comment}`;
}

/** Validate untrusted JSON and return a clean deep copy; unknown properties are not retained. */
export function validateDocument(input: unknown): DirectoryDocument {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_DOCUMENT', 'The project must be a JSON object.');
  const doc = input as Record<string, unknown>;
  if (doc.version !== 1 && doc.version !== 2) fail('UNSUPPORTED_VERSION', 'Unsupported project version. Please use a version: 1 or version: 2 document.');
  let count = 0;
  let commentBytes = 0;
  const ids = new Set<string>();
  const seen = new WeakSet<object>();
  function visit(value: unknown, depth: number): FolderNode {
    if (depth > LIMITS.depth) fail('TOO_DEEP', `A tree cannot exceed ${LIMITS.depth} levels below its root.`);
    if (++count > LIMITS.nodes) fail('TOO_MANY_FOLDERS', `A project can contain at most ${LIMITS.nodes} folders.`);
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_NODE', 'Each folder must be an object.');
    if (seen.has(value)) fail('CYCLE', 'A tree cannot contain cycles or repeated object references.');
    seen.add(value);
    const node = value as Record<string, unknown>;
    if (typeof node.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(node.id)) fail('INVALID_ID', 'Folder IDs must contain 1–100 letters, numbers, underscores, or hyphens.');
    if (ids.has(node.id)) fail('DUPLICATE_ID', 'The project contains duplicate folder IDs.');
    ids.add(node.id);
    const name = validateName(node.name);
    const comment = node.comment === undefined ? '' : validateComment(node.comment);
    commentBytes += new TextEncoder().encode(comment).byteLength;
    if (commentBytes > LIMITS.commentBytes) fail('COMMENTS_TOO_LARGE', 'Folder comments together cannot exceed 256 KB.');
    if (!Array.isArray(node.children)) fail('INVALID_CHILDREN', 'Each folder must have a children array.');
    const children: FolderNode[] = [];
    const siblingNames = new Set<string>();
    for (const child of node.children) {
      const cleanChild = visit(child, depth + 1);
      const key = nameKey(cleanChild.name);
      if (siblingNames.has(key)) fail('DUPLICATE_NAME', `A folder named “${cleanChild.name}” already exists here (names are case-insensitive).`);
      siblingNames.add(key);
      children.push(cleanChild);
    }
    return { id: node.id, name, ...(comment === '' ? {} : { comment }), children };
  }
  return { version: 1, root: visit(doc.root, 0) };
}

export function createDocument(rootName = 'My project'): DirectoryDocument {
  return { version: 1, root: { id: newId(), name: validateName(rootName), children: [] } };
}

export function parseJSON(text: string): DirectoryDocument {
  checkSize(text);
  let input: unknown;
  try { input = JSON.parse(text); } catch { return fail('INVALID_JSON', 'Invalid JSON. Please check the quotes, commas, and brackets.'); }
  return validateDocument(input);
}

export function serializeJSON(doc: DirectoryDocument): string {
  const clean = validateDocument(doc);
  const version = flatten(clean).some(({ node }) => node.comment !== undefined) ? 2 : 1;
  const output = { version, root: clean.root };
  let json = JSON.stringify(output, null, 2);
  // Keep even maximum-size annotated projects re-importable within the input cap.
  if (new TextEncoder().encode(json).byteLength > LIMITS.textBytes) json = JSON.stringify(output);
  checkSize(json);
  return json;
}

interface SourceLine { text: string; line: number }

function sourceLines(text: string): SourceLine[] {
  const all = text.replace(/^\uFEFF/u, '').replace(/\r\n?/g, '\n').split('\n').map((text, i) => ({ text, line: i + 1 }));
  // Fences must be unindented, so a folder literally named ``` remains valid.
  const fencePattern = /^(`{3,}|~{3,})(?:text|txt|tree|plaintext)?\s*$/i;
  const start = all.findIndex(item => fencePattern.test(item.text));
  let lines = all;
  if (start >= 0) {
    const opening = all[start].text.match(fencePattern)![1];
    const end = all.findIndex((item, index) => index > start && item.text[0] === opening[0] && item.text.trim().length >= opening.length && /^(`+|~+)\s*$/.test(item.text));
    if (end < 0) {
      // One fence-like root plus indented/tree children is ordinary folder text.
      const looksLikePlainTree = start === 0 && all.slice(1).every(item => !item.text.trim() || /^(?:[ \t]|├── |└── |│   )/.test(item.text));
      if (!looksLikePlainTree) {
        const otherFence = all.findIndex((item, index) => index > start && fencePattern.test(item.text));
        fail('MARKDOWN_FENCE', 'Please provide a complete Markdown code block with matching fences.', all[otherFence < 0 ? start : otherFence].line);
      }
    } else {
      if (all.slice(end + 1).some(item => fencePattern.test(item.text))) fail('MARKDOWN_FENCE', 'Import only one Markdown code block at a time.', all[end].line);
      lines = all.slice(start + 1, end);
    }
  }
  return lines.filter(item => item.text.trim().length > 0);
}

/**
 * Parse one root and its children. Automatic mode infers 2 spaces, 4 spaces or tabs
 * from the first indented line, then requires one consistent style throughout.
 * Generated Unicode trees and a single fenced Markdown block are also accepted.
 */
export function parseIndented(text: string, indent: ParseIndent = 'auto'): DirectoryDocument {
  checkSize(text);
  if (!['auto', 2, 4, 'tabs'].includes(indent)) fail('INVALID_INDENT', 'Choose automatic indentation, 2 spaces, 4 spaces, or tabs.');
  const lines = sourceLines(text);
  if (!lines.length) fail('EMPTY_TEXT', 'Enter a root folder name.');
  const treeMode = lines.length > 1 && /^(?:├── |└── )/.test(lines[1].text);
  let detected: Indent | undefined = indent === 'auto' ? undefined : indent;
  let root: FolderNode | undefined;
  const stack: FolderNode[] = [];
  let previousDepth = 0;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const source = lines[i];
    let name: string;
    let depth: number;
    if (treeMode && i > 0) {
      const match = /^((?:│   |    )*)(?:├── |└── )(.*)$/.exec(source.text);
      if (!match) fail('TREE_FORMAT', 'Invalid tree text. Keep the branch characters and four-character indentation intact.', source.line);
      depth = match[1].length / 4 + 1;
      name = match[2];
    } else {
      const prefix = /^[ \t]*/.exec(source.text)![0];
      name = source.text.slice(prefix.length);
      if (prefix.includes(' ') && prefix.includes('\t')) fail('MIXED_INDENT', 'Do not mix spaces and tabs in an indentation prefix.', source.line);
      if (prefix.length) {
        const style: Indent = prefix.includes('\t') ? 'tabs' : prefix.length === 2 ? 2 : 4;
        if (!detected) {
          if (style !== 'tabs' && prefix.length !== 2 && prefix.length !== 4) fail('INVALID_INDENT', 'Indent the first child with 2 or 4 spaces, or one tab.', source.line);
          detected = style;
        }
        if ((detected === 'tabs') !== (style === 'tabs')) fail('MIXED_INDENT', 'Use either spaces or tabs consistently throughout the text.', source.line);
        if (detected !== 'tabs' && prefix.length % detected !== 0) fail('INVALID_INDENT', `Indentation must be a multiple of ${detected} spaces.`, source.line);
        depth = detected === 'tabs' ? prefix.length : prefix.length / detected;
      } else depth = 0;
    }
    if (i === 0 && depth !== 0) fail('ROOT_INDENT', 'The root folder must not be indented.', source.line);
    if (i > 0 && depth === 0) fail('MULTIPLE_ROOTS', 'Use one root folder. Indent its child folders.', source.line);
    if (depth > previousDepth + 1) fail('INDENT_JUMP', 'Do not skip a folder level. Increase indentation by one level at a time.', source.line);
    if (depth > LIMITS.depth) fail('TOO_DEEP', `A tree cannot exceed ${LIMITS.depth} levels below its root.`, source.line);
    if (++count > LIMITS.nodes) fail('TOO_MANY_FOLDERS', `A project can contain at most ${LIMITS.nodes} folders.`, source.line);
    const node: FolderNode = { id: newId(), ...parseFolderLabel(name, source.line), children: [] };
    if (depth === 0) root = node;
    else {
      const parent = stack[depth - 1];
      if (!parent) fail('INDENT_JUMP', 'This folder is missing its parent level.', source.line);
      if (parent.children.some(child => nameKey(child.name) === nameKey(node.name))) fail('DUPLICATE_NAME', `A folder named “${node.name}” already exists here (names are case-insensitive).`, source.line);
      parent.children.push(node);
    }
    stack[depth] = node;
    stack.length = depth + 1;
    previousDepth = depth;
  }
  return validateDocument({ version: 1, root: root! });
}

type ExplicitTextFormat = Exclude<TextFormat, 'auto'>;
interface ParsedFolder { name: string; depth: number; line: number }
const TEXT_FORMATS: readonly TextFormat[] = ['auto', 'plain', 'markdown', 'ascii', 'unicode'];
const FENCE_PATTERN = /^(`{3,}|~{3,})([a-zA-Z0-9_-]*)[ \t]*$/;

function rawSourceLines(text: string): SourceLine[] {
  return text.replace(/^\uFEFF/u, '').replace(/\r\n?/g, '\n').split('\n')
    .map((text, index) => ({ text, line: index + 1 })).filter(source => source.text.trim().length > 0);
}

function locateFence(lines: SourceLine[]) {
  const start = lines.findIndex(source => FENCE_PATTERN.test(source.text));
  if (start < 0) return undefined;
  const match = lines[start].text.match(FENCE_PATTERN)!;
  const delimiter = match[1];
  const end = lines.findIndex((source, index) => index > start
    && source.text[0] === delimiter[0] && source.text.trim().length >= delimiter.length
    && /^(`+|~+)[ \t]*$/.test(source.text));
  return { start, end, language: match[2].toLowerCase() };
}

function inferTextFormat(lines: SourceLine[]): ExplicitTextFormat {
  if (!lines.length) return 'plain';
  const fence = locateFence(lines);
  if (fence && fence.end >= 0) return 'markdown';
  // Check the first child before the root: a tree root may literally begin with '- '.
  if (lines.length > 1) {
    if (/^[ \t]*[├└│]/u.test(lines[1].text)) return 'unicode';
    if (/^[ \t]*(?:\||`--|\+--)/.test(lines[1].text)) return 'ascii';
  }
  if (/^[-+*](?:[ \t]|$)/.test(lines[0].text)) return 'markdown';
  if (fence && (fence.start > 0 || lines.slice(fence.start + 1).some(source => !/^[ \t]/.test(source.text)))) return 'markdown';
  return 'plain';
}

/** A syntax hint, not validation. Choose 'plain' explicitly for ambiguous literal punctuation. */
export function detectTextFormat(text: string): ExplicitTextFormat {
  checkSize(text);
  return inferTextFormat(rawSourceLines(text));
}

function decodeMarkdownName(label: string, line: number): string {
  if (label.startsWith('`')) {
    const delimiter = /^`+/.exec(label)![0];
    const closing = /`+$/.exec(label)?.[0];
    if (closing !== delimiter || label.length < delimiter.length * 2) {
      fail('MARKDOWN_NAME', 'Close the code span around this folder name, or escape a literal backtick with a backslash.', line);
    }
    let contents = label.slice(delimiter.length, -delimiter.length);
    if ((contents.match(/`+/g) ?? []).some(run => run.length === delimiter.length)) {
      fail('MARKDOWN_NAME', 'Use one code span for the entire name, with a delimiter longer than any backtick run inside it.', line);
    }
    // CommonMark removes one surrounding space when both sides have one.
    if (contents.startsWith(' ') && contents.endsWith(' ') && contents.trim()) contents = contents.slice(1, -1);
    return contents;
  }
  // Decode only Markdown punctuation escapes. Unknown escapes stay literal and are validated.
  return label.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1');
}

function parseIndentedRecords(lines: SourceLine[], indent: ParseIndent, markdown: boolean): ParsedFolder[] {
  if (lines.length > LIMITS.nodes) fail('TOO_MANY_FOLDERS', `A project can contain at most ${LIMITS.nodes} folders.`, lines[LIMITS.nodes].line);
  let detected: Indent | undefined = indent === 'auto' ? undefined : indent;
  return lines.map(source => {
    const prefix = /^[ \t]*/.exec(source.text)![0];
    let name = source.text.slice(prefix.length);
    if (markdown) {
      const item = /^[-+*](?:[ \t]+(.*))?$/.exec(name);
      if (!item) fail('MARKDOWN_SYNTAX', 'Use one folder per list item, beginning with -, +, or *. Ordered lists and paragraph continuations are not supported.', source.line);
      name = decodeMarkdownName(item[1] ?? '', source.line);
    }
    if (prefix.includes(' ') && prefix.includes('\t')) fail('MIXED_INDENT', 'Do not mix spaces and tabs in an indentation prefix.', source.line);
    let depth = 0;
    if (prefix.length) {
      const tabs = prefix.includes('\t');
      if (!detected) {
        if (!tabs && prefix.length !== 2 && prefix.length !== 4) fail('INVALID_INDENT', 'Indent the first child with 2 or 4 spaces, or one tab.', source.line);
        detected = tabs ? 'tabs' : prefix.length as 2 | 4;
      }
      if ((detected === 'tabs') !== tabs) fail('MIXED_INDENT', 'Use either spaces or tabs consistently throughout the text.', source.line);
      if (detected !== 'tabs' && prefix.length % detected !== 0) fail('INVALID_INDENT', `Indentation must be a multiple of ${detected} spaces.`, source.line);
      depth = detected === 'tabs' ? prefix.length : prefix.length / detected;
    }
    return { name, depth, line: source.line };
  });
}

function parseTreeRecords(lines: SourceLine[], format: 'ascii' | 'unicode'): ParsedFolder[] {
  if (lines.length > LIMITS.nodes) fail('TOO_MANY_FOLDERS', `A project can contain at most ${LIMITS.nodes} folders.`, lines[LIMITS.nodes].line);
  const pattern = format === 'ascii' ? /^((?:\|   |    )*)(?:\|-- |`-- |\+-- )(.*)$/ : /^((?:│   |    )*)(?:├── |└── )(.*)$/u;
  return lines.map((source, index) => {
    if (index === 0) {
      if (/^[ \t]/.test(source.text)) fail('ROOT_INDENT', 'The root folder must not be indented.', source.line);
      return { name: source.text, depth: 0, line: source.line };
    }
    const match = pattern.exec(source.text);
    if (!match) fail('TREE_FORMAT', `Invalid ${format === 'ascii' ? 'ASCII' : 'Unicode'} tree. Use complete branch markers and consistent four-character connector columns.`, source.line);
    return { name: match[2], depth: match[1].length / 4 + 1, line: source.line };
  });
}

function buildTextDocument(records: ParsedFolder[]): DirectoryDocument {
  if (!records.length) fail('EMPTY_TEXT', 'Enter a root folder name.');
  const stack: FolderNode[] = [];
  let root: FolderNode | undefined;
  let previousDepth = 0;
  records.forEach((record, index) => {
    const { depth, line } = record;
    if (index === 0 && depth !== 0) fail('ROOT_INDENT', 'The root folder must not be indented.', line);
    if (index > 0 && depth === 0) fail('MULTIPLE_ROOTS', 'Use one root folder. Indent its child folders.', line);
    if (depth > previousDepth + 1) fail('INDENT_JUMP', 'Do not skip a folder level. Increase indentation by one level at a time.', line);
    if (depth > LIMITS.depth) fail('TOO_DEEP', `A tree cannot exceed ${LIMITS.depth} levels below its root.`, line);
    if (index >= LIMITS.nodes) fail('TOO_MANY_FOLDERS', `A project can contain at most ${LIMITS.nodes} folders.`, line);
    const node: FolderNode = { id: newId(), ...parseFolderLabel(record.name, line), children: [] };
    if (depth === 0) root = node;
    else {
      const parent = stack[depth - 1];
      if (!parent) fail('INDENT_JUMP', 'This folder is missing its parent level.', line);
      if (parent.children.some(child => nameKey(child.name) === nameKey(node.name))) fail('DUPLICATE_NAME', `A folder named “${node.name}” already exists here (names are case-insensitive).`, line);
      parent.children.push(node);
    }
    stack[depth] = node;
    stack.length = depth + 1;
    previousDepth = depth;
  });
  return validateDocument({ version: 1, root: root! });
}

function parseTextLines(lines: SourceLine[], format: ExplicitTextFormat, indent: ParseIndent): DirectoryDocument {
  if (format === 'markdown') {
    const fence = locateFence(lines);
    if (fence) {
      if (fence.end < 0) fail('MARKDOWN_FENCE', 'Please provide a complete Markdown code block with matching fences.', lines[fence.start].line);
      if (lines.slice(fence.end + 1).some(source => FENCE_PATTERN.test(source.text))) fail('MARKDOWN_FENCE', 'Import only one Markdown code block at a time.', lines[fence.end].line);
      const body = lines.slice(fence.start + 1, fence.end);
      const { language } = fence;
      if (!['', 'text', 'txt', 'tree', 'plain', 'plaintext', 'ascii', 'unicode', 'markdown', 'md'].includes(language)) {
        fail('MARKDOWN_FENCE', 'Use a text, plain, ascii, unicode, or markdown code block for a directory structure.', lines[fence.start].line);
      }
      const inferred = inferTextFormat(body);
      const payloadFormat: ExplicitTextFormat = language === 'plain' || language === 'plaintext' ? 'plain'
        : language === 'ascii' || language === 'unicode' ? language
          : language === 'markdown' || language === 'md' ? 'markdown' : inferred === 'markdown' ? 'plain' : inferred;
      // A fence-like root inside a larger fence is data, not another Markdown document.
      if (payloadFormat === 'markdown') return buildTextDocument(parseIndentedRecords(body, indent, true));
      return parseTextLines(body, payloadFormat, indent);
    }
    return buildTextDocument(parseIndentedRecords(lines, indent, true));
  }
  return buildTextDocument(format === 'plain' ? parseIndentedRecords(lines, indent, false) : parseTreeRecords(lines, format));
}

/** Parse an explicit syntax without changing literal plain-text prefixes; auto is a heuristic. */
export function parseText(text: string, format: TextFormat = 'auto', indent: ParseIndent = 'auto'): DirectoryDocument {
  checkSize(text);
  if (!TEXT_FORMATS.includes(format)) fail('INVALID_FORMAT', 'Choose auto, plain, markdown, ascii, or unicode text.');
  if (!['auto', 2, 4, 'tabs'].includes(indent)) fail('INVALID_INDENT', 'Choose automatic indentation, 2 spaces, 4 spaces, or tabs.');
  const lines = rawSourceLines(text);
  return parseTextLines(lines, format === 'auto' ? inferTextFormat(lines) : format, indent);
}

/** Nested Markdown lists with whole-label code spans, safe for punctuation and backticks. */
export function formatMarkdown(doc: DirectoryDocument, indent: Indent = 2): string {
  if (![2, 4, 'tabs'].includes(indent)) fail('INVALID_INDENT', 'Choose 2 spaces, 4 spaces, or tabs for indentation.');
  const unit = indent === 'tabs' ? '\t' : ' '.repeat(indent);
  return flatten(doc).map(({ node, depth }) => {
    const label = formatFolderLabel(node);
    const longestRun = Math.max(0, ...(label.match(/`+/g) ?? []).map(run => run.length));
    const delimiter = '`'.repeat(longestRun + 1);
    const padding = label.startsWith('`') || label.endsWith('`') ? ' ' : '';
    return `${unit.repeat(depth)}- ${delimiter}${padding}${label}${padding}${delimiter}`;
  }).join('\n');
}

/** Four-column ASCII tree using |--, `--, and | continuation guides. */
export function formatASCII(doc: DirectoryDocument): string {
  const { root } = validateDocument(doc);
  const lines = [formatFolderLabel(root)];
  function visit(node: FolderNode, prefix: string): void {
    node.children.forEach((child, index) => {
      const last = index === node.children.length - 1;
      lines.push(`${prefix}${last ? '`-- ' : '|-- '}${formatFolderLabel(child)}`);
      visit(child, `${prefix}${last ? '    ' : '|   '}`);
    });
  }
  visit(root, '');
  return lines.join('\n');
}

export function formatText(doc: DirectoryDocument, format: ExplicitTextFormat = 'plain', indent: Indent = 2): string {
  if (![2, 4, 'tabs'].includes(indent)) fail('INVALID_INDENT', 'Choose 2 spaces, 4 spaces, or tabs for indentation.');
  switch (format) {
    case 'plain': return formatIndented(doc, indent);
    case 'markdown': return formatMarkdown(doc, indent);
    case 'ascii': return formatASCII(doc);
    case 'unicode': return formatTree(doc);
    default: return fail('INVALID_FORMAT', 'Choose plain, markdown, ascii, or unicode for text output.');
  }
}

export function flatten(doc: DirectoryDocument): FlatFolder[] {
  const clean = validateDocument(doc);
  const result: FlatFolder[] = [];
  function visit(node: FolderNode, parentId: string | null, depth: number, path: string): void {
    result.push({ node, parentId, depth, path });
    for (const child of node.children) visit(child, node.id, depth + 1, `${path}/${child.name}`);
  }
  visit(clean.root, null, 0, clean.root.name);
  return result;
}

export function formatIndented(doc: DirectoryDocument, indent: Indent = 2): string {
  if (![2, 4, 'tabs'].includes(indent)) fail('INVALID_INDENT', 'Choose 2 spaces, 4 spaces, or tabs for indentation.');
  const unit = indent === 'tabs' ? '\t' : ' '.repeat(indent);
  return flatten(doc).map(({ node, depth }) => `${unit.repeat(depth)}${formatFolderLabel(node)}`).join('\n');
}

export function formatTree(doc: DirectoryDocument): string {
  const { root } = validateDocument(doc);
  const lines = [formatFolderLabel(root)];
  function visit(node: FolderNode, prefix: string): void {
    node.children.forEach((child, index) => {
      const last = index === node.children.length - 1;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${formatFolderLabel(child)}`);
      visit(child, `${prefix}${last ? '    ' : '│   '}`);
    });
  }
  visit(root, '');
  return lines.join('\n');
}

function locate(root: FolderNode, id: string, parent: FolderNode | null = null): { node: FolderNode; parent: FolderNode | null } | undefined {
  if (root.id === id) return { node: root, parent };
  for (const child of root.children) {
    const found = locate(child, id, root);
    if (found) return found;
  }
  return undefined;
}

function requireNode(doc: DirectoryDocument, id: string): { node: FolderNode; parent: FolderNode | null } {
  return locate(doc.root, id) ?? fail('NOT_FOUND', 'This folder no longer exists. Please select another folder.');
}

export function addFolder(doc: DirectoryDocument, parentId: string, name: string): DirectoryDocument {
  const clean = validateDocument(doc);
  const parent = requireNode(clean, parentId).node;
  parent.children.push({ id: newId(), name: validateName(name), children: [] });
  return validateDocument(clean);
}

export function renameFolder(doc: DirectoryDocument, id: string, name: string): DirectoryDocument {
  const clean = validateDocument(doc);
  requireNode(clean, id).node.name = validateName(name);
  return validateDocument(clean);
}

/** Change only one folder's comment; an empty string removes it. */
export function setFolderComment(doc: DirectoryDocument, id: string, comment: string): DirectoryDocument {
  const clean = validateDocument(doc);
  const node = requireNode(clean, id).node;
  const value = validateComment(comment);
  if (value === '') delete node.comment;
  else node.comment = value;
  return validateDocument(clean);
}

export function removeFolder(doc: DirectoryDocument, id: string): DirectoryDocument {
  const clean = validateDocument(doc);
  const { node, parent } = requireNode(clean, id);
  if (!parent) fail('ROOT_OPERATION', 'The root folder cannot be deleted. Rename it or start with a blank template.');
  parent.children = parent.children.filter(child => child.id !== node.id);
  return clean;
}

/** index is the destination position after removing the source; omitted means append. */
export function moveFolder(doc: DirectoryDocument, id: string, parentId: string, index?: number): DirectoryDocument {
  const clean = validateDocument(doc);
  const { node, parent } = requireNode(clean, id);
  if (!parent) fail('ROOT_OPERATION', 'The root folder cannot be moved.');
  const destination = requireNode(clean, parentId).node;
  if (locate(node, destination.id)) fail('CYCLE', 'A folder cannot be moved into itself or one of its descendants.');
  parent.children = parent.children.filter(child => child.id !== node.id);
  const targetIndex = index ?? destination.children.length;
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > destination.children.length) fail('INDEX_RANGE', 'The destination position is outside the folder list.');
  destination.children.splice(targetIndex, 0, node);
  return validateDocument(clean);
}
