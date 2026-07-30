import type { QueueRow } from './types';

export const AppBrand = {
  Name: 'Easy Queue',
  DefaultDescription: 'A simple event queue with live position updates.',
  BackgroundColor: '#fffaf5',
  ThemeColor: '#ea641e',
} as const;

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function eventDescription(queue: QueueRow) {
  return queue.description || `Join the queue for ${queue.name} with ${AppBrand.Name}.`;
}

export function assertInjectableShareTemplate(template: string) {
  const closingHeads = template.match(/<\/head>/gi) || [];
  if (closingHeads.length !== 1) {
    throw new Error('Share page template must contain exactly one closing head tag');
  }
}

function injectBeforeClosingHead(html: string, content: string) {
  return html.replace(/<\/head>/i, `${content}\n  </head>`);
}

function replaceTitle(html: string, title: string) {
  const tag = `<title>${escapeHtml(title)}</title>`;
  return /<title>[\s\S]*?<\/title>/i.test(html)
    ? html.replace(/<title>[\s\S]*?<\/title>/i, tag)
    : injectBeforeClosingHead(html, `    ${tag}`);
}

function replaceDescription(html: string, description: string) {
  const tag = `<meta name="description" content="${escapeHtml(description)}" />`;
  return /<meta\s+name=["']description["'][^>]*>/i.test(html)
    ? html.replace(/<meta\s+name=["']description["'][^>]*>/i, tag)
    : injectBeforeClosingHead(html, `    ${tag}`);
}

function replaceManifest(html: string, href: string) {
  const tag = `<link rel="manifest" href="${escapeHtml(href)}" />`;
  return /<link\s+rel=["']manifest["'][^>]*>/i.test(html)
    ? html.replace(/<link\s+rel=["']manifest["'][^>]*>/i, tag)
    : injectBeforeClosingHead(html, `    ${tag}`);
}

export function buildEventShareHtml(template: string, queue: QueueRow, publicOrigin: string) {
  const slug = encodeURIComponent(queue.slug);
  const title = `${queue.name} | ${AppBrand.Name}`;
  const description = eventDescription(queue);
  const url = `${publicOrigin}/q/${slug}`;
  const image = queue.logo_path
    ? `${publicOrigin}/event-assets/${encodeURIComponent(queue.logo_path)}`
    : `${publicOrigin}/favicon-512.png`;

  let html = template
    .replace(/\s*<meta\b[^>]*(?:property|name)=["'](?:og:|twitter:)[^>]*>\s*/gi, '\n')
    .replace(/\s*<link\b[^>]*rel=["']canonical["'][^>]*>\s*/gi, '\n');
  html = replaceTitle(html, title);
  html = replaceDescription(html, description);
  html = replaceManifest(html, `/q/${slug}/manifest.webmanifest`);

  const socialTags = [
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${escapeHtml(AppBrand.Name)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
  ]
    .map(tag => `    ${tag}`)
    .join('\n');

  return injectBeforeClosingHead(html, socialTags);
}

export function buildEventManifest(queue: QueueRow) {
  const slug = encodeURIComponent(queue.slug);
  return {
    id: `/q/${slug}`,
    name: `${queue.name} | ${AppBrand.Name}`,
    short_name: queue.name,
    description: eventDescription(queue),
    start_url: `/q/${slug}`,
    scope: '/',
    display: 'standalone',
    background_color: AppBrand.BackgroundColor,
    theme_color: AppBrand.ThemeColor,
    icons: [
      { src: '/favicon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/favicon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
