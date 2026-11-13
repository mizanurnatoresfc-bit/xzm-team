/* Small, dependency-free spreadsheet helpers written for this demo:
   - SF.XLSX.build()  writes a real .xlsx (styles, column widths, page setup, header/footer, optional logo)
   - SF.XLSX.read()   reads the first sheet of an .xlsx into rows of text
   - SF.CSV.parse() / SF.CSV.build() */
(function () {
  "use strict";
  const SF = (window.SF = window.SF || {});
  const enc = new TextEncoder(), dec = new TextDecoder("utf-8");
  const x = (s) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const colName = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

  /* ---------------- zip (store only) ---------------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {
    const parts = [], central = []; let off = 0;
    const now = new Date(), dt = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(), tm = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    files.forEach((f) => {
      const name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, tm, true); lh.setUint16(12, dt, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, tm, true); ch.setUint16(14, dt, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + data.length;
    });
    const csize = central.reduce((n, p) => n + p.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /* ---------------- xlsx writer ----------------
     o = { sheetName, rows:[[cell]], widths:[chars], headerRow (0-based index of the table header, or -1),
           titleRows (number of title rows above the table), font, fontSize, align, headerAlign,
           page:{orientation, size, header, footer, pageNumbers}, logo:{dataUrl,width,height,col} }
     cell = string | number | {v, s} with s: 0 plain, 1 body, 2 table header, 3 title, 4 sub-title */
  const PAPER = { Letter: 1, Legal: 5, A3: 8, A4: 9 };
  function build(o) {
    const font = x(o.font || "Calibri"), fs = o.fontSize || 11, ncols = Math.max.apply(null, o.rows.map((r) => r.length).concat([1]));
    const al = (h, wrap) => `<alignment horizontal="${h}" vertical="${wrap ? "top" : "center"}" wrapText="1"/>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="${fs}"/><name val="${font}"/></font><font><b/><sz val="${fs}"/><name val="${font}"/></font><font><b/><sz val="${fs + 4}"/><name val="${font}"/></font><font><sz val="${Math.max(8, fs - 1)}"/><color rgb="FF555555"/><name val="${font}"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDF3E6"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF9AA5A0"/></left><right style="thin"><color rgb="FF9AA5A0"/></right><top style="thin"><color rgb="FF9AA5A0"/></top><bottom style="thin"><color rgb="FF9AA5A0"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">${al(o.align || "left", true)}</xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${al(o.headerAlign || "center", false)}</xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const rowsXml = o.rows.map((r, ri) => `<row r="${ri + 1}"${ri === o.headerRow ? ' ht="22" customHeight="1"' : ""}>` + r.map((c, ci) => {
      if (c == null || c === "") return ""; const v = typeof c === "object" ? c.v : c, s = typeof c === "object" ? c.s || 0 : 0, ref = colName(ci) + (ri + 1);
      if (v == null || v === "") return s ? `<c r="${ref}" s="${s}"/>` : "";
      return typeof v === "number" && isFinite(v) ? `<c r="${ref}" s="${s}"><v>${v}</v></c>` : `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
    }).join("") + "</row>").join("");
    const pg = o.page || {}, hasHdr = o.headerRow >= 0;
    const hf = (pg.header || pg.footer || pg.pageNumbers) ? `<headerFooter>${pg.header ? `<oddHeader>${x("&C" + pg.header.replace(/&/g, "&&"))}</oddHeader>` : ""}<oddFooter>${x((pg.footer ? "&L" + pg.footer.replace(/&/g, "&&") : "") + (pg.pageNumbers ? "&RPage &P of &N" : ""))}</oddFooter></headerFooter>` : "";
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${colName(ncols - 1)}${Math.max(1, o.rows.length)}"/>
<sheetViews><sheetView workbookViewId="0">${hasHdr ? `<pane ySplit="${o.headerRow + 1}" topLeftCell="A${o.headerRow + 2}" activePane="bottomLeft" state="frozen"/>` : ""}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${Array.from({ length: ncols }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(6, (o.widths || [])[i] || 14))}" customWidth="1"/>`).join("")}</cols>
<sheetData>${rowsXml}</sheetData>
<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
<pageSetup paperSize="${PAPER[pg.size] || 9}" orientation="${pg.orientation === "portrait" ? "portrait" : "landscape"}" fitToWidth="1" fitToHeight="0"/>${hf}${o.logo ? '<drawing r:id="rId1"/>' : ""}</worksheet>`;
    const sname = x(String(o.sheetName || "Sheet1").replace(/[\\\/\?\*\[\]:]/g, " ").slice(0, 31));
    const files = [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${o.logo ? `<Default Extension="${o.logo.ext}" ContentType="image/${o.logo.ext === "jpg" ? "jpeg" : "png"}"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : ""}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="${sname}" sheetId="1" r:id="rId1"/></sheets>${hasHdr ? `<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${sname.replace(/'/g, "''")}'!$${o.headerRow + 1}:$${o.headerRow + 1}</definedName></definedNames>` : ""}</workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", data: styles },
      { name: "xl/worksheets/sheet1.xml", data: sheet }
    ];
    if (o.logo) {
      const cx = Math.round(o.logo.width * 9525), cy = Math.round(o.logo.height * 9525);
      files.push({ name: "xl/worksheets/_rels/sheet1.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>` });
      files.push({ name: "xl/drawings/drawing1.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>${o.logo.col || 0}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>` });
      files.push({ name: "xl/drawings/_rels/drawing1.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.${o.logo.ext}"/></Relationships>` });
      files.push({ name: "xl/media/image1." + o.logo.ext, data: o.logo.bytes });
    }
    return zip(files);
  }
  /** turns a data: URL into what build() needs for a logo */
  function logoFrom(dataUrl, col) {
    return new Promise((res) => {
      const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl || ""); if (!m) return res(null);
      const bin = atob(m[2]), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const img = new Image();
      img.onload = () => { const h = 44, w = Math.round((img.width / img.height) * h); res({ bytes, ext: m[1] === "jpeg" ? "jpg" : "png", width: w, height: h, col: col || 0 }); };
      img.onerror = () => res(null); img.src = dataUrl;
    });
  }

  /* ---------------- xlsx reader (first sheet) ---------------- */
  async function inflate(u8) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot open .xlsx files here. Save the sheet as CSV and import that.");
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
  }
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf); let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error("This is not a valid .xlsx file.");
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {};
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("This .xlsx file is damaged.");
      const method = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      out[name] = { method, data: u8.subarray(ds, ds + csz) };
      p += 46 + nl + xl + cl;
    }
    return { has: (k) => !!out[k], names: Object.keys(out), async text(k) { const f = out[k]; if (!f) return null; if (f.method === 0) return dec.decode(f.data); if (f.method === 8) return dec.decode(await inflate(f.data)); throw new Error("Unsupported compression in this .xlsx file."); } };
  }
  async function read(buf) {
    const z = await unzip(buf), parse = (s) => new DOMParser().parseFromString(s, "application/xml");
    let path = "xl/worksheets/sheet1.xml";
    const wb = await z.text("xl/workbook.xml"), rels = await z.text("xl/_rels/workbook.xml.rels");
    if (wb && rels) {
      const s = parse(wb).getElementsByTagName("sheet")[0], rid = s && (s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"));
      const rel = Array.from(parse(rels).getElementsByTagName("Relationship")).find((r) => r.getAttribute("Id") === rid);
      if (rel) { const t = rel.getAttribute("Target"); path = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, ""); }
    }
    const sx = await z.text(path); if (!sx) throw new Error("No worksheet was found in this file.");
    const shared = []; const ss = await z.text("xl/sharedStrings.xml");
    if (ss) Array.from(parse(ss).getElementsByTagName("si")).forEach((si) => shared.push(Array.from(si.getElementsByTagName("t")).filter((t) => t.parentNode.nodeName !== "rPh").map((t) => t.textContent).join("")));
    const rows = [];
    Array.from(parse(sx).getElementsByTagName("row")).forEach((r) => {
      const row = [];
      Array.from(r.getElementsByTagName("c")).forEach((c) => {
        const ref = c.getAttribute("r") || "", letters = ref.replace(/\d+/g, ""); let ci = 0; for (let i = 0; i < letters.length; i++) ci = ci * 26 + (letters.charCodeAt(i) - 64); ci = letters ? ci - 1 : row.length;
        const t = c.getAttribute("t"), v = c.getElementsByTagName("v")[0]; let val = "";
        if (t === "s") val = shared[Number(v ? v.textContent : -1)] || "";
        else if (t === "inlineStr") val = Array.from(c.getElementsByTagName("t")).map((n) => n.textContent).join("");
        else if (t === "b") val = v && v.textContent === "1" ? "TRUE" : "FALSE";
        else val = v ? v.textContent : "";
        row[ci] = val;
      });
      const rn = Number(r.getAttribute("r")) || rows.length + 1;
      while (rows.length < rn - 1) rows.push([]);
      rows.push(Array.from(row, (v) => (v == null ? "" : String(v))));
    });
    return rows;
  }

  /* ---------------- csv ---------------- */
  const CSV = {
    parse(text) {
      text = String(text).replace(/^﻿/, "");
      const first = text.split(/\r?\n/)[0] || "", cnt = (ch) => first.split(ch).length - 1;
      const delim = cnt("\t") > cnt(",") && cnt("\t") >= cnt(";") ? "\t" : cnt(";") > cnt(",") ? ";" : ",";
      const rows = []; let row = [], cur = "", q = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
        else if (c === '"' && cur === "") q = true;
        else if (c === delim) { row.push(cur); cur = ""; }
        else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
        else cur += c;
      }
      if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
      return rows;
    },
    build(rows) { return new Blob(["﻿" + rows.map((r) => r.map((c) => { const s = String(c == null ? "" : c); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }); }
  };

  SF.XLSX = { build, read, logoFrom, colName };
  SF.CSV = CSV;
})();
