const test   = require('node:test');
const assert = require('node:assert');
const { PdfDoc, sanitise, wrap, textWidth, BODY_W } = require('../services/pdf');

function parseXref(pdf) {
  const start = Number(/startxref\s+(\d+)/.exec(pdf.toString('latin1'))[1]);
  const lines = pdf.subarray(start).toString('latin1').split('\n');
  const count = Number(lines[1].split(' ')[1]);
  return { start, count, lines };
}

test('produces a structurally valid PDF with resolvable object offsets', () => {
  const doc = new PdfDoc({ title: 'Single-Use Painting Licence', footer: 'LIC-000001' });
  for (let i = 1; i <= 30; i++) doc.clause(i, `Clause ${i}. ${'Body text that wraps. '.repeat(12)}`);
  const pdf = doc.toBuffer();

  assert.deepStrictEqual(pdf.subarray(0, 8), Buffer.from('%PDF-1.4'));
  assert.ok(pdf.subarray(-6).toString('latin1').includes('%%EOF'));

  const { start, count, lines } = parseXref(pdf);
  assert.strictEqual(pdf.subarray(start, start + 4).toString('latin1'), 'xref');

  for (let i = 1; i < count; i++) {
    const offset = Number(lines[2 + i].slice(0, 10));
    assert.ok(pdf.subarray(offset, offset + 40).toString('latin1').startsWith(`${i} 0 obj`),
      `xref entry ${i} does not point at object ${i}`);
  }
});

test('long documents break across pages and the page count matches the Kids array', () => {
  const doc = new PdfDoc({ title: 'Long' });
  for (let i = 0; i < 200; i++) doc.text('A line of body copy that takes vertical space.');
  const pdf = doc.toBuffer().toString('latin1');

  const count = Number(/\/Count (\d+)/.exec(pdf)[1]);
  const kids  = /\/Kids \[([^\]]*)\]/.exec(pdf)[1].trim().split(/\s+0 R\s*/).filter(Boolean).length;
  assert.ok(count > 3, 'expected several pages');
  assert.strictEqual(count, kids);
});

test('parentheses and backslashes in names cannot break the content stream', () => {
  const doc = new PdfDoc({ title: 'Escapes' });
  doc.text('Marcus (Rey\\es) signed) here (');
  const pdf = doc.toBuffer().toString('latin1');
  assert.ok(pdf.includes('Marcus \\(Rey\\\\es\\) signed\\) here \\('));
});

test('typographic characters in legal copy are folded, not dropped', () => {
  assert.strictEqual(sanitise('the Painter\u2019s \u201Cwork\u201D \u2013 one painting\u2026'),
                     'the Painter\'s "work" - one painting...');
});

test('no wrapped line exceeds the column, including unbreakable strings', () => {
  const hash = 'a'.repeat(300);
  for (const line of wrap(`A normal sentence then ${hash} then more words.`, 10, false, BODY_W)) {
    assert.ok(textWidth(line, 10, false) <= BODY_W, `line overflowed: ${line.slice(0, 40)}`);
  }
});

test('the same content produces the same bytes, so licence hashes are stable', () => {
  const build = () => {
    const doc = new PdfDoc({ title: 'Stable', footer: 'x' });
    doc.text('Same input, same output.');
    doc.mono('deadbeef');
    return doc.toBuffer();
  };
  assert.deepStrictEqual(build(), build());
});
