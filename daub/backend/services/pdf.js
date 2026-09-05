/**
 * Minimal PDF writer - enough to typeset a licence agreement and a certificate,
 * and nothing more.
 *
 * Hand-rolled rather than pulled from npm because these two documents are the
 * product: the licence is the thing being sold, and the certificate is the
 * switching cost. Both need to be byte-stable so their hashes mean something,
 * and neither needs images, embedded fonts, or layout beyond a single column.
 *
 * Uses the base-14 fonts, so nothing is embedded and every reader can open it.
 * Text is Latin-1; sanitise() folds the typographic characters that turn up in
 * legal copy down to their ASCII equivalents.
 */

const PAGE_W = 612;      // US Letter, 72dpi
const PAGE_H = 792;
const MARGIN = 64;
const BODY_W = PAGE_W - MARGIN * 2;

// Adobe's Helvetica advance widths (1/1000 em) for printable ASCII. Bold is
// approximated from these; it only ever sets short headings.
const HELV = {
  ' ':278,'!':278,'"':355,'#':556,'$':556,'%':889,'&':667,"'":191,'(':333,')':333,
  '*':389,'+':584,',':278,'-':333,'.':278,'/':278,
  '0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,'8':556,'9':556,
  ':':278,';':278,'<':584,'=':584,'>':584,'?':556,'@':1015,
  'A':667,'B':667,'C':722,'D':722,'E':667,'F':611,'G':778,'H':722,'I':278,'J':500,
  'K':667,'L':556,'M':833,'N':722,'O':778,'P':667,'Q':778,'R':722,'S':667,'T':611,
  'U':722,'V':667,'W':944,'X':667,'Y':667,'Z':611,
  '[':278,'\\':278,']':278,'^':469,'_':556,'`':333,
  'a':556,'b':556,'c':500,'d':556,'e':556,'f':278,'g':556,'h':556,'i':222,'j':222,
  'k':500,'l':222,'m':833,'n':556,'o':556,'p':556,'q':556,'r':333,'s':500,'t':278,
  'u':556,'v':500,'w':722,'x':500,'y':500,'z':500,
  '{':334,'|':260,'}':334,'~':584,
};
const BOLD_FACTOR = 1.07;

const FONTS = { regular: '/F1', bold: '/F2', italic: '/F3' };

const SANITISE = {
  '‘': "'", '’': "'", '“': '"', '”': '"',
  '–': '-', '—': '--', '…': '...', ' ': ' ',
  '•': '*', '×': 'x', '−': '-', '′': "'", '″': '"',
};

function sanitise(text) {
  return String(text ?? '')
    .replace(/[‘’“”–—… •×−′″]/g, c => SANITISE[c])
    // Anything still outside printable Latin-1 would corrupt the stream.
    .replace(/[^\x20-\x7e¡-ÿ\n\t]/g, '');
}

function textWidth(text, size, bold) {
  let w = 0;
  for (const ch of text) w += HELV[ch] ?? 556;
  if (bold) w *= BOLD_FACTOR;
  return (w * size) / 1000;
}

function escapePdf(text) {
  return text.replace(/([\\()])/g, '\\$1');
}

/** Greedy wrap. Words longer than the column are hard-split rather than dropped. */
function wrap(text, size, bold, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, bold) <= maxWidth) { line = candidate; continue; }
      if (line) lines.push(line);
      if (textWidth(word, size, bold) <= maxWidth) { line = word; continue; }
      let chunk = '';
      for (const ch of word) {
        if (textWidth(chunk + ch, size, bold) > maxWidth) { lines.push(chunk); chunk = ch; }
        else chunk += ch;
      }
      line = chunk;
    }
    if (line) lines.push(line);
  }
  return lines;
}

class PdfDoc {
  constructor({ title = '', subtitle = '', footer = '' } = {}) {
    this.title = title;
    this.subtitle = subtitle;
    this.footerText = footer;
    this.pages = [];        // each page is an array of content-stream fragments
    this.current = null;
    this.y = 0;
    this._newPage();
    if (title) this.heading(title, 18);
    if (subtitle) { this.text(subtitle, { size: 10, font: 'italic', gray: 0.35 }); this.spacer(8); }
  }

  _newPage() {
    this.current = [];
    this.pages.push(this.current);
    this.y = PAGE_H - MARGIN;
  }

  _ensure(height) {
    if (this.y - height < MARGIN + 34) this._newPage();
  }

  /** Move the cursor down one line, breaking the page first if needed. */
  _advance(size) {
    const leading = size * 1.42;
    this._ensure(leading);
    this.y -= leading;
    return this.y;
  }

  /** Draw a string at an absolute baseline. Does not move the cursor. */
  _draw(str, baseline, { size, font = 'regular', gray = 0, indent = 0 }) {
    if (!str) return;
    this.current.push(
      `BT ${gray} g ${FONTS[font] || FONTS.regular} ${size} Tf ` +
      `1 0 0 1 ${(MARGIN + indent).toFixed(2)} ${baseline.toFixed(2)} Tm ` +
      `(${escapePdf(str)}) Tj ET`
    );
  }

  /** Advance and draw in one step, the common case. */
  _line(str, { size, font, gray, indent = 0 }) {
    this._draw(str, this._advance(size), { size, font, gray, indent });
  }

  text(body, { size = 10, font = 'regular', gray = 0, indent = 0, after = 0 } = {}) {
    const lines = wrap(sanitise(body), size, font === 'bold', BODY_W - indent);
    for (const line of lines) this._line(line, { size, font, gray, indent });
    if (after) this.spacer(after);
    return this;
  }

  heading(body, size = 13) {
    this.spacer(size * 0.5);
    this.text(body, { size, font: 'bold' });
    this.spacer(4);
    return this;
  }

  /** Numbered clause: "1." hanging in the margin, body wrapped beside it. */
  clause(number, body, { size = 10 } = {}) {
    const label = `${number}.`;
    const labelW = 22;
    const lines = wrap(sanitise(body), size, false, BODY_W - labelW);
    // Keep the clause number with at least two lines of its body.
    this._ensure(size * 1.42 * Math.min(lines.length, 3));
    lines.forEach((line, i) => {
      const baseline = this._advance(size);
      if (i === 0) this._draw(label, baseline, { size, font: 'bold' });
      this._draw(line, baseline, { size, indent: labelW });
    });
    this.spacer(5);
    return this;
  }

  bullet(body, { size = 10 } = {}) {
    const lines = wrap(sanitise(body), size, false, BODY_W - 16);
    lines.forEach((line, i) => {
      const baseline = this._advance(size);
      if (i === 0) this._draw('-', baseline, { size, indent: 4 });
      this._draw(line, baseline, { size, indent: 16 });
    });
    this.spacer(2);
    return this;
  }

  /** Label in the left column, value in the right. Long values wrap under. */
  keyValue(label, value, { size = 10, labelWidth = 150 } = {}) {
    const valueLines = wrap(sanitise(value), size, false, BODY_W - labelWidth);
    this._ensure(size * 1.42 * valueLines.length);
    valueLines.forEach((line, i) => {
      const baseline = this._advance(size);
      if (i === 0) this._draw(sanitise(label), baseline, { size, gray: 0.35 });
      this._draw(line, baseline, { size, indent: labelWidth });
    });
    return this;
  }

  /** Small fixed-width-ish block for hashes and signatures. */
  mono(body, { size = 8 } = {}) {
    const clean = sanitise(body);
    const perLine = 88;
    for (let i = 0; i < clean.length; i += perLine) {
      this._ensure(size * 1.35);
      this.y -= size * 1.35;
      this.current.push(
        `BT 0.25 g /F4 ${size} Tf 1 0 0 1 ${MARGIN.toFixed(2)} ${this.y.toFixed(2)} Tm ` +
        `(${escapePdf(clean.slice(i, i + perLine))}) Tj ET`
      );
    }
    return this;
  }

  rule({ gray = 0.75, after = 8 } = {}) {
    this._ensure(10);
    this.y -= 6;
    this.current.push(
      `${gray} G 0.6 w ${MARGIN} ${this.y.toFixed(2)} m ${(PAGE_W - MARGIN)} ${this.y.toFixed(2)} l S`
    );
    this.spacer(after);
    return this;
  }

  /** Boxed callout used for the certificate's verification block. */
  box(height, { gray = 0.94 } = {}) {
    this._ensure(height + 8);
    const top = this.y;
    this.current.push(
      `${gray} g ${MARGIN - 8} ${(top - height).toFixed(2)} ${(BODY_W + 16).toFixed(2)} ${height} re f 0 g`
    );
    return top;
  }

  spacer(points) { this.y -= points; return this; }

  pageBreak() { this._newPage(); return this; }

  toBuffer() {
    const objects = [];             // 1-indexed on write
    const add = (body) => { objects.push(body); return objects.length; };

    const catalogId = 1, pagesId = 2;
    objects.push(null, null);       // reserve 1 and 2

    const fontIds = {
      F1: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
      F2: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
      F3: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>'),
      F4: add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'),
    };
    const resources =
      `<< /Font << /F1 ${fontIds.F1} 0 R /F2 ${fontIds.F2} 0 R ` +
      `/F3 ${fontIds.F3} 0 R /F4 ${fontIds.F4} 0 R >> >>`;

    const pageIds = [];
    this.pages.forEach((fragments, index) => {
      const footer =
        `BT 0.5 g /F1 8 Tf 1 0 0 1 ${MARGIN} ${MARGIN - 18} Tm ` +
        `(${escapePdf(sanitise(this.footerText))}) Tj ET` +
        `BT 0.5 g /F1 8 Tf 1 0 0 1 ${PAGE_W - MARGIN - 44} ${MARGIN - 18} Tm ` +
        `(${escapePdf(`Page ${index + 1} of ${this.pages.length}`)}) Tj ET`;
      const stream = `${fragments.join('\n')}\n${footer}`;
      const streamId = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
      pageIds.push(add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources ${resources} /Contents ${streamId} 0 R >>`
      ));
    });

    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] =
      `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    let out = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(Buffer.byteLength(out, 'latin1'));
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });

    const xrefOffset = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`;
    out += `startxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.from(out, 'latin1');
  }
}

module.exports = { PdfDoc, sanitise, wrap, textWidth, PAGE_W, PAGE_H, MARGIN, BODY_W };
