/* =========================
   Client-side PDF -> OCR -> Excel
   Uses: pdf.js + tesseract.js + SheetJS
   ========================= */

const pdfInput = document.getElementById("pdfInput");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnClear = document.getElementById("btnClear");
const btnPreview = document.getElementById("btnPreview");

const statusText = document.getElementById("statusText");
const bar = document.getElementById("bar");

const dlPdf = document.getElementById("dlPdf");
const dlXlsx = document.getElementById("dlXlsx");
const tableWrap = document.getElementById("tableWrap");

let pdfFile = null;
let stopFlag = false;
let lastRows = [];

// Bangla digits -> English digits
const bn2enMap = { "০":"0","১":"1","২":"2","৩":"3","৪":"4","৫":"5","৬":"6","৭":"7","৮":"8","৯":"9" };
function bnToEnDigits(s=""){
  return s.replace(/[০-৯]/g, d => bn2enMap[d] ?? d);
}

function setStatus(msg){
  statusText.textContent = msg;
}
function setProgress(pct){
  const p = Math.max(0, Math.min(100, pct));
  bar.style.width = `${p}%`;
}

pdfInput.addEventListener("change", () => {
  pdfFile = pdfInput.files?.[0] || null;
  btnStart.disabled = !pdfFile;
  btnStop.disabled = !pdfFile;
  btnPreview.disabled = true;
  dlPdf.style.display = "none";
  dlXlsx.style.display = "none";
  setProgress(0);
  lastRows = [];
  tableWrap.innerHTML = "";

  if (pdfFile){
    setStatus(`Selected: ${pdfFile.name} (${Math.round(pdfFile.size/1024)} KB)`);
    // allow PDF download
    const url = URL.createObjectURL(pdfFile);
    dlPdf.href = url;
    dlPdf.download = pdfFile.name || "uploaded.pdf";
    dlPdf.style.display = "inline-block";
  } else {
    setStatus("PDF সিলেক্ট করুন।");
  }
});

btnClear.addEventListener("click", () => {
  pdfInput.value = "";
  pdfFile = null;
  stopFlag = false;
  lastRows = [];
  tableWrap.innerHTML = "";
  btnStart.disabled = true;
  btnStop.disabled = true;
  btnPreview.disabled = true;
  dlPdf.style.display = "none";
  dlXlsx.style.display = "none";
  setProgress(0);
  setStatus("Cleared. PDF সিলেক্ট করুন।");
});

btnStop.addEventListener("click", () => {
  stopFlag = true;
  setStatus("Stopping... (current page finishes then stops)");
});

btnPreview.addEventListener("click", () => {
  renderTable(lastRows);
});

// ----------- OCR + PDF rendering helpers ------------

async function renderPageToCanvas(pdfDoc, pageNo, scale=2.0){
  const page = await pdfDoc.getPage(pageNo);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const renderTask = page.render({ canvasContext: ctx, viewport });
  await renderTask.promise;

  return canvas;
}

async function ocrCanvasBangla(canvas){
  // OCR config: "ben" (Bangla)
  const { data } = await Tesseract.recognize(
    canvas,
    "ben",
    {
      logger: (m) => {
        // m.progress: 0..1 during OCR
        // we don't directly set page progress here; handled in loop
      }
    }
  );
  return data.text || "";
}

// ----------- Parsing logic (Bangla voter format) ------------

function parseRecordsFromText(rawText){
  const text = bnToEnDigits(rawText || "");

  // record start: "0001. নাম:"
  const startRe = /^\s*(\d{4})\.\s*নাম:\s*(.+)\s*$/m;

  // Split by starts using match indices
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);

  const starts = [];
  for (let i=0; i<lines.length; i++){
    const m = lines[i].match(startRe);
    if (m){
      starts.push({ i, serial: parseInt(m[1],10), name: m[2].trim() });
    }
  }

  const out = [];
  for (let s=0; s<starts.length; s++){
    const cur = starts[s];
    const from = cur.i;
    const to = (s+1 < starts.length) ? starts[s+1].i : lines.length;

    const blockLines = lines.slice(from, to);
    const blockText = blockLines.join("\n");

    // skip migrated
    if (blockText.includes("মাইগ্রেট")) continue;

    const row = {
      Serial: cur.serial,
      "নাম": cur.name,
      "ভোটার নং": "",
      "পিতা": "",
      "মাতা": "",
      "পেশা": "",
      "জন্ম তারিখ": "",
      "ঠিকানা": ""
    };

    for (const ln of blockLines){
      if (ln.startsWith("ভোটার নং:")) row["ভোটার নং"] = ln.split(":",2)[1].trim();
      else if (ln.startsWith("পিতা:")) row["পিতা"] = ln.split(":",2)[1].trim();
      else if (ln.startsWith("মাতা:")) row["মাতা"] = ln.split(":",2)[1].trim();
      else if (ln.startsWith("ঠিকানা:")) row["ঠিকানা"] = ln.split(":",2)[1].trim();
      else if (ln.startsWith("পেশা:")){
        const rest = ln.split(":",2)[1] || "";
        const parts = rest.split("জন্ম তারিখ:");
        if (parts.length >= 2){
          row["পেশা"] = parts[0].replace(/,?\s*$/,"").trim();
          row["জন্ম তারিখ"] = parts[1].trim();
        } else {
          row["পেশা"] = rest.trim();
        }
      }
    }

    // keep only meaningful records (voter no often present)
    if (row["ভোটার নং"] || row["পিতা"] || row["মাতা"] || row["ঠিকানা"]) out.push(row);
  }

  out.sort((a,b) => a.Serial - b.Serial);
  return out;
}

// ----------- Excel creation ------------

function buildXlsx(rows){
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "voters");
  const xlsxArray = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([xlsxArray], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function renderTable(rows){
  if (!rows?.length){
    tableWrap.innerHTML = `<div style="padding:12px" class="muted">No data to preview.</div>`;
    return;
  }
  const cols = ["Serial","নাম","ভোটার নং","পিতা","মাতা","পেশা","জন্ম তারিখ","ঠিকানা"];

  let html = `<table><thead><tr>`;
  for (const c of cols) html += `<th>${escapeHtml(c)}</th>`;
  html += `</tr></thead><tbody>`;

  const max = Math.min(rows.length, 50); // preview first 50
  for (let i=0; i<max; i++){
    const r = rows[i];
    html += `<tr>`;
    for (const c of cols) html += `<td>${escapeHtml(String(r[c] ?? ""))}</td>`;
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  html += `<div style="padding:12px" class="muted">Preview showing first ${max} rows of ${rows.length}.</div>`;
  tableWrap.innerHTML = html;
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

// ----------- Main convert flow ------------

btnStart.addEventListener("click", async () => {
  if (!pdfFile) return;

  stopFlag = false;
  dlXlsx.style.display = "none";
  btnPreview.disabled = true;
  tableWrap.innerHTML = "";
  lastRows = [];

  setStatus("Loading PDF...");
  setProgress(1);

  const buf = await pdfFile.arrayBuffer();

  // pdf.js setup
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.js";

  const pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
  const totalPages = pdfDoc.numPages;

  setStatus(`PDF loaded. Pages: ${totalPages}. Starting OCR...`);
  setProgress(2);

  let allText = "";

  for (let p=1; p<=totalPages; p++){
    if (stopFlag) break;

    const pct = Math.round((p-1)/totalPages * 100);
    setProgress(pct);

    setStatus(`OCR page ${p}/${totalPages} ...`);
    const canvas = await renderPageToCanvas(pdfDoc, p, 2.0);
    const pageText = await ocrCanvasBangla(canvas);
    allText += "\n" + pageText;
  }

  setProgress(95);
  setStatus("Parsing data...");
  const rows = parseRecordsFromText(allText);
  lastRows = rows;

  if (!rows.length){
    setProgress(0);
    setStatus("❌ Data পাওয়া যায়নি। PDF format mismatch বা OCR problem হতে পারে।");
    return;
  }

  setStatus(`Creating Excel... (rows: ${rows.length})`);
  const blob = buildXlsx(rows);
  const url = URL.createObjectURL(blob);

  dlXlsx.href = url;
  dlXlsx.download = "output.xlsx";
  dlXlsx.style.display = "inline-block";

  btnPreview.disabled = false;
  setProgress(100);
  setStatus("✅ Done! নিচ থেকে Excel Download করুন।");
});
