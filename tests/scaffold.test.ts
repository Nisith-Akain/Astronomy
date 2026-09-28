import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');

describe('BE-01 scaffold', () => {
  it('index.html has the stage canvas and the four C6 sections in order', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    expect(html).toContain('<canvas id="stage"');
    const ids = [...html.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['hero', 'solar-system', 'probe', 'outro']);
  });
});
