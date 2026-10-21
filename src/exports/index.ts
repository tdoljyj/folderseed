import { zipSync, type Zippable } from 'fflate';
import {
  flatten,
  formatIndented,
  formatTree,
  serializeJSON,
  validateDocument,
  type DirectoryDocument,
} from '../core';

export type ExportFormat = 'zip' | 'txt' | 'md' | 'json' | 'svg' | 'png';
export interface ExportResult {
  blob: Blob;
  filename: string;
}

const FONT = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
const PNG_MAX_EDGE = 8192;
const PNG_MAX_PIXELS = 32_000_000;
const ROW_HEIGHT = 32;
const FIRST_ROW = 112;

/** XML escaping is mandatory: directory names are user-controlled text, never markup. */
function escapeXML(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]!);
}

function textWidth(value: string): number {
  // Conservative estimate avoids clipping CJK and emoji without requiring a DOM.
  return Array.from(value).reduce((width, character) => width + (character.codePointAt(0)! > 0xFF ? 19 : /[MW@%]/.test(character) ? 17 : 11), 0);
}

/** SVG is vector-only (no HTML, external fonts, scripts, or remote references). */
export function renderSVG(input: DirectoryDocument): { svg: string; width: number; height: number } {
  const document = validateDocument(input);
  const rows = flatten(document);
  const width = Math.max(480, ...rows.map(({ node, depth }) => 120 + depth * 28 + textWidth(node.name)));
  const height = FIRST_ROW + rows.length * ROW_HEIGHT + 40;
  const positions = new Map(rows.map((row, index) => [row.node.id, { x: 44 + row.depth * 28, y: FIRST_ROW + index * ROW_HEIGHT }]));
  const lines: string[] = [];
  for (const { node, parentId } of rows) {
    const position = positions.get(node.id)!;
    if (parentId !== null) {
      const parent = positions.get(parentId)!;
      lines.push(`<path d="M ${parent.x} ${position.y} H ${position.x - 12}"/>`);
    }
    if (node.children.length) {
      const lastChild = positions.get(node.children[node.children.length - 1].id)!;
      lines.push(`<path d="M ${position.x} ${position.y + 12} V ${lastChild.y}"/>`);
    }
  }
  const contents = rows.map(({ node, depth }, index) => {
    const { x, y } = positions.get(node.id)!;
    const fill = depth === 0 ? '#dbeafe' : '#f4dfad';
    const stroke = depth === 0 ? '#4b75ba' : '#aa8541';
    return `<g><path d="M ${x - 9} ${y - 7} h 7 l 3 3 h 9 v 12 h -19 z" fill="${fill}" stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round"/><text x="${x + 22}" y="${y + 5}" font-size="${index === 0 ? 16 : 14}" font-weight="${index === 0 ? 650 : 450}" fill="#222b3b">${escapeXML(node.name)}</text></g>`;
  }).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
<title id="title">${escapeXML(document.root.name)} — directory structure</title>
<desc id="description">${escapeXML(formatTree(document))}</desc>
<rect width="${width}" height="${height}" fill="#f8fafc"/>
<g font-family="${FONT}">
<text x="32" y="35" font-size="11" font-weight="700" letter-spacing="1.8" fill="#365fa8">FOLDERSEED · DIRECTORY STRUCTURE</text>
<text x="32" y="60" font-size="13" fill="#596579">${rows.length} ${rows.length === 1 ? 'folder' : 'folders'} · Folder-only layout</text>
<path d="M 32 78 H ${width - 32}" stroke="#dbe2ec"/>
<g fill="none" stroke="#c5d0df" stroke-width="1.5">${lines.join('')}</g>
${contents}
<text x="32" y="${height - 34}" font-size="11" fill="#596579">This image describes your folder structure.</text>
<text x="32" y="${height - 18}" font-size="11" fill="#596579">Choose ZIP to download the actual empty folders.</text>
</g></svg>`;
  return { svg, width, height };
}

async function rasterizePNG(svg: string, width: number, height: number): Promise<Blob> {
  // Very large canvas dimensions fail differently across browsers. Fail predictably instead.
  const scale = Math.min(2, PNG_MAX_EDGE / width, PNG_MAX_EDGE / height, Math.sqrt(PNG_MAX_PIXELS / (width * height)));
  if (scale < 1) {
    throw new Error('This layout is too large for PNG. Reduce the number of folders or choose SVG instead.');
  }
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('PNG export requires a browser.');
  }
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not render PNG. Please try SVG instead.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG export is unavailable in this browser. Please choose SVG.');
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG export failed. Please try SVG instead.'));
    }, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function downloadFilename(name: string, format: ExportFormat): string {
  const extension = `.${format}`;
  const encoder = new TextEncoder();
  const budget = 255 - encoder.encode(extension).byteLength;
  let basename = '';
  for (const character of name) {
    if (encoder.encode(basename + character).byteLength > budget) break;
    basename += character;
  }
  // Keep the extension and avoid creating a trailing space or period when shortening.
  basename = basename.replace(/[ .]+$/u, '') || 'FolderSeed';
  return basename + extension;
}

/** No filesystem access: all exports are constructed in memory in the caller's browser. */
export async function createExport(input: DirectoryDocument, format: ExportFormat): Promise<ExportResult> {
  const document = validateDocument(input);
  const filename = downloadFilename(document.root.name, format);
  switch (format) {
    case 'zip': {
      const entries: Zippable = Object.create(null);
      for (const { path } of flatten(document)) {
        // Trailing slash, Unix directory mode and DOS directory flag preserve empty folders.
        entries[`${path}/`] = [new Uint8Array(0), { level: 0, os: 3, attrs: (0o40755 << 16) | 0x10 }];
      }
      const bytes = zipSync(entries, { level: 0 });
      return { filename, blob: new Blob([new Uint8Array(bytes)], { type: 'application/zip' }) };
    }
    case 'txt':
      return { filename, blob: new Blob([formatIndented(document) + '\n'], { type: 'text/plain;charset=utf-8' }) };
    case 'md': {
      const tree = formatTree(document);
      const longestRun = Math.max(0, ...(tree.match(/`+/g) ?? []).map((run) => run.length));
      const fence = '`'.repeat(Math.max(3, longestRun + 1));
      return { filename, blob: new Blob([`${fence}text\n${tree}\n${fence}\n`], { type: 'text/markdown;charset=utf-8' }) };
    }
    case 'json':
      return { filename, blob: new Blob([serializeJSON(document) + '\n'], { type: 'application/json;charset=utf-8' }) };
    case 'svg': {
      const { svg } = renderSVG(document);
      return { filename, blob: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }) };
    }
    case 'png': {
      const { svg, width, height } = renderSVG(document);
      return { filename, blob: await rasterizePNG(svg, width, height) };
    }
    default:
      throw new Error('Unsupported export format.');
  }
}
